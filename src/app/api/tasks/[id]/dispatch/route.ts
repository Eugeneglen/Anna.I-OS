import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { PLATFORM_COMMISSION_RATE } from "@/lib/constants"
import { autoSelectVendor } from "@/lib/routing"

const dispatchSchema = z.object({
  vendorId: z.string().min(1).optional(),
  scheduledStart: z.string().transform((v) => new Date(v)).optional(),
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

    const { scheduledStart, scheduledEnd } = parsed.data

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

    // Default scheduledStart to task.scheduledStart, then tomorrow 10am SGT
    const start = scheduledStart ?? task.scheduledStart ?? (function () {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(10, 0, 0, 0)
      return d
    })()

    // Resolve vendorId: use explicit vendorId or auto-select via routing engine
    let vendorId = parsed.data.vendorId
    let autoSelected = false

    if (!vendorId) {
      const suggestion = await autoSelectVendor(id)
      vendorId = suggestion.vendor.id
      autoSelected = true
    }

    const now = new Date()
    const amountCents = task.amountCents
    const commissionCents = Math.round((amountCents * PLATFORM_COMMISSION_RATE) / 100)
    const vendorPayoutCents = amountCents - commissionCents

    // C-1 FIX: Wrap all DB writes in a transaction for atomicity
    const result = await db.$transaction(async (tx) => {
      // Create Booking
      const booking = await tx.booking.create({
        data: {
          taskId: id,
          vendorId,
          scheduledStart: start,
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
      const escrow = await tx.escrowLedger.create({
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
      const updatedTask = await tx.task.update({
        where: { id },
        data: { status: TaskStatus.DISPATCHED, dispatchedAt: now },
        include: {
          bookings: { include: { vendor: { select: { id: true, name: true, email: true, phone: true, categories: true, status: true } } } },
          escrowEntries: true,
          jobType: { select: { id: true, name: true, slug: true } },
          quotation: { select: { id: true, totalCents: true, breakdown: true } },
        },
      })

      // Update or create VendorHouseholdAffinity
      await tx.vendorHouseholdAffinity.upsert({
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

      // H-5 FIX: Create notification for ALL household members
      const members = await tx.familyMember.findMany({
        where: { householdId: task.householdId },
        select: { id: true },
      })

      for (const member of members) {
        await tx.notification.create({
          data: {
            householdId: task.householdId,
            recipientType: RecipientType.HOUSEHOLD_MEMBER,
            memberId: member.id,
            channel: NotificationChannel.WHATSAPP,
            eventType: NotificationEventType.TASK_DISPATCHED,
            title: "Task Dispatched",
            body: autoSelected
              ? `Your ${task.category.toLowerCase()} task was auto-dispatched to ${booking.vendor.name}.`
              : `Your ${task.category.toLowerCase()} task has been dispatched to ${booking.vendor.name}.`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: task.id,
          },
        })
      }

      return { booking, escrow, updatedTask }
    })

    return NextResponse.json(
      { task: result.updatedTask, booking: result.booking, escrow: result.escrow, autoSelected },
      { status: 201 }
    )
  } catch (error) {
    console.error("POST /api/tasks/[id]/dispatch error:", error)
    const message = error instanceof Error ? error.message : "Failed to dispatch task"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}