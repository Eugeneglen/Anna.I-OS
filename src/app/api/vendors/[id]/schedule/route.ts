import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireVendorOwnership, requireVendorPermission, vendorJson } from "@/lib/vendor-guard"
import { pickPrimaryEscrowEntry } from "@/lib/escrow-display"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // ── IDOR protection: verify authenticated vendor owns this resource ──
    const auth = await requireVendorOwnership(id)
    if (!auth.success) return auth.response

    // ── P5 (AUDIT-4): RBAC gate — the schedule view requires
    // v_schedule:view (all vendor roles hold it; this establishes the
    // permission pattern for this route family).
    const permAuth = await requireVendorPermission("v_schedule", "view")
    if (!permAuth.success) return permAuth.response

    const { searchParams } = new URL(request.url)

    const statusParam = searchParams.get("status")
    const fromParam = searchParams.get("from")
    const toParam = searchParams.get("to")
    const categoryParam = searchParams.get("category")
    const searchParam = searchParams.get("search")

    // Parse comma-separated status filter
    const statuses = statusParam
      ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined

    // Parse date filters
    const from = fromParam ? new Date(fromParam) : undefined
    const to = toParam ? new Date(toParam) : undefined

    // Fetch vendor info
    const vendor = await db.vendor.findUnique({
      where: { id: auth.vendorId },
      select: {
        id: true,
        name: true,
        vendorType: true,
        staffCount: true,
      },
    })

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
    }

    // Build where clause
    const where: Record<string, unknown> = { vendorId: auth.vendorId }

    if (statuses && statuses.length > 0) {
      where.status = { in: statuses }
    }

    if (from || to) {
      const scheduledFilter: Record<string, unknown> = {}
      if (from) scheduledFilter.gte = from
      if (to) scheduledFilter.lte = to
      where.scheduledStart = scheduledFilter
    }

    if (categoryParam) {
      where.task = { ...where.task as Record<string, unknown>, category: categoryParam }
    }

    if (searchParam) {
      where.task = {
        ...where.task as Record<string, unknown>,
        household: {
          ...((where.task as Record<string, unknown>)?.household as Record<string, unknown> ?? {}),
          OR: [
            // NOTE: `mode: "insensitive"` is a PostgreSQL-only Prisma argument —
            // on SQLite (dev/sandbox datasource) it throws
            // PrismaClientValidationError "Unknown argument `mode`" and 500s
            // the whole schedule view. SQLite LIKE is ASCII-case-insensitive
            // by default, so a plain `contains` keeps search working on both
            // providers (matching the ops bookings/escrow search style).
            { name: { contains: searchParam } },
            { address: { contains: searchParam } },
          ],
        },
      }
    }

    // Fetch bookings with task details and photo counts
    const bookings = await db.booking.findMany({
      where,
      orderBy: { scheduledStart: "desc" },
      include: {
        task: {
          select: {
            id: true,
            category: true,
            instructions: true,
            amountCents: true,
            discountCents: true,
            finalAmountCents: true,
            status: true,
            disputedAt: true,
            jobNo: true,
            // ── Service/Pricing/Availability Authority ── the vendor sees
            // the SPECIFIC booked catalogue service, not just a category.
            jobType: {
              select: { id: true, name: true, slug: true, unitLabel: true, description: true },
            },
            household: {
              select: {
                id: true,
                name: true,
                address: true,
              },
            },
            escrowEntries: {
              select: {
                id: true,
                state: true,
                bookingId: true,
                heldAt: true,
                amountCents: true,
                originalAmountCents: true,
                discountCents: true,
                discountFundedBy: true,
                refundCents: true,
                commissionCents: true,
                vendorPayoutCents: true,
                releasedAt: true,
                disputeReason: true,
                disputeResolution: true,
                disputeResolvedAt: true,
              },
              orderBy: { heldAt: "asc" },
            },
            attachments: {
              select: { id: true, fileType: true, fileUrl: true, thumbnailUrl: true, fileName: true },
            },
          },
        },
        verificationPhotos: {
          select: { id: true, fileUrl: true, thumbnailUrl: true, uploadedBy: true, isVerified: true },
        },
        assignedStaff: {
          select: {
            id: true,
            name: true,
            role: true,
            contact: true,
          },
        },
        addons: {
          select: {
            id: true,
            description: true,
            amountCents: true,
            status: true,
          },
        },
      },
    })

    // Shape response with photo count, task status, and escrow info
    const schedule = bookings.map((b) => ({
      id: b.id,
      status: b.status,
      scheduledStart: b.scheduledStart,
      scheduledEnd: b.scheduledEnd,
      actualStart: b.actualStart,
      actualEnd: b.actualEnd,
      acceptedAt: b.acceptedAt,
      completedAt: b.completedAt,
      cancelledAt: b.cancelledAt,
      rating: b.rating,
      ratingComment: b.ratingComment,
      completionNotes: b.completionNotes,
      category: b.task.category,
      // ── Service/Pricing/Availability Authority ── specific booked
      // service + scope + the customer-approved amount as the headline
      // figure (finalAmountCents; amountCents kept for the pre-discount
      // breakdown, matching the escrow stamp).
      service: b.task.jobType
        ? {
            jobTypeId: b.task.jobType.id,
            name: b.task.jobType.name,
            slug: b.task.jobType.slug,
            unitLabel: b.task.jobType.unitLabel,
            scope: b.task.jobType.description,
          }
        : null,
      jobNo: b.task.jobNo,
      instructions: b.task.instructions,
      amountCents: b.task.amountCents,
      discountCents: b.task.discountCents,
      finalAmountCents: b.task.finalAmountCents,
      approvedAmountCents: b.task.finalAmountCents || b.task.amountCents,
      householdName: b.task.household.name,
      address: b.task.household.address,
      verificationPhotoCount: b.verificationPhotos.length,
      verificationPhotos: b.verificationPhotos,
      assignedStaff: b.assignedStaff,
      // Approved addon total for dynamic amount calculation
      approvedAddonsTotal: (b.addons || [])
        .filter((a) => a.status === "approved")
        .reduce((sum, a) => sum + a.amountCents, 0),
      addons: b.addons || [],
      // Customer-uploaded attachments (photos/videos from household)
      customerAttachments: b.task.attachments || [],
      // Task-level status and escrow info for dispute awareness
      taskStatus: b.task.status,
      taskDisputedAt: b.task.disputedAt,
      // ── F-8 (Item 8): the escrow entry this card should display/act on ──
      // BOOKING-SCOPED and live-first via the shared selector — never the
      // raw escrowEntries[0] (the OLDEST row). After a cancel → rematch the
      // task's oldest entry is VOIDED and a NEW live hold exists for the
      // rematch booking: [0] displayed (and acted on) the dead entry.
      escrow: pickPrimaryEscrowEntry(b.task.escrowEntries, { bookingId: b.id }),
      // All escrow entries (base + add-ons) for full refund/remaining computation
      escrowEntries: b.task.escrowEntries ?? [],
    }))

    // Count by status for filter pills (computed on unfiltered data)
    const allBookings = await db.booking.findMany({
      where: { vendorId: auth.vendorId },
      select: { status: true },
    })
    const statusCounts = allBookings.reduce<Record<string, number>>((acc, b) => {
      acc[b.status] = (acc[b.status] || 0) + 1
      return acc
    }, {})
    const statusCountsArr = Object.entries(statusCounts).map(([status, count]) => ({
      status,
      count,
    }))

    return vendorJson({
      vendor,
      schedule,
      total: schedule.length,
      statusCounts: statusCountsArr,
    }, auth.vendorId)
  } catch (error) {
    console.error("GET /api/vendors/[id]/schedule error:", error)
    return NextResponse.json(
      { error: "Failed to fetch vendor schedule" },
      { status: 500 }
    )
  }
}