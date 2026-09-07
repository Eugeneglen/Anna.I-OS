// ============================================================
// Anna.I — NLU Tool Definitions for Ask Anna
// ============================================================
// L5 autonomy: Anna can execute write actions via tool calling.
// All write tools require user confirmation before execution.
// ============================================================

import { CATEGORY_DEFAULTS, type ServiceCategory } from "./types";
import { CANCELLABLE_STATUSES, cancelTask } from "./task-cancel-service";
import { generateJobNo } from "./job-number";
import type { ServiceJobType } from "@prisma/client";

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
      "Create a new service task for the household. Use when the user wants to book, schedule, or request a service (e.g., 'book a cleaning', 'schedule aircon servicing', 'I need a plumber'). Price is set by the Anna.I service catalog (never invented).",
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
            "Preferred date for the job in YYYY-MM-DD format. Resolve relative dates ('tomorrow', 'next Friday', 'this weekend') against the CURRENT DATE given in the system prompt — never guess. Default to tomorrow if not specified.",
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
  const { ServiceCategory } = await import("@prisma/client");

  const category = args.category as ServiceCategory;
  const instructions = (args.instructions as string) || null;
  const recurrence = (args.recurrence as string) || "ONE_OFF";

  // Validate category
  if (!CATEGORY_DEFAULTS[category]) {
    return { success: false, toolName: "create_task", error: `Unknown service category: ${category}` };
  }

  // ── AI Wave 2-A (A-2): Ops is the sole pricing authority. The old code
  // took the amount from the hard-coded CATEGORY_DEFAULTS constant (SGD
  // $80 for cleaning etc.), bypassing the Ops-managed ServiceJobType
  // catalog and leaving jobTypeId NULL. Now the catalog is the ONLY price
  // source — if no active job type exists for the category, we REFUSE to
  // book rather than fall back to a hard-coded price (Principle B).
  //
  // Police (POLICE-1, must-fix #2): on the CONFIRM pass the user has
  // already approved a specific jobTypeId + amountCents on the card. We
  // must honor EXACTLY those — re-resolving the catalog fresh could book a
  // different price than the one approved if Ops edited the catalog in the
  // meantime. If the approved entry no longer matches (deactivated,
  // re-categorized, or price changed), REFUSE with a clear message instead
  // of silently booking different terms.
  const approvedJobTypeId = args.jobTypeId as string | undefined;
  const approvedAmountCents = args.amountCents as number | undefined;
  let jobType: Pick<ServiceJobType, "id" | "name" | "basePriceCents" | "isActive" | "category"> | null =
    null;
  if (executeWrites && approvedJobTypeId) {
    // Confirm pass — verify the approved catalog entry is still exactly
    // what the user signed off on.
    const approved = await db.serviceJobType.findUnique({
      where: { id: approvedJobTypeId },
    });
    if (
      !approved ||
      !approved.isActive ||
      approved.category !== category ||
      (approvedAmountCents !== undefined && approved.basePriceCents !== approvedAmountCents)
    ) {
      return {
        success: false,
        toolName: "create_task",
        error:
          "The service catalog changed since you approved this booking (service removed or price updated by Anna.I Ops). Nothing was booked — please ask again to see the current catalog price.",
      };
    }
    jobType = approved;
  } else {
    // Draft pass (or a confirm without card payload) — resolve fresh.
    jobType = await db.serviceJobType.findFirst({
      where: { category, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }
  if (!jobType) {
    return {
      success: false,
      toolName: "create_task",
      error: `No active service catalog entry for ${category} — pricing is set by Anna.I Ops, so I can't book this category until it's added to the catalog. Please use the booking flow or contact support.`,
    };
  }
  const priceCents = jobType.basePriceCents;

  // ── AI Wave 2-A (A-3): date resolution + confirmation round-trip.
  // The old bug: the confirmation card showed a date derived from the
  // LLM's scheduledDate arg, but the confirm pass received
  // confirmationAction.scheduledStart (a DIFFERENT field name) → the
  // executor silently fell back to "tomorrow" and the task landed on a
  // date the user never approved. Now:
  //   - draft pass: parse scheduledDate (YYYY-MM-DD) → 10:00 SGT
  //   - confirm pass: reuse the exact scheduledStart ISO from the card
  const scheduledStart = resolveScheduledStart(args);
  const dateAdjusted = scheduledStart.adjusted;

  // If not executing writes, return confirmation request — the card now
  // shows the EXACT values (catalog price + resolved date) that the
  // executor will store on confirmation.
  if (!executeWrites) {
    return {
      success: true,
      toolName: "create_task",
      requiresConfirmation: true,
      confirmationMessage: `Book ${jobType.name} (${CATEGORY_DEFAULTS[category].label}) for ${fmtDate(scheduledStart.date)} at SGD ${(priceCents / 100).toFixed(2)} (Anna.I catalog price)?${instructions ? ` Instructions: "${instructions}"` : ""}${recurrence !== "ONE_OFF" ? ` (${recurrence})` : ""}${dateAdjusted ? " — note: the requested date already passed, so I moved it to tomorrow." : ""}`,
      confirmationAction: {
        category,
        instructions,
        scheduledStart: scheduledStart.date.toISOString(),
        recurrence,
        amountCents: priceCents,
        jobTypeId: jobType.id,
      },
    };
  }

  // Execute: create the task with catalog pricing + catalog linkage.
  const { TaskStatus: TS } = await import("@prisma/client");
  const recurrencePattern = recurrence !== "ONE_OFF"
    ? { type: recurrence, interval: recurrence === "WEEKLY" ? 7 : recurrence === "FORTNIGHTLY" ? 14 : 30 }
    : null;

  // Police (POLICE-1, must-fix #1): generateJobNo + task.create must run in
  // ONE transaction with a P2002 retry, mirroring POST /api/tasks
  // (MAX_JOB_NO_RETRIES). Task.jobNo is @unique — a concurrent form booking
  // and AI booking can otherwise collide and hard-fail the AI create.
  const MAX_JOB_NO_RETRIES = 5;
  let task: { id: string; jobNo: string | null } | null = null;
  let lastCreateError: unknown = null;
  for (let attempt = 0; attempt < MAX_JOB_NO_RETRIES; attempt++) {
    try {
      task = await db.$transaction(async (tx) => {
        const jobNo = await generateJobNo(tx);
        return await tx.task.create({
          data: {
            jobNo,
            householdId,
            category,
            status: TS.CREATED,
            instructions,
            instructionsSource: "nlu",
            amountCents: priceCents,
            finalAmountCents: priceCents,
            jobTypeId: jobType.id,
            recurrencePattern,
            scheduledStart: scheduledStart.date,
            metadata: {
              source: "nlu",
              autoDispatched: false,
              jobTypeName: jobType.name,
            },
          },
          select: { id: true, jobNo: true },
        });
      });
      break;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "P2002") {
        // jobNo unique collision with a concurrent creation — retry picks
        // the next sequence number.
        lastCreateError = err;
        continue;
      }
      throw err;
    }
  }
  if (!task) {
    throw lastCreateError ?? new Error("Could not allocate a job number after retries");
  }

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

  return {
    success: true,
    toolName: "create_task",
    data: {
      taskId: task.id,
      jobNo: task.jobNo,
      category,
      jobTypeName: jobType.name,
      amount: sgd(priceCents),
      scheduledDate: fmtDate(scheduledStart.date),
      recurrence,
    },
  };
}

/**
 * A-3: single source of truth for date resolution, shared by the draft
 * (card) and confirm (execute) passes so both can never disagree.
 *
 * Priority:
 *   1. args.scheduledStart — the ISO string round-tripped from the
 *      confirmation card (confirm pass — this is exactly what the user
 *      approved)
 *   2. args.scheduledDate — "YYYY-MM-DD" from the LLM (draft pass)
 *   3. tomorrow @ 10:00 local (default)
 *
 * A resolved date in the past moves to tomorrow @ 10:00 with adjusted=true
 * so the card can tell the user (no silent surprises).
 */
function resolveScheduledStart(args: Record<string, unknown>): {
  date: Date;
  adjusted: boolean;
} {
  const now = new Date();
  let date: Date | null = null;

  const iso = args.scheduledStart as string | undefined;
  if (iso) {
    const parsed = new Date(iso);
    if (!isNaN(parsed.getTime())) date = parsed;
  }

  if (!date) {
    const ymd = args.scheduledDate as string | undefined;
    if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      const [y, m, d] = ymd.split("-").map(Number);
      date = new Date(y, m - 1, d, 10, 0, 0);
    }
  }

  if (!date) {
    date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(10, 0, 0, 0);
    return { date, adjusted: false };
  }

  if (date.getTime() < now.getTime()) {
    const bumped = new Date();
    bumped.setDate(bumped.getDate() + 1);
    bumped.setHours(10, 0, 0, 0);
    return { date: bumped, adjusted: true };
  }

  return { date, adjusted: false };
}

async function executeCancelTask(
  args: Record<string, unknown>,
  householdId: string,
  executeWrites: boolean
): Promise<ToolCallResult> {
  const { db } = await import("@/lib/db");

  const taskId = args.taskId as string;
  // Police (POLICE-1, risk #7): clamp the LLM-controlled reason — the
  // canonical route zod-caps it at 500 chars; the AI path must too (it
  // lands in disputeResolution text + audit metadata).
  const rawReason = (args.reason as string) || "Cancelled via Ask Anna";
  const reason = rawReason.slice(0, 500);

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

  // ── AI Wave 2-A (A-4): use the SAME cancellable-status list as the
  // canonical service (previously the tool had its own slightly different
  // list, and its own divergent state semantics on execution).
  if (!CANCELLABLE_STATUSES.includes(task.status as never)) {
    return { success: false, toolName: "cancel_task", error: `Cannot cancel a task that is already ${task.status}` };
  }

  if (!executeWrites) {
    return {
      success: true,
      toolName: "cancel_task",
      requiresConfirmation: true,
      confirmationMessage: `Cancel the ${task.category.toLowerCase()} task #${task.jobNo ?? ""} scheduled for ${task.scheduledStart ? fmtDate(new Date(task.scheduledStart)) : "pending"}?${task.bookings.length > 0 ? " The vendor assignment will be cancelled and any escrowed amount refunded as Anna.I credit." : ""}`,
      confirmationAction: { taskId, reason },
    };
  }

  // ── AI Wave 2-A (A-4): delegate to the canonical cancellation service
  // (src/lib/task-cancel-service.ts — the exact F18/R3 money path used by
  // POST /api/tasks/[id]/cancel). The old inline code just set
  // status back to "CREATED", skipping the CANCELLED state machine,
  // refund-as-credit, voucher restore, notifications and events.
  const outcome = await cancelTask({
    taskId,
    reason,
    actor: { kind: "household", householdId, via: "ask-anna" },
  });

  if (!outcome.ok) {
    return { success: false, toolName: "cancel_task", error: outcome.error };
  }

  return {
    success: true,
    toolName: "cancel_task",
    data: {
      taskId,
      status: "CANCELLED",
      refundedCents: outcome.data.refundedCents,
      creditCode: outcome.data.credit?.code ?? null,
      voucherRestored: outcome.data.voucherRestored,
    },
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
      where.status = { in: ["CREATED", "MATCHING", "ACCEPTED", "SCHEDULED", "IN_PROGRESS"] };
      break;
    case "upcoming":
      where.status = { in: ["CREATED", "PREDICTED", "MATCHING", "ACCEPTED", "SCHEDULED"] };
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
