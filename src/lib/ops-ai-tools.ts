// ============================================================
// Anna.I — Ops AI Tool Definitions
// ============================================================
// Platform-wide visibility — all households, vendors, bookings,
// escrow, anomalies, autonomy. All read-only per OPS_AI_README.md:
// ops staff have visibility, not unilateral action authority.
// ============================================================

import { CATEGORY_DEFAULTS, type ServiceCategory } from "./types";

// ─────────────────────────────────────────────────────────────
// Tool Definitions (OpenAI-compatible function calling format)
// ─────────────────────────────────────────────────────────────

export interface OpsToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * All available tools for Ops AI.
 * All read-only — no write actions. Visibility ≠ authority.
 */
export const OPS_AI_TOOLS: OpsToolDefinition[] = [
  {
    name: "get_platform_summary",
    description:
      "Get platform-wide KPI summary: total households, vendors, active bookings, escrow state, task status distribution. Use for general platform health checks, dashboard-style overviews, or 'how is the platform doing?' questions.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_vendor_overview",
    description:
      "Get all vendors with key metrics: status, type, capacity utilisation, ratings, completed jobs, zones. Use when asked about vendor fleet health, which vendors are underperforming, or vendor landscape overview.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            'Optional filter by vendor status: ACTIVE, PENDING, SUSPENDED. Leave empty for all.',
          enum: ["ACTIVE", "PENDING", "SUSPENDED"],
        },
      },
    },
  },
  {
    name: "get_vendor_detail",
    description:
      "Get detailed information about a specific vendor: profile, staff, bookings stats, earnings breakdown, recent ratings, verification compliance. Use when asking about a particular vendor by name or ID.",
    parameters: {
      type: "object",
      properties: {
        vendorId: {
          type: "string",
          description: "The vendor ID to look up",
        },
      },
      required: ["vendorId"],
    },
  },
  {
    name: "get_household_overview",
    description:
      "Get all households with autonomy levels, task counts, spending. Use when asked about household landscape, autonomy distribution, or which households need attention.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_household_detail",
    description:
      "Get detailed information about a specific household: profile, autonomy levels per category, task history, spending, preferences, active bookings. Use when asking about a particular household by name or ID.",
    parameters: {
      type: "object",
      properties: {
        householdId: {
          type: "string",
          description: "The household ID to look up",
        },
      },
      required: ["householdId"],
    },
  },
  {
    name: "get_booking_health",
    description:
      "Get booking pipeline health: active bookings by status, acceptance rate, completion rate, average time-to-complete. Use when asked about booking pipeline, dispatch success, or completion metrics.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_anomaly_report",
    description:
      "Get active and recent anomalies: type, severity, affected entity, timestamp, status. Use when asked about platform issues, anomalies, or things needing attention.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Optional filter: ACTIVE, RESOLVED, ACKNOWLEDGED. Leave empty for recent all.",
          enum: ["ACTIVE", "RESOLVED", "ACKNOWLEDGED"],
        },
      },
    },
  },
  {
    name: "get_escrow_summary",
    description:
      "Get escrow state across the platform: total held, total released, total disputed, pending releases. Use when asked about money, escrow, payouts, or financial health.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_autonomy_distribution",
    description:
      "Get autonomy level distribution across households per category: how many households at each level (1-5). Use when asked about autonomy promotion progress, household maturity, or Memory mechanism effectiveness.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_vendor_search",
    description:
      "Search for a vendor by name or email. Returns matching vendor(s) with basic profile info. Use when the ops user mentions a vendor by name or email but doesn't have the ID.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Vendor name or email to search for",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_household_search",
    description:
      "Search for a household by name or email. Returns matching household(s) with basic info. Use when the ops user mentions a household by name or email but doesn't have the ID.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Household name or email to search for",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_recent_activity",
    description:
      "Get recent platform activity: latest bookings, task completions, escrow releases, vendor sign-ups. Use when asked about recent activity, what happened today, or a timeline of events.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

// ─────────────────────────────────────────────────────────────
// Tool Call Result Type
// ─────────────────────────────────────────────────────────────

export interface OpsToolCallResult {
  success: boolean;
  toolName: string;
  data?: Record<string, unknown>;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// Tool Executor — executes tool calls against the database
// ─────────────────────────────────────────────────────────────

export async function executeOpsToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<OpsToolCallResult> {
  switch (toolName) {
    case "get_platform_summary":
      return executePlatformSummary();
    case "get_vendor_overview":
      return executeVendorOverview(args);
    case "get_vendor_detail":
      return executeVendorDetail(args);
    case "get_household_overview":
      return executeHouseholdOverview();
    case "get_household_detail":
      return executeHouseholdDetail(args);
    case "get_booking_health":
      return executeBookingHealth();
    case "get_anomaly_report":
      return executeAnomalyReport(args);
    case "get_escrow_summary":
      return executeEscrowSummary();
    case "get_autonomy_distribution":
      return executeAutonomyDistribution();
    case "get_vendor_search":
      return executeVendorSearch(args);
    case "get_household_search":
      return executeHouseholdSearch(args);
    case "get_recent_activity":
      return executeRecentActivity();
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

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

// ─────────────────────────────────────────────────────────────
// Tool Implementations
// ─────────────────────────────────────────────────────────────

async function executePlatformSummary(): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");
  const { EscrowState } = await import("@prisma/client");

  const [
    totalHouseholds,
    totalVendors,
    activeVendors,
    pendingVendors,
    totalTasks,
    tasksByStatus,
    escrowHeld,
    escrowReleased,
    escrowDisputed,
    heldCount,
    releasedCount,
    disputedCount,
    totalBookings,
    activeBookings,
  ] = await Promise.all([
    db.household.count(),
    db.vendor.count(),
    db.vendor.count({ where: { status: "ACTIVE" } }),
    db.vendor.count({ where: { status: "PENDING" } }),
    db.task.count(),
    db.task.groupBy({ by: ["status"], _count: true }),
    db.escrowLedger.aggregate({
      where: { state: EscrowState.HELD },
      _sum: { amountCents: true },
    }),
    db.escrowLedger.aggregate({
      where: { state: EscrowState.RELEASED },
      _sum: { amountCents: true },
    }),
    db.escrowLedger.aggregate({
      where: { state: EscrowState.DISPUTED },
      _sum: { amountCents: true },
    }),
    db.escrowLedger.count({ where: { state: EscrowState.HELD } }),
    db.escrowLedger.count({ where: { state: EscrowState.RELEASED } }),
    db.escrowLedger.count({ where: { state: EscrowState.DISPUTED } }),
    db.booking.count(),
    db.booking.count({
      where: { status: { in: ["assigned", "accepted", "in_progress"] } },
    }),
  ]);

  const statusBreakdown: Record<string, number> = {};
  for (const s of tasksByStatus) {
    statusBreakdown[s.status] = s._count;
  }

  return {
    success: true,
    toolName: "get_platform_summary",
    data: {
      households: { total: totalHouseholds },
      vendors: {
        total: totalVendors,
        active: activeVendors,
        pending: pendingVendors,
        suspended: totalVendors - activeVendors - pendingVendors,
      },
      tasks: {
        total: totalTasks,
        statusBreakdown,
      },
      bookings: {
        total: totalBookings,
        active: activeBookings,
      },
      escrow: {
        held: sgd(escrowHeld._sum.amountCents ?? 0),
        heldCount: heldCount,
        released: sgd(escrowReleased._sum.amountCents ?? 0),
        releasedCount: releasedCount,
        disputed: sgd(escrowDisputed._sum.amountCents ?? 0),
        disputedCount: disputedCount,
      },
    },
  };
}

async function executeVendorOverview(
  args: Record<string, unknown>
): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");

  const where = args.status ? { status: args.status as string } : {};

  const vendors = await db.vendor.findMany({
    where,
    include: {
      _count: {
        select: {
          bookings: true,
          staff: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Aggregate ratings per vendor
  const vendorIds = vendors.map((v) => v.id);
  const ratingAgg = vendorIds.length > 0
    ? await db.booking.groupBy({
        by: ["vendorId"],
        where: { vendorId: { in: vendorIds }, rating: { not: null }, status: "completed" },
        _avg: { rating: true },
        _count: true,
      })
    : [];

  const completedAgg = vendorIds.length > 0
    ? await db.booking.groupBy({
        by: ["vendorId"],
        where: { vendorId: { in: vendorIds }, status: "completed" },
        _count: true,
      })
    : [];

  const ratingMap = Object.fromEntries(ratingAgg.map((r) => [r.vendorId, r]));
  const completedMap = Object.fromEntries(completedAgg.map((c) => [c.vendorId, c._count]));

  return {
    success: true,
    toolName: "get_vendor_overview",
    data: {
      count: vendors.length,
      vendors: vendors.map((v) => {
        const r = ratingMap[v.id];
        const completed = completedMap[v.id] ?? 0;
        const utilisation =
          v.maxTasksPerWeek > 0
            ? Math.round((completed / v.maxTasksPerWeek) * 100)
            : 0;
        return {
          vendorId: v.id,
          name: v.name,
          email: v.email,
          type: v.vendorType,
          status: v.status,
          staffCount: v._count.staff,
          totalBookings: v._count.bookings,
          completedJobs: completed,
          avgRating: r ? Math.round(r._avg.rating! * 100) / 100 : null,
          weeklyUtilisation: `${Math.min(utilisation, 100)}%`,
          categories: v.categories,
          zones: v.zones,
        };
      }),
    },
  };
}

async function executeVendorDetail(
  args: Record<string, unknown>
): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");
  const { EscrowState } = await import("@prisma/client");

  const vendorId = args.vendorId as string;
  if (!vendorId) {
    return {
      success: false,
      toolName: "get_vendor_detail",
      error: "Vendor ID is required",
    };
  }

  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },
    include: {
      _count: {
        select: {
          bookings: true,
          staff: true,
          vendorAffinity: true,
        },
      },
    },
  });

  if (!vendor) {
    return {
      success: false,
      toolName: "get_vendor_detail",
      error: "Vendor not found",
    };
  }

  // Parallel stat queries
  const [
    completedCount,
    activeCount,
    cancelledCount,
    ratingAgg,
    last10Bookings,
    escrowReleased,
    escrowHeld,
    escrowDisputed,
  ] = await Promise.all([
    db.booking.count({ where: { vendorId, status: "completed" } }),
    db.booking.count({ where: { vendorId, status: { in: ["assigned", "accepted", "in_progress"] } } }),
    db.booking.count({ where: { vendorId, status: "cancelled" } }),
    db.booking.aggregate({
      where: { vendorId, status: "completed", rating: { not: null } },
      _avg: { rating: true },
    }),
    db.booking.findMany({
      where: { vendorId, status: "completed" },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: {
        id: true,
        rating: true,
        completedAt: true,
        scheduledStart: true,
        task: { select: { category: true, amountCents: true } },
      },
    }),
    db.escrowLedger.aggregate({
      where: { booking: { vendorId }, state: EscrowState.RELEASED },
      _sum: { vendorPayoutCents: true },
    }),
    db.escrowLedger.aggregate({
      where: { booking: { vendorId }, state: EscrowState.HELD },
      _sum: { vendorPayoutCents: true },
    }),
    db.escrowLedger.aggregate({
      where: { booking: { vendorId }, state: EscrowState.DISPUTED },
      _sum: { amountCents: true },
    }),
  ]);

  const acceptanceRate =
    vendor._count.bookings > 0
      ? Math.round(((completedCount + activeCount) / vendor._count.bookings) * 100)
      : 0;

  return {
    success: true,
    toolName: "get_vendor_detail",
    data: {
      vendorId: vendor.id,
      name: vendor.name,
      email: vendor.email,
      phone: vendor.phone,
      type: vendor.vendorType,
      status: vendor.status,
      staffCount: vendor._count.staff,
      categories: vendor.categories,
      zones: vendor.zones,
      dailyCapacity: vendor.maxTasksPerDay,
      weeklyCapacity: vendor.maxTasksPerWeek,
      stats: {
        totalBookings: vendor._count.bookings,
        completed: completedCount,
        active: activeCount,
        cancelled: cancelledCount,
        acceptanceRate: `${acceptanceRate}%`,
        avgRating: ratingAgg._avg.rating
          ? Math.round(ratingAgg._avg.rating * 100) / 100
          : null,
      },
      earnings: {
        totalReleased: sgd(escrowReleased._sum.vendorPayoutCents ?? 0),
        pendingPayout: sgd(escrowHeld._sum.vendorPayoutCents ?? 0),
        disputed: sgd(escrowDisputed._sum.amountCents ?? 0),
      },
      recentBookings: last10Bookings.map((b) => ({
        bookingId: b.id,
        category: getCategoryLabel(b.task.category),
        amount: sgd(b.task.amountCents),
        rating: b.rating ?? null,
        completedAt: b.completedAt ? fmtDate(b.completedAt) : null,
      })),
    },
  };
}

async function executeHouseholdOverview(): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");

  const households = await db.household.findMany({
    include: {
      _count: {
        select: {
          tasks: true,
          anomalies: true,
          notifications: true,
          quotations: true,
        },
      },
      categoryAutonomy: {
        select: { category: true, currentLevel: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    success: true,
    toolName: "get_household_overview",
    data: {
      count: households.length,
      households: households.map((h) => ({
        householdId: h.id,
        name: h.name,
        email: h.email,
        address: h.address,
        postalCode: h.postalCode ?? null,
        unitNumber: h.unitNumber ?? null,
        totalTasks: h._count.tasks,
        activeAnomalies: h._count.anomalies,
        autonomyLevels: Object.fromEntries(
          h.categoryAutonomy.map((a) => [getCategoryLabel(a.category), a.currentLevel])
        ),
      })),
    },
  };
}

async function executeHouseholdDetail(
  args: Record<string, unknown>
): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");

  const householdId = args.householdId as string;
  if (!householdId) {
    return {
      success: false,
      toolName: "get_household_detail",
      error: "Household ID is required",
    };
  }

  const household = await db.household.findUnique({
    where: { id: householdId },
    include: {
      categoryAutonomy: {
        select: {
          category: true,
          currentLevel: true,
          verifiedCyclesAtLevel: true,
          totalVerifiedCycles: true,
          promotionPaused: true,
          lastPromotedAt: true,
        },
        orderBy: { category: "asc" },
      },
      _count: {
        select: {
          tasks: true,
          anomalies: true,
          notifications: true,
          members: true,
          quotations: true,
        },
      },
    },
  });

  if (!household) {
    return {
      success: false,
      toolName: "get_household_detail",
      error: "Household not found",
    };
  }

  // Task stats
  const tasksByStatus = await db.task.groupBy({
    by: ["status"],
    where: { householdId },
    _count: true,
  });

  const totalSpending = await db.task.aggregate({
    where: { householdId, status: "COMPLETED" },
    _sum: { amountCents: true },
  });

  const activeBookings = await db.booking.count({
    where: {
      task: { householdId },
      status: { in: ["assigned", "accepted", "in_progress"] },
    },
  });

  const statusBreakdown: Record<string, number> = {};
  for (const s of tasksByStatus) {
    statusBreakdown[s.status] = s._count;
  }

  return {
    success: true,
    toolName: "get_household_detail",
    data: {
      householdId: household.id,
      name: household.name,
      email: household.email,
      phone: household.phone ?? null,
      address: household.address,
      postalCode: household.postalCode ?? null,
      unitNumber: household.unitNumber ?? null,
      preferences: household.preferences,
      totalTasks: household._count.tasks,
      activeBookings,
      activeAnomalies: household._count.anomalies,
      totalSpending: sgd(totalSpending._sum.amountCents ?? 0),
      tasksByStatus: statusBreakdown,
      autonomyLevels: household.categoryAutonomy.map((a) => ({
        category: getCategoryLabel(a.category),
        level: a.currentLevel,
        verifiedCyclesAtLevel: a.verifiedCyclesAtLevel,
        totalVerifiedCycles: a.totalVerifiedCycles,
        promotionPaused: a.promotionPaused,
        lastPromotedAt: a.lastPromotedAt ? fmtDate(a.lastPromotedAt) : null,
      })),
      memberCount: household._count.members,
    },
  };
}

async function executeBookingHealth(): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");

  const [
    totalBookings,
    bookingsByStatus,
    totalAssigned,
    totalAccepted,
    totalCompleted,
    totalCancelled,
    avgTimeToComplete,
  ] = await Promise.all([
    db.booking.count(),
    db.booking.groupBy({ by: ["status"], _count: true }),
    db.booking.count({ where: { status: "assigned" } }),
    db.booking.count({ where: { status: "accepted" } }),
    db.booking.count({ where: { status: "completed" } }),
    db.booking.count({ where: { status: "cancelled" } }),
    // Average time from scheduled start to completion
    db.booking.aggregate({
      where: {
        status: "completed",
        scheduledStart: { not: null },
        completedAt: { not: null },
      },
      _avg: {
        completedAt: true,
      },
    }),
  ]);

  const statusBreakdown: Record<string, number> = {};
  for (const s of bookingsByStatus) {
    statusBreakdown[s.status] = s._count;
  }

  const acceptanceRate = pct(totalAccepted, totalAssigned);
  const completionRate = pct(totalCompleted, totalBookings);
  const cancellationRate = pct(totalCancelled, totalBookings);

  return {
    success: true,
    toolName: "get_booking_health",
    data: {
      totalBookings,
      statusBreakdown,
      activeBookings: totalAssigned + totalAccepted,
      metrics: {
        acceptanceRate,
        completionRate,
        cancellationRate,
      },
    },
  };
}

async function executeAnomalyReport(
  args: Record<string, unknown>
): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");

  const where = args.status ? { status: args.status as string } : {};

  const anomalies = await db.anomaly.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      type: true,
      severity: true,
      status: true,
      message: true,
      householdId: true,
      createdAt: true,
      resolvedAt: true,
    },
  });

  return {
    success: true,
    toolName: "get_anomaly_report",
    data: {
      count: anomalies.length,
      anomalies: anomalies.map((a) => ({
        anomalyId: a.id,
        type: a.type,
        severity: a.severity,
        status: a.status,
        message: a.message,
        householdId: a.householdId,
        createdAt: fmtDateTime(a.createdAt),
        resolvedAt: a.resolvedAt ? fmtDateTime(a.resolvedAt) : null,
      })),
    },
  };
}

async function executeEscrowSummary(): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");
  const { EscrowState } = await import("@prisma/client");

  const [
    totalHeld,
    totalReleased,
    totalDisputed,
    totalRefunded,
    heldCount,
    releasedCount,
    disputedCount,
    totalEntries,
  ] = await Promise.all([
    db.escrowLedger.aggregate({
      where: { state: EscrowState.HELD },
      _sum: { amountCents: true },
    }),
    db.escrowLedger.aggregate({
      where: { state: EscrowState.RELEASED },
      _sum: { amountCents: true, vendorPayoutCents: true },
    }),
    db.escrowLedger.aggregate({
      where: { state: EscrowState.DISPUTED },
      _sum: { amountCents: true },
    }),
    db.escrowLedger.aggregate({
      where: { state: EscrowState.REFUNDED },
      _sum: { amountCents: true },
    }),
    db.escrowLedger.count({ where: { state: EscrowState.HELD } }),
    db.escrowLedger.count({ where: { state: EscrowState.RELEASED } }),
    db.escrowLedger.count({ where: { state: EscrowState.DISPUTED } }),
    db.escrowLedger.count(),
  ]);

  const totalPlatformValue = (totalHeld._sum.amountCents ?? 0) +
    (totalReleased._sum.amountCents ?? 0) +
    (totalDisputed._sum.amountCents ?? 0) +
    (totalRefunded._sum.amountCents ?? 0);

  return {
    success: true,
    toolName: "get_escrow_summary",
    data: {
      totalEntries,
      platformValue: sgd(totalPlatformValue),
      held: {
        amount: sgd(totalHeld._sum.amountCents ?? 0),
        entries: heldCount,
      },
      released: {
        amount: sgd(totalReleased._sum.amountCents ?? 0),
        vendorPayout: sgd(totalReleased._sum.vendorPayoutCents ?? 0),
        entries: releasedCount,
      },
      disputed: {
        amount: sgd(totalDisputed._sum.amountCents ?? 0),
        entries: disputedCount,
      },
      refunded: {
        amount: sgd(totalRefunded._sum.amountCents ?? 0),
      },
    },
  };
}

async function executeAutonomyDistribution(): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");

  // Get all autonomy records grouped by level
  const allLevels = await db.householdCategoryAutonomy.groupBy({
    by: ["currentLevel"],
    _count: { id: true },
  });

  const levelCounts: Record<number, number> = {};
  for (const l of allLevels) {
    levelCounts[l.currentLevel] = l._count.id;
  }

  // Per-category breakdown
  const categoryBreakdown = await db.householdCategoryAutonomy.groupBy({
    by: ["category", "currentLevel"],
    _count: { id: true },
  });

  const byCategory: Record<string, Record<number, number>> = {};
  for (const c of categoryBreakdown) {
    const label = getCategoryLabel(c.category);
    if (!byCategory[label]) byCategory[label] = {};
    byCategory[label][c.currentLevel] = c._count.id;
  }

  const totalRecords = allLevels.reduce((s, l) => s + l._count.id, 0);

  return {
    success: true,
    toolName: "get_autonomy_distribution",
    data: {
      totalHouseholdCategories: totalRecords,
      distribution: {
        level1: levelCounts[1] ?? 0,
        level2: levelCounts[2] ?? 0,
        level3: levelCounts[3] ?? 0,
        level4: levelCounts[4] ?? 0,
        level5: levelCounts[5] ?? 0,
      },
      percentages: {
        level1: pct(levelCounts[1] ?? 0, totalRecords),
        level2: pct(levelCounts[2] ?? 0, totalRecords),
        level3: pct(levelCounts[3] ?? 0, totalRecords),
        level4: pct(levelCounts[4] ?? 0, totalRecords),
        level5: pct(levelCounts[5] ?? 0, totalRecords),
      },
      byCategory,
    },
  };
}

async function executeVendorSearch(
  args: Record<string, unknown>
): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");

  const query = (args.query as string).trim();
  if (!query) {
    return {
      success: false,
      toolName: "get_vendor_search",
      error: "Query is required",
    };
  }

  const vendors = await db.vendor.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { email: { contains: query } },
      ],
    },
    take: 10,
    select: {
      id: true,
      name: true,
      email: true,
      type: true,
      status: true,
    },
  });

  return {
    success: true,
    toolName: "get_vendor_search",
    data: {
      count: vendors.length,
      vendors: vendors.map((v) => ({
        vendorId: v.id,
        name: v.name,
        email: v.email,
        type: v.vendorType,
        status: v.status,
      })),
    },
  };
}

async function executeHouseholdSearch(
  args: Record<string, unknown>
): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");

  const query = (args.query as string).trim();
  if (!query) {
    return {
      success: false,
      toolName: "get_household_search",
      error: "Query is required",
    };
  }

  const households = await db.household.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { email: { contains: query } },
      ],
    },
    take: 10,
    select: {
      id: true,
      name: true,
      email: true,
      address: true,
    },
  });

  return {
    success: true,
    toolName: "get_household_search",
    data: {
      count: households.length,
      households: households.map((h) => ({
        householdId: h.id,
        name: h.name,
        email: h.email,
        address: h.address,
      })),
    },
  };
}

async function executeRecentActivity(): Promise<OpsToolCallResult> {
  const { db } = await import("@/lib/db");

  const [
    recentBookings,
    recentTasks,
  ] = await Promise.all([
    db.booking.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        status: true,
        createdAt: true,
        scheduledStart: true,
        vendor: { select: { name: true } },
        task: {
          select: {
            category: true,
            amountCents: true,
            household: { select: { name: true } },
          },
        },
      },
    }),
    db.task.findMany({
      where: { status: { in: ["COMPLETED", "DISPATCHED", "IN_PROGRESS"] } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        category: true,
        amountCents: true,
        updatedAt: true,
        household: { select: { name: true } },
      },
    }),
  ]);

  return {
    success: true,
    toolName: "get_recent_activity",
    data: {
      recentBookings: recentBookings.map((b) => ({
        bookingId: b.id,
        status: b.status,
        category: getCategoryLabel(b.task.category),
        amount: sgd(b.task.amountCents),
        customer: b.task.household.name,
        vendor: b.vendor.name,
        scheduledFor: b.scheduledStart ? fmtDateTime(b.scheduledStart) : null,
        createdAt: fmtDateTime(b.createdAt),
      })),
      recentTasks: recentTasks.map((t) => ({
        taskId: t.id,
        status: t.status,
        category: getCategoryLabel(t.category),
        amount: sgd(t.amountCents),
        household: t.household.name,
        updatedAt: fmtDateTime(t.updatedAt),
      })),
    },
  };
}
