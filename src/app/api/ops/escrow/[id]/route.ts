import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { TaskStatus, EscrowState, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client";

const escrowActionSchema = z.object({
  action: z.enum(["release", "resolve_dismiss", "resolve_refund"]),
  resolution: z.string().max(500).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only ADMIN and COORDINATOR can manage escrow
    if (!hasMinRole(session.role, "COORDINATOR")) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = escrowActionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { action, resolution } = parsed.data;

    // Fetch escrow with task and household
    const escrow = await db.escrowLedger.findUnique({
      where: { id },
      include: {
        task: {
          include: {
            household: { select: { id: true, name: true } },
          },
        },
        booking: {
          include: {
            vendor: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!escrow) {
      return NextResponse.json({ error: "Escrow entry not found" }, { status: 404 });
    }

    const task = escrow.task;
    if (!task) {
      return NextResponse.json({ error: "Associated task not found" }, { status: 404 });
    }

    const now = new Date();

    // ── ACTION: Release Escrow ──
    if (action === "release") {
      if (escrow.state !== EscrowState.HELD) {
        return NextResponse.json(
          { error: `Escrow cannot be released — current state is ${escrow.state}` },
          { status: 409 }
        );
      }

      if (task.status !== TaskStatus.VERIFIED && task.status !== TaskStatus.COMPLETED) {
        return NextResponse.json(
          { error: `Task must be VERIFIED or COMPLETED to release escrow — current status is ${task.status}` },
          { status: 409 }
        );
      }

      const result = await db.$transaction(async (tx) => {
        const updatedEscrow = await tx.escrowLedger.update({
          where: { id },
          data: { state: EscrowState.RELEASED, releasedAt: now },
        });

        const updatedTask = await tx.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.ESCROW_RELEASED, escrowReleasedAt: now },
        });

        // Create audit log
        await tx.auditLog.create({
          data: {
            userId: session.userId,
            userName: session.name,
            action: "ESCROW_RELEASE",
            entityType: "EscrowLedger",
            entityId: id,
            metadata: {
              taskId: task.id,
              amountCents: escrow.amountCents,
              resolution: resolution || "Released by ops",
            },
          },
        });

        // Notify household members
        const members = await tx.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });

        for (const member of members) {
          await tx.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.ESCROW_RELEASED,
              title: "Payment Released",
              body: `Payment of SGD $${(escrow.vendorPayoutCents / 100).toFixed(2)} has been released to the vendor for your ${task.category.toLowerCase()} task.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          });
        }

        return { updatedTask, updatedEscrow };
      });

      return NextResponse.json({ task: result.updatedTask, escrow: result.updatedEscrow });
    }

    // ── ACTION: Resolve Dispute (Dismiss) — reset to HELD, task back to COMPLETED ──
    if (action === "resolve_dismiss") {
      if (escrow.state !== EscrowState.DISPUTED) {
        return NextResponse.json(
          { error: `Escrow is not in DISPUTED state — current state is ${escrow.state}` },
          { status: 409 }
        );
      }

      if (task.status !== TaskStatus.DISPUTED) {
        return NextResponse.json(
          { error: `Task is not DISPUTED — current status is ${task.status}` },
          { status: 409 }
        );
      }

      const result = await db.$transaction(async (tx) => {
        // Reset escrow to HELD
        const updatedEscrow = await tx.escrowLedger.update({
          where: { id },
          data: {
            state: EscrowState.HELD,
            disputeResolution: resolution || "Dispute dismissed by ops",
            disputeResolvedBy: session.name,
            disputeResolvedAt: now,
          },
        });

        // Unpause autonomy
        await tx.householdCategoryAutonomy.updateMany({
          where: {
            householdId: task.householdId,
            category: task.category,
            promotionPaused: true,
          },
          data: { promotionPaused: false },
        });

        // Reset task to COMPLETED (allowing re-verification)
        const updatedTask = await tx.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.COMPLETED },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: session.userId,
            userName: session.name,
            action: "DISPUTE_DISMISSED",
            entityType: "EscrowLedger",
            entityId: id,
            metadata: {
              taskId: task.id,
              disputeReason: escrow.disputeReason,
              resolution: resolution || "Dispute dismissed by ops",
            },
          },
        });

        // Notify household members
        const members = await tx.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });

        for (const member of members) {
          await tx.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.DISPUTE_RESOLVED,
              title: "Dispute Resolved",
              body: `The dispute on your ${task.category.toLowerCase()} task has been reviewed and dismissed. The task is now pending verification.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          });
        }

        return { updatedTask, updatedEscrow };
      });

      return NextResponse.json({ task: result.updatedTask, escrow: result.updatedEscrow });
    }

    // ── ACTION: Resolve Dispute (Refund) — set escrow to REFUNDED ──
    if (action === "resolve_refund") {
      if (escrow.state !== EscrowState.DISPUTED) {
        return NextResponse.json(
          { error: `Escrow is not in DISPUTED state — current state is ${escrow.state}` },
          { status: 409 }
        );
      }

      if (task.status !== TaskStatus.DISPUTED) {
        return NextResponse.json(
          { error: `Task is not DISPUTED — current status is ${task.status}` },
          { status: 409 }
        );
      }

      const result = await db.$transaction(async (tx) => {
        // Set escrow to REFUNDED
        const updatedEscrow = await tx.escrowLedger.update({
          where: { id },
          data: {
            state: EscrowState.REFUNDED,
            refundedAt: now,
            disputeResolution: resolution || "Dispute upheld — refund issued by ops",
            disputeResolvedBy: session.name,
            disputeResolvedAt: now,
          },
        });

        // Unpause autonomy (household shouldn't be penalised if dispute was upheld)
        await tx.householdCategoryAutonomy.updateMany({
          where: {
            householdId: task.householdId,
            category: task.category,
            promotionPaused: true,
          },
          data: { promotionPaused: false },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: session.userId,
            userName: session.name,
            action: "DISPUTE_REFUNDED",
            entityType: "EscrowLedger",
            entityId: id,
            metadata: {
              taskId: task.id,
              amountCents: escrow.amountCents,
              disputeReason: escrow.disputeReason,
              resolution: resolution || "Dispute upheld — refund issued by ops",
            },
          },
        });

        // Notify household members
        const members = await tx.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });

        for (const member of members) {
          await tx.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.DISPUTE_RESOLVED,
              title: "Refund Issued",
              body: `Your dispute on the ${task.category.toLowerCase()} task has been upheld. A refund of SGD $${(escrow.amountCents / 100).toFixed(2)} will be processed.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          });
        }

        return { updatedEscrow };
      });

      return NextResponse.json({ escrow: result.updatedEscrow });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[/api/ops/escrow/[id] PATCH]", error);
    return NextResponse.json(
      { error: "Failed to process escrow action" },
      { status: 500 }
    );
  }
}
