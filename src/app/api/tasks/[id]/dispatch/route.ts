import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { PLATFORM_COMMISSION_RATE } from "@/lib/constants"

const dispatchSchema = z.object({
  vendorId: z.string().min(1),
  scheduledStart: z.string().transform((v) => new Date(v)),
  scheduledEnd: z.string().transform((v) => new Date(v)).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const parsed = dispatchSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { vendorId, scheduledStart, scheduledEnd } = parsed.data

    // Validate task exists and is in CREATED status
    const task = await db.task.findUnique({ where: { id } })
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }
    if (task.status !== TaskStatus.CREATED) {
      return NextResponse.json(
        { error: `Task cannot be dispatched — current status is ${task.status}` },
        { status: 409 }
      )
    }

    const now = new Date()
    const amountCents = task.amountCents
    const commissionCents = Math.round((amountCents * PLATFORM_COMMISSION_RATE) / 100)
    const vendorPayoutCents = amountCents - commissionCents

    // Create Booking
    const booking = await db.booking.create({
      data: {
        taskId: id,
        vendorId,
        scheduledStart,
        scheduledEnd: scheduledEnd ?? null,
        status: "assigned",
        dispatchedAt: now,
      },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            categories: true,
            status: true,
          },
        },
      },
    })

    // Create EscrowLedger
    const escrow = await db.escrowLedger.create({
      data: {
        taskId: id,
        bookingId: booking.id,
        amountCents,
        state: "HELD",
        commissionRate: PLATFORM_COMMISSION_RATE,
        commissionCents,
        vendorPayoutCents,
        heldAt: now,
      },
    })

    // Update task status
    await db.task.update({
      where: { id },
      data: { status: TaskStatus.DISPATCHED, dispatchedAt: now },
    })

    // Update or create VendorHouseholdAffinity
    await db.vendorHouseholdAffinity.upsert({
      where: {
        householdId_vendorId_category: {
          householdId: task.householdId,
          vendorId,
          category: task.category,
        },
      },
      create: {
        householdId: task.householdId,
        vendorId,
        category: task.category,
        bookingCount: 1,
        lastAssignedAt: now,
      },
      update: {
        bookingCount: { increment: 1 },
        lastAssignedAt: now,
      },
    })

    // Create notification for household members
    const members = await db.familyMember.findMany({
      where: { householdId: task.householdId },
      select: { id: true },
    })

    const firstMember = members[0]
    if (firstMember) {
      await db.notification.create({
        data: {
          householdId: task.householdId,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          memberId: firstMember.id,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.TASK_DISPATCHED,
          title: "Task Dispatched",
          body: `Your ${task.category.toLowerCase()} task has been dispatched to ${booking.vendor.name}.`,
          status: NotificationStatus.PENDING,
          referenceType: "task",
          referenceId: task.id,
        },
      })
    }

    return NextResponse.json({ task: { ...task, status: TaskStatus.DISPATCHED, dispatchedAt: now }, booking, escrow }, { status: 201 })
  } catch (error) {
    console.error("POST /api/tasks/[id]/dispatch error:", error)
    return NextResponse.json(
      { error: "Failed to dispatch task" },
      { status: 500 }
    )
  }
}