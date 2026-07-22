// ============================================================
// Anna.I — NLU Tool Definitions for Ask Anna
// ============================================================
// L5 autonomy: Anna can execute write actions via tool calling.
// All write tools require user confirmation before execution.
// ============================================================

import { CATEGORY_DEFAULTS, type ServiceCategory } from "./types";

// ─────────────────────────────────────────────────────────────
// Tool Definitions (OpenAI-compatible function calling format)
// ─────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresConfirmation: boolean;
}

/**
 * All available tools for Ask Anna.
 * Read-only tools execute immediately.
 * Write tools return a confirmation request for the user.
 */
export const ANNA_TOOLS: ToolDefinition[] = [
  {
    name: "create_task",
    description:
      "Create a new service task for the household. Use when the user wants to book, schedule, or request a service (e.g., 'book a cleaning', 'schedule aircon servicing', 'I need a plumber').",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: Object.keys(CATEGORY_DEFAULTS),
          description: "Service category to book",
        },
        instructions: {
          type: "string",
          description:
            "Special instructions or details about the job. Optional.",
        },
        scheduledDate: {
          type: "string",
          description:
            "Preferred date for the job in YYYY-MM-DD format. If the user says 'tomorrow', 'next Friday', 'this weekend', etc., calculate the actual date. Default to tomorrow if not specified.",
        },
        recurrence: {
          type: "string",
          enum: ["ONE_OFF", "WEEKLY", "FORTNIGHTLY", "MONTHLY"],
          description:
            "Recurrence pattern. Default to ONE_OFF unless the user mentions recurring/regular service.",
        },
      },
      required: ["category"],
    },
    requiresConfirmation: true,
  },
  {
    name: "cancel_task",
    description:
      "Cancel a predicted or created task. Use when the user wants to cancel a booking or upcoming service.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to cancel",
        },
        reason: {
          type: "string",
          description: "Reason for cancellation",
        },
      },
      required: ["taskId", "reason"],
    },
    requiresConfirmation: true,
  },
  {
    name: "get_status",
    description:
      "Get current status overview: active tasks, upcoming bookings, pending items. Use for general status inquiries.",
    parameters: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["active", "upcoming", "completed", "all"],
          description: "Filter tasks by status group",
        },
      },
    },
    requiresConfirmation: false,
  },
  {
    name: "get_spending",
    description:
      "Get spending summary: total spent, escrow held, escrow released, monthly breakdown.",
    parameters: {
      type: "object",
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: "get_vendor_info",
    description:
      "Get information about vendors: who was assigned, vendor history, ratings.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: Object.keys(CATEGORY_DEFAULTS),
          description: "Filter by service category (optional)",
        },
      },
    },
    requiresConfirmation: false,
  },
  {
    name: "get_autonomy",
    description:
      "Get autonomy level progress for all service categories. Use when the user asks about autonomy levels, trust progress, or when they'll level up.",
    parameters: {
      type: "object",
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: "get_escrow",
    description:
      "Get escrow status: held, released, disputed amounts.",
    parameters: {
      type: "object",
      properties: {},
    },
    requiresConfirmation: false,
  },
];

// ─────────────────────────────────────────────────────────────
// Tool Call Result Type
// ─────────────────────────────────────────────────────────────

export interface ToolCallResult {
  success: boolean;
  toolName: string;
  data?: Record<string, unknown>;
  error?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
  confirmationAction?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Tool Executor — executes tool calls against the database
// ─────────────────────────────────────────────────────────────

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  householdId: string,
  executeWrites: boolean = false
): Promise<ToolCallResult> {
  switch (toolName) {
    case "create_task":
      return executeCreateTask(args, householdId, executeWrites);
    case "cancel_task":
      return executeCancelTask(args, householdId, executeWrites);
    case "get_status":
      return executeGetStatus(args, householdId);
    case "get_spending":
      return executeGetSpending(householdId);
    case "get_vendor_info":
      return executeGetVendorInfo(args, householdId);
    case "get_autonomy":
      return executeGetAutonomy(householdId);
    case "get_escrow":
      return executeGetEscrow(householdId);
    default:
      return { success: false, toolName, error: `Unknown tool: ${toolName}` };
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

// ─────────────────────────────────────────────────────────────
// Write Tools (require confirmation)
// ─────────────────────────────────────────────────────────────

async function executeCreateTask(
  args: Record<string, unknown>,
  householdId: string,
  executeWrites: boolean
): Promise<ToolCallResult> {
  const { db } = await import("@/lib/db");
  const { CATEGORY_DEFAULTS } = await import("./types");
  const { triggerAutomationOnTaskCreated } = await import("./automation");
  const { ServiceCategory, TaskStatus } = await import("@prisma/client");

  const category = args.category as ServiceCategory;
  const instructions = (args.instructions as string) || null;
  const scheduledDate = (args.scheduledDate as string) || null;
  const recurrence = (args.recurrence as string) || "ONE_OFF";

  // Validate category
  if (!CATEGORY_DEFAULTS[category]) {
    return { success: false, toolName: "create_task", error: `Unknown service category: ${category}` };
  }

  const defaultAmount = CATEGORY_DEFAULTS[category].amount;

  // Build scheduled start (default: tomorrow 10am SGT)
  let scheduledStart: Date | null = null;
  if (scheduledDate) {
    const [y, m, d] = scheduledDate.split("-").map(Number);
    scheduledStart = new Date(y, m - 1, d, 10, 0, 0);
    // If the date is in the past, move to next day
    const now = new Date();
    if (scheduledStart < now) {
      scheduledStart.setDate(scheduledStart.getDate() + 1);
    }
  } else {
    scheduledStart = new Date();
    scheduledStart.setDate(scheduledStart.getDate() + 1);
    scheduledStart.setHours(10, 0, 0, 0);
  }

  // If not executing writes, return confirmation request
  if (!executeWrites) {
    return {
      success: true,
      toolName: "create_task",
      requiresConfirmation: true,
      confirmationMessage: `Book a ${CATEGORY_DEFAULTS[category].label} service for ${fmtDate(scheduledStart)}?${instructions ? ` Instructions: "${instructions}"` : ""}${recurrence !== "ONE_OFF" ? ` (${recurrence})` : ""}`,
      confirmationAction: {
        category,
        instructions,
        scheduledStart: scheduledStart.toISOString(),
        recurrence,
        amountCents: defaultAmount,
      },
    };
  }

  // Execute: create the task
  const { TaskStatus: TS } = await import("@prisma/client");
  const recurrencePattern = recurrence !== "ONE_OFF"
    ? { type: recurrence, interval: recurrence === "WEEKLY" ? 7 : recurrence === "FORTNIGHTLY" ? 14 : 30 }
    : null;

  const task = await db.task.create({
    data: {
      householdId,
      category,
      status: TS.CREATED,
      instructions,
      instructionsSource: "nlu",
      amountCents: defaultAmount,
      recurrencePattern,
      scheduledStart,
    },
  });

  // Ensure autonomy record exists
  await db.householdCategoryAutonomy.upsert({
    where: { householdId_category: { householdId, category } },
    create: {
      householdId,
      category,
      currentLevel: 1,
      verifiedCyclesAtLevel: 0,
      totalVerifiedCycles: 0,
      promotionPaused: false,
    },
    update: {},
  });

  // Fire automation (auto-dispatch if L3+)
  triggerAutomationOnTaskCreated(task.id, householdId, category);

  // Set NLU source flag
  await db.task.update({
    where: { id: task.id },
    data: {
      metadata: {
        source: "nlu",
        autoDispatched: false,
      },
    },
  });

  return {
    success: true,
    toolName: "create_task",
    data: {
      taskId: task.id,
      category,
      amount: sgd(defaultAmount),
      scheduledDate: fmtDate(scheduledStart!),
      recurrence,
    },
  };
}

async function executeCancelTask(
  args: Record<string, unknown>,
  householdId: string,
  executeWrites: boolean
): Promise<ToolCallResult> {
  const { db } = await import("@/lib/db");

  const taskId = args.taskId as string;
  const reason = (args.reason as string) || "Cancelled via Ask Anna";

  // Validate task exists and belongs to this household
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { bookings: { take: 1 } },
  });

  if (!task) {
    return { success: false, toolName: "cancel_task", error: "Task not found" };
  }
  if (task.householdId !== householdId) {
    return { success: false, toolName: "cancel_task", error: "This task belongs to a different household" };
  }

  // Can only cancel CREATED, PREDICTED, or DISPATCHED tasks
  if (!["CREATED", "PREDICTED", "DISPATCHED"].includes(task.status)) {
    return { success: false, toolName: "cancel_task", error: `Cannot cancel a task that is already ${task.status}` };
  }

  if (!executeWrites) {
    return {
      success: true,
      toolName: "cancel_task",
      requiresConfirmation: true,
      confirmationMessage: `Cancel the ${task.category.toLowerCase()} task scheduled for ${task.scheduledStart ? fmtDate(new Date(task.scheduledStart)) : "pending"}?`,
      confirmationAction: { taskId, reason },
    };
  }

  // Execute cancellation
  await db.task.update({
    where: { id: taskId },
    data: {
      status: "CREATED", // revert to created if was dispatched
      cancelledAt: new Date(),
      cancelReason: reason,
    },
  });

  // Cancel any active bookings
  if (task.bookings.length > 0) {
    await db.booking.updateMany({
      where: { taskId, status: { in: ["assigned", "accepted", "in_progress"] } },
      data: { status: "cancelled", cancelledAt: new Date() },
    });
  }

  return {
    success: true,
    toolName: "cancel_task",
    data: { taskId, cancelled: true },
  };
}

// ─────────────────────────────────────────────────────────────
// Read-Only Tools (execute immediately)
// ─────────────────────────────────────────────────────────────

async function executeGetStatus(
  args: Record<string, unknown>,
  householdId: string
): Promise<ToolCallResult> {
  const { db } = await import("@/lib/db");

  const filter = (args.filter as string) || "all";

  const where: Record<string, unknown> = { householdId, cancelledAt: null };

  switch (filter) {
    case "active":
      where.status = { in: ["CREATED", "DISPATCHED", "IN_PROGRESS"] };
      break;
    case "upcoming":
      where.status = { in: ["CREATED", "PREDICTED", "DISPATCHED"] };
      break;
    case "completed":
      where.status = { in: ["VERIFIED", "ESCROW_RELEASED"] };
      break;
  }

  const tasks = await db.task.findMany({
    where,
    include: {
      bookings: { include: { vendor: { select: { name: true } } }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return {
    success: true,
    toolName: "get_status",
    data: {
      filter,
      count: tasks.length,
      tasks: tasks.map((t) => ({
        id: t.id,
        category: t.category,
        status: t.status,
        amount: sgd(t.amountCents),
        scheduledDate: t.scheduledStart ? fmtDate(new Date(t.scheduledStart)) : null,
        vendorName: t.bookings[0]?.vendor?.name || null,
        instructions: t.instructions || null,
      })),
    },
  };
}

async function executeGetSpending(
  householdId: string
): Promise<ToolCallResult> {
  const { db } = await import("@/lib/db");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const tasks = await db.task.findMany({
    where: { householdId, createdAt: { gte: monthStart } },
    include: {
      escrowEntries: { where: { state: { in: ["HELD", "RELEASED"] } } },
    },
  });

  const totalCents = tasks.reduce((s, t) => s + t.amountCents, 0);
  const releasedCents = tasks.reduce(
    (s, t) =>
      s +
      t.escrowEntries
        .filter((e) => e.state === "RELEASED")
        .reduce((es, e) => es + e.amountCents, 0),
    0
  );
  const heldCents = tasks.reduce(
    (s, t) =>
      s +
      t.escrowEntries
        .filter((e) => e.state === "HELD")
        .reduce((es, e) => es + e.amountCents, 0),
    0
  );

  return {
    success: true,
    toolName: "get_spending",
    data: {
      month: monthStart.toLocaleDateString("en-SG", { month: "long", year: "numeric" }),
      totalTasks: tasks.length,
      totalSpent: sgd(totalCents),
      escrowHeld: sgd(heldCents),
      escrowReleased: sgd(releasedCents),
    },
  };
}

async function executeGetVendorInfo(
  args: Record<string, unknown>,
  householdId: string
): Promise<ToolCallResult> {
  const { db } = await import("@/lib/db");

  const where: Record<string, unknown> = { householdId };
  if (args.category) where.category = args.category as string;

  const affinities = await db.vendorHouseholdAffinity.findMany({
    where,
    include: { vendor: true },
    orderBy: { lastCompletedAt: "desc" },
    take: 5,
  });

  return {
    success: true,
    toolName: "get_vendor_info",
    data: {
      vendors: affinities.map((a) => ({
        name: a.vendor.name,
        category: a.category,
        completedJobs: a.completedCount,
        avgRating: a.avgRating ? a.avgRating.toFixed(1) : null,
        lastUsed: a.lastAssignedAt ? fmtDate(a.lastAssignedAt) : null,
      })),
    },
  };
}

async function executeGetAutonomy(
  householdId: string
): Promise<ToolCallResult> {
  const { db } = await import("@/lib/db");
  const { AUTONOMY_LEVEL_NAMES } = await import("./constants");

  const records = await db.householdCategoryAutonomy.findMany({
    where: { householdId },
    orderBy: { currentLevel: "desc" },
  });

  return {
    success: true,
    toolName: "get_autonomy",
    data: {
      categories: records.map((r) => ({
        category: r.category,
        level: r.currentLevel,
        levelName: AUTONOMY_LEVEL_NAMES[r.currentLevel - 1] || "Unknown",
        verifiedCycles: r.totalVerifiedCycles,
        cyclesAtCurrentLevel: r.verifiedCyclesAtLevel,
        promotionPaused: r.promotionPaused,
      })),
    },
  };
}

async function executeGetEscrow(
  householdId: string
): Promise<ToolCallResult> {
  const { db } = await import("@/lib/db");

  const entries = await db.escrowLedger.findMany({
    where: { task: { householdId } },
    include: {
      task: { select: { category: true } },
      booking: { include: { vendor: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const totalHeld = entries.filter((e) => e.state === "HELD").reduce((s, e) => s + e.amountCents, 0);
  const totalReleased = entries.filter((e) => e.state === "RELEASED").reduce((s, e) => s + e.amountCents, 0);

  return {
    success: true,
    toolName: "get_escrow",
    data: {
      totalHeld: sgd(totalHeld),
      totalReleased: sgd(totalReleased),
      recentEntries: entries.slice(0, 5).map((e) => ({
        category: e.task.category,
        vendorName: e.booking?.vendor?.name || "Unknown",
        amount: sgd(e.amountCents),
        state: e.state,
        date: fmtDate(e.createdAt),
      })),
    },
  };
}
