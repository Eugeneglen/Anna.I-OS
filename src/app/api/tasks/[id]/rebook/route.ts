import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { guardTaskAccess, guardErrorResponse } from "@/lib/api-guards"
import { quoteJobType, stampTaskAmounts } from "@/lib/service-authority"

const REBOOKABLE_STATUSES = [TaskStatus.VERIFIED, TaskStatus.ESCROW_RELEASED]

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // ── F21 auth gate (audit C7 family) ── rebook clones the task into a
    // new booking: owning household or ops only.
    const guard = await guardTaskAccess(id)
    if (!guard.ok) return guardErrorResponse(guard)

    // Fetch original task
    const originalTask = await db.task.findUnique({ where: { id } })
    if (!originalTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // B-2 FIX: Only allow rebooking completed tasks
    if (!REBOOKABLE_STATUSES.includes(originalTask.status)) {
      return NextResponse.json(
        { error: `Only VERIFIED or ESCROW_RELEASED tasks can be rebooked — current status is ${originalTask.status}` },
        { status: 409 }
      )
    }

    // ── Service/Pricing/Availability Authority ──
    // A rebook is a NEW booking, so it re-prices from the LIVE catalogue
    // (the snapshot rule freezes existing bookings, not future ones).
    // The original quotation's configuration (units / field answers /
    // add-ons) is reused so the same scope is re-priced at the CURRENT
    // catalogue amount — never the historical amount (T6
    // historical-price contamination). A disabled service is not
    // rebookable, exactly like a fresh booking.
    let rebookAmountCents = originalTask.amountCents
    let rebookJobTypeId: string | null = originalTask.jobTypeId
    let pricingSource: string = "custom_request"
    if (originalTask.jobTypeId) {
      let fieldValues: Record<string, number> | undefined
      let selectedAddOns: string[] | undefined
      if (originalTask.quotationId) {
        const originalQuotation = await db.quotation.findUnique({
          where: { id: originalTask.quotationId },
          select: { fieldValues: true, selectedAddOns: true },
        })
        if (originalQuotation) {
          const fv = originalQuotation.fieldValues
          if (fv && typeof fv === "object" && !Array.isArray(fv)) {
            fieldValues = fv as Record<string, number>
          }
          const sa = originalQuotation.selectedAddOns
          if (Array.isArray(sa)) selectedAddOns = sa.filter((s): s is string => typeof s === "string")
        }
      }
      const authority = await quoteJobType(originalTask.jobTypeId, { fieldValues, selectedAddOns })
      if (!authority.ok) {
        if (authority.code === "INACTIVE") {
          return NextResponse.json(
            { error: `This service is currently unavailable on the Anna.I catalogue: ${authority.message}`, code: "JOB_TYPE_INACTIVE" },
            { status: 403 }
          )
        }
        return NextResponse.json(
          { error: "The catalogue service for this task no longer exists", code: "JOB_TYPE_NOT_FOUND" },
          { status: 409 }
        )
      }
      rebookAmountCents = authority.quote.totalCents
      rebookJobTypeId = authority.jobType.id
      pricingSource = "catalogue"
    }

    const stamped = stampTaskAmounts(rebookAmountCents, 0)

    // Clone the original task as a new one-off, re-priced at the CURRENT
    // catalogue amount. The discount code does not carry over (same as
    // before) — finalAmountCents is stamped so the task-amount invariant
    // holds on every writer.
    const newTask = await db.task.create({
      data: {
        householdId: originalTask.householdId,
        category: originalTask.category,
        status: TaskStatus.CREATED,
        instructions: originalTask.instructions,
        instructionsSource: "reused",
        amountCents: stamped.amountCents,
        finalAmountCents: stamped.finalAmountCents,
        jobTypeId: rebookJobTypeId,
        metadata: {
          pricingSource,
          rebookedFromTask: originalTask.id,
        },
        // Clear recurrence — new one-off
        recurrencePattern: null,
      },
    })

    // Create REBOOKING_PROMPT notification for ALL household members
    const members = await db.familyMember.findMany({
      where: { householdId: originalTask.householdId },
      select: { id: true },
    })

    for (const member of members) {
      await db.notification.create({
        data: {
          householdId: originalTask.householdId,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          memberId: member.id,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.REBOOKING_PROMPT,
          title: "Task Rebooked",
          body: `Your ${originalTask.category.toLowerCase()} task has been rebooked. It's ready to be dispatched.`,
          status: NotificationStatus.PENDING,
          referenceType: "task",
          referenceId: newTask.id,
        },
      })
    }

    return NextResponse.json({ task: newTask }, { status: 201 })
  } catch (error) {
    console.error("POST /api/tasks/[id]/rebook error:", error)
    return NextResponse.json(
      { error: "Failed to rebook task" },
      { status: 500 }
    )
  }
}