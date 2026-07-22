// ============================================================
// Anna.I — Vendor AI Tool Definitions
// ============================================================
// Scoped to a single vendor's own data.
// All tools are read-only (no write actions for Vendor AI).
// Per VENDOR_AI_README.md: help the vendor complete the job,
// get verified, and get paid — with minimum friction.
// ============================================================

import { CATEGORY_DEFAULTS, type ServiceCategory } from "./types";

// ─────────────────────────────────────────────────────────────
// Tool Definitions (OpenAI-compatible function calling format)
// ─────────────────────────────────────────────────────────────

export interface VendorToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * All available tools for Vendor AI.
 * All read-only — scoped to this vendor's own data.
 */
export const VENDOR_AI_TOOLS: VendorToolDefinition[] = [
  {
    name: "get_today_jobs",
    description:
      "Get today's assigned jobs: what's scheduled, status, customer details, addresses. Use when the vendor asks about today's schedule, what jobs are coming, or what they need to do today.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_job_details",
    description:
      "Get detailed information about a specific booking/job: instructions, verification requirements, customer address, assigned staff. Use when the vendor asks about a particular job or mentions a booking ID.",
    parameters: {
      type: "object",
      properties: {
        bookingId: {
          type: "string",
          description: "The booking ID to look up",
        },
      },
      required: ["bookingId"],
    },
  },
  {
    name: "get_schedule",
    description:
      "Get upcoming schedule: all future bookings in the next 7 days with status and details. Use when the vendor asks about upcoming jobs, this week's schedule, or what's coming next.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_earnings",
    description:
      "Get earnings summary: total earned, pending payout, this month's breakdown, recent payouts. Use when the vendor asks about money, payments, earnings, payout status, or when they'll get paid.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_performance",
    description:
      "Get performance overview: total jobs completed, average rating, recent ratings. Use when the vendor asks about their rating, performance score, how they're doing, or feedback.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_recent_bookings",
    description:
      "Get recently completed bookings with ratings and payout status. Use when the vendor asks about past jobs, recent history, or completed work.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

// ─────────────────────────────────────────────────────────────
// Tool Call Result Type
// ─────────────────────────────────────────────────────────────

export interface VendorToolCallResult {
  success: boolean;
  toolName: string;
  data?: Record<string, unknown>;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// Tool Executor — executes tool calls against the database
// ─────────────────────────────────────────────────────────────

export async function executeVendorToolCall(
  toolName: string,
  args: Record<string, unknown>,
  vendorId: string
): Promise<VendorToolCallResult> {
  switch (toolName) {
    case "get_today_jobs":
      return executeGetTodayJobs(vendorId);
    case "get_job_details":
      return executeGetJobDetails(args, vendorId);
    case "get_schedule":
      return executeGetSchedule(vendorId);
    case "get_earnings":
      return executeGetEarnings(vendorId);
    case "get_performance":
      return executeGetPerformance(vendorId);
    case "get_recent_bookings":
      return executeGetRecentBookings(vendorId);
    default:
      return {
        success: false,
        toolName,
        error: `Unknown tool: ${toolName}`,
      };
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function sgd(cents: number): string {
  return `SGD $${(cents / 100).toFixed(2)}`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-SG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getCategoryLabel(category: string): string {
  return (
    CATEGORY_DEFAULTS[category as ServiceCategory]?.label ?? category
  );
}

// ─────────────────────────────────────────────────────────────
// Tool Implementations
// ─────────────────────────────────────────────────────────────

async function executeGetTodayJobs(
  vendorId: string
): Promise<VendorToolCallResult> {
  const { db } = await import("@/lib/db");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const bookings = await db.booking.findMany({
    where: {
      vendorId,
      scheduledStart: { gte: todayStart, lte: todayEnd },
      status: { not: "cancelled" },
    },
    include: {
      task: {
        select: {
          category: true,
          amountCents: true,
          instructions: true,
          household: {
            select: { name: true, address: true, unitNumber: true },
          },
        },
      },
      assignedStaff: { select: { id: true, name: true } },
      verificationPhotos: { select: { id: true } },
    },
    orderBy: { scheduledStart: "asc" },
  });

  return {
    success: true,
    toolName: "get_today_jobs",
    data: {
      count: bookings.length,
      jobs: bookings.map((b) => ({
        bookingId: b.id,
        status: b.status,
        category: getCategoryLabel(b.task.category),
        scheduledTime: fmtTime(b.scheduledStart),
        amount: sgd(b.task.amountCents),
        instructions: b.task.instructions || null,
        customer: b.task.household.name,
        address: `${b.task.household.address}${b.task.household.unitNumber ? ` #${b.task.household.unitNumber}` : ""}`,
        assignedStaff: b.assignedStaff?.name || null,
        photosUploaded: b.verificationPhotos.length,
        verificationNeeded: b.status === "in_progress" || b.status === "completed",
      })),
    },
  };
}

async function executeGetJobDetails(
  args: Record<string, unknown>,
  vendorId: string
): Promise<VendorToolCallResult> {
  const { db } = await import("@/lib/db");

  const bookingId = args.bookingId as string;
  if (!bookingId) {
    return {
      success: false,
      toolName: "get_job_details",
      error: "Booking ID is required",
    };
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      task: {
        select: {
          category: true,
          amountCents: true,
          instructions: true,
          scheduledStart: true,
          household: {
            select: { name: true, address: true, unitNumber: true },
          },
        },
      },
      assignedStaff: { select: { id: true, name: true, role: true } },
      verificationPhotos: {
        select: { id: true, isVerified: true, uploadedBy: true, createdAt: true },
      },
      escrowEntries: {
        select: {
          amountCents: true,
          vendorPayoutCents: true,
          state: true,
          releasedAt: true,
        },
      },
    },
  });

  if (!booking) {
    return {
      success: false,
      toolName: "get_job_details",
      error: "Booking not found",
    };
  }

  if (booking.vendorId !== vendorId) {
    return {
      success: false,
      toolName: "get_job_details",
      error: "This booking belongs to a different vendor",
    };
  }

  const released = booking.escrowEntries
    .filter((e) => e.state === "RELEASED")
    .reduce((s, e) => s + e.vendorPayoutCents, 0);
  const held = booking.escrowEntries
    .filter((e) => e.state === "HELD")
    .reduce((s, e) => s + e.vendorPayoutCents, 0);
  const verifiedPhotos = booking.verificationPhotos.filter(
    (p) => p.isVerified
  ).length;

  return {
    success: true,
    toolName: "get_job_details",
    data: {
      bookingId: booking.id,
      status: booking.status,
      category: getCategoryLabel(booking.task.category),
      scheduledTime: fmtDateTime(booking.scheduledStart),
      amount: sgd(booking.task.amountCents),
      yourPayout: sgd(booking.task.amountCents * 0.9),
      instructions: booking.task.instructions || null,
      customer: booking.task.household.name,
      address: `${booking.task.household.address}${booking.task.household.unitNumber ? ` #${booking.task.household.unitNumber}` : ""}`,
      assignedStaff: booking.assignedStaff
        ? { name: booking.assignedStaff.name, role: booking.assignedStaff.role }
        : null,
      photosUploaded: booking.verificationPhotos.length,
      photosVerified: verifiedPhotos,
      allPhotosVerified: verifiedPhotos > 0 && verifiedPhotos === booking.verificationPhotos.length,
      payoutStatus: released > 0
        ? `Released: ${sgd(released)}`
        : held > 0
          ? `Pending: ${sgd(held)} (awaiting household verification)`
          : "Not yet created",
      verificationGuidance: buildVerificationGuidance(
        booking.status,
        booking.verificationPhotos.length,
        verifiedPhotos,
        released > 0
      ),
    },
  };
}

function buildVerificationGuidance(
  status: string,
  totalPhotos: number,
  verifiedPhotos: number,
  released: boolean
): string | null {
  if (released) return null;
  if (status === "in_progress" || status === "completed") {
    if (totalPhotos === 0) {
      return "Job is complete — upload before/after photos to trigger household verification. Without photos, payout won't be released.";
    }
    if (verifiedPhotos < totalPhotos) {
      return `${totalPhotos} photo(s) uploaded, ${verifiedPhotos} verified. Waiting for household to verify the remaining ${totalPhotos - verifiedPhotos}.`;
    }
    return "All photos verified. Payout should be released soon.";
  }
  if (status === "assigned" || status === "accepted") {
    return "Job hasn't started yet. Accept the booking, complete the job, then upload verification photos.";
  }
  return null;
}

async function executeGetSchedule(
  vendorId: string
): Promise<VendorToolCallResult> {
  const { db } = await import("@/lib/db");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const bookings = await db.booking.findMany({
    where: {
      vendorId,
      scheduledStart: { gte: todayStart, lte: weekEnd },
      status: { not: "cancelled" },
    },
    include: {
      task: {
        select: {
          category: true,
          amountCents: true,
          instructions: true,
          household: {
            select: { name: true, address: true, unitNumber: true },
          },
        },
      },
      assignedStaff: { select: { id: true, name: true } },
    },
    orderBy: { scheduledStart: "asc" },
  });

  // Group by day
  const byDay: Record<string, unknown[]> = {};
  for (const b of bookings) {
    const day = fmtDate(b.scheduledStart);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push({
      bookingId: b.id,
      status: b.status,
      category: getCategoryLabel(b.task.category),
      time: fmtTime(b.scheduledStart),
      amount: sgd(b.task.amountCents),
      customer: b.task.household.name,
      address: `${b.task.household.address}${b.task.household.unitNumber ? ` #${b.task.household.unitNumber}` : ""}`,
      assignedStaff: b.assignedStaff?.name || null,
    });
  }

  return {
    success: true,
    toolName: "get_schedule",
    data: {
      totalJobs: bookings.length,
      schedule: byDay,
    },
  };
}

async function executeGetEarnings(
  vendorId: string
): Promise<VendorToolCallResult> {
  const { db } = await import("@/lib/db");
  const { EscrowState } = await import("@prisma/client");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  // Parallel queries
  const [
    totalReleased,
    totalHeld,
    totalCompleted,
    thisMonthReleased,
    thisMonthCompleted,
    thisWeekReleased,
  ] = await Promise.all([
    db.escrowLedger.aggregate({
      where: {
        booking: { vendorId },
        state: EscrowState.RELEASED,
      },
      _sum: { vendorPayoutCents: true },
    }),
    db.escrowLedger.aggregate({
      where: {
        booking: { vendorId },
        state: EscrowState.HELD,
      },
      _sum: { vendorPayoutCents: true },
    }),
    db.booking.count({
      where: { vendorId, status: "completed" },
    }),
    db.escrowLedger.aggregate({
      where: {
        booking: { vendorId, completedAt: { gte: monthStart } },
        state: EscrowState.RELEASED,
      },
      _sum: { vendorPayoutCents: true },
    }),
    db.booking.count({
      where: {
        vendorId,
        status: "completed",
        completedAt: { gte: monthStart },
      },
    }),
    db.escrowLedger.aggregate({
      where: {
        releasedAt: { gte: weekStart },
        booking: { vendorId },
        state: EscrowState.RELEASED,
      },
      _sum: { vendorPayoutCents: true },
    }),
  ]);

  return {
    success: true,
    toolName: "get_earnings",
    data: {
      totalEarned: sgd(totalReleased._sum.vendorPayoutCents ?? 0),
      pendingPayout: sgd(totalHeld._sum.vendorPayoutCents ?? 0),
      totalCompleted,
      thisMonth: {
        earned: sgd(thisMonthReleased._sum.vendorPayoutCents ?? 0),
        jobsCompleted: thisMonthCompleted,
      },
      thisWeek: {
        released: sgd(thisWeekReleased._sum.vendorPayoutCents ?? 0),
      },
      payoutNote:
        "Payouts are released after household verifies your work photos. Held escrow means verification is still pending.",
    },
  };
}

async function executeGetPerformance(
  vendorId: string
): Promise<VendorToolCallResult> {
  const { db } = await import("@/lib/db");

  const [
    totalCompleted,
    ratingAgg,
    last10Ratings,
    acceptanceCount,
    totalAssigned,
  ] = await Promise.all([
    db.booking.count({
      where: { vendorId, status: "completed" },
    }),
    db.booking.aggregate({
      where: { vendorId, status: "completed", rating: { not: null } },
      _avg: { rating: true },
    }),
    db.booking.findMany({
      where: {
        vendorId,
        status: "completed",
        rating: { not: null },
      },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: {
        rating: true,
        completedAt: true,
        task: { select: { category: true } },
      },
    }),
    db.booking.count({
      where: { vendorId, status: "accepted" },
    }),
    db.booking.count({
      where: { vendorId },
    }),
  ]);

  const avgRating = ratingAgg._avg.rating ?? 0;
  const acceptanceRate =
    totalAssigned > 0
      ? Math.round((acceptanceCount / totalAssigned) * 100)
      : 0;

  return {
    success: true,
    toolName: "get_performance",
    data: {
      totalJobsCompleted: totalCompleted,
      averageRating: Math.round(avgRating * 100) / 100,
      ratingOutOf5: `${(Math.round(avgRating * 100) / 100).toFixed(1)} / 5.0`,
      totalAssigned,
      acceptanceRate: `${acceptanceRate}%`,
      recentRatings: last10Ratings.map((r) => ({
        category: getCategoryLabel(r.task.category),
        rating: r.rating,
        date: fmtDate(r.completedAt!),
      })),
    },
  };
}

async function executeGetRecentBookings(
  vendorId: string
): Promise<VendorToolCallResult> {
  const { db } = await import("@/lib/db");
  const { EscrowState } = await import("@prisma/client");

  const bookings = await db.booking.findMany({
    where: { vendorId, status: "completed" },
    orderBy: { completedAt: "desc" },
    take: 10,
    include: {
      task: {
        select: {
          category: true,
          amountCents: true,
          household: { select: { name: true } },
        },
      },
      escrowEntries: {
        select: { vendorPayoutCents: true, state: true },
      },
    },
  });

  return {
    success: true,
    toolName: "get_recent_bookings",
    data: {
      count: bookings.length,
      bookings: bookings.map((b) => {
        const released = b.escrowEntries
          .filter((e) => e.state === EscrowState.RELEASED)
          .reduce((s, e) => s + e.vendorPayoutCents, 0);
        const held = b.escrowEntries
          .filter((e) => e.state === EscrowState.HELD)
          .reduce((s, e) => s + e.vendorPayoutCents, 0);
        return {
          bookingId: b.id,
          category: getCategoryLabel(b.task.category),
          customer: b.task.household.name,
          completedAt: b.completedAt ? fmtDate(b.completedAt) : null,
          rating: b.rating ?? null,
          payout: released > 0 ? sgd(released) : held > 0 ? `${sgd(held)} (pending)` : "—",
          payoutStatus: released > 0 ? "released" : held > 0 ? "held" : "none",
        };
      }),
    },
  };
}
