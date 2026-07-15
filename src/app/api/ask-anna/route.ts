import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AUTONOMY_LEVEL_NAMES } from "@/lib/constants";
import ZAI from "z-ai-web-dev-sdk";

// ─────────────────────────────────────────────────────────────
// Intent detection (simple keyword/pattern matching)
// ─────────────────────────────────────────────────────────────

type Intent =
  | "upcoming"
  | "spending"
  | "vendor"
  | "escrow"
  | "autonomy"
  | "summary"
  | "default";

const INTENT_PATTERNS: { keywords: string[]; intent: Intent }[] = [
  {
    keywords: ["scheduled", "upcoming", "this week", "what's coming", "what is coming", "coming up", "next", "soon", "pending"],
    intent: "upcoming",
  },
  {
    keywords: ["spent", "cost", "how much", "expenses", "billing", "spending", "money", "budget", "month", "billed", "charged"],
    intent: "spending",
  },
  {
    keywords: ["vendor", "who", "cleaner", "handyman", "technician", "worker", "assigned", "laundry", "aircon", "contractor"],
    intent: "vendor",
  },
  {
    keywords: ["escrow", "payment", "held", "payout", "released", "refund", "dispute", "pay", "transaction"],
    intent: "escrow",
  },
  {
    keywords: ["autonomy", "level", "progress", "trust", "promote", "ladder", "tier", "automated"],
    intent: "autonomy",
  },
  {
    keywords: ["status", "overview", "summary", "how's everything", "how is everything", "how are things", "general", "situation"],
    intent: "summary",
  },
];

function detectIntent(message: string): Intent {
  const lower = message.toLowerCase();
  for (const { keywords, intent } of INTENT_PATTERNS) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return intent;
    }
  }
  return "default";
}

// ─────────────────────────────────────────────────────────────
// Helper: format cents to SGD string
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
// Data fetchers
// ─────────────────────────────────────────────────────────────

async function fetchUpcomingTasks(householdId: string) {
  const tasks = await db.task.findMany({
    where: {
      householdId,
      status: { in: ["CREATED", "DISPATCHED", "IN_PROGRESS"] },
    },
    include: {
      bookings: {
        include: { vendor: true },
        orderBy: { scheduledStart: "asc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return tasks.map((t) => ({
    id: t.id,
    category: t.category,
    status: t.status,
    amountCents: t.amountCents,
    amount: sgd(t.amountCents),
    createdAt: fmtDate(t.createdAt),
    vendorName: t.bookings[0]?.vendor?.name || null,
    scheduledStart: t.bookings[0]?.scheduledStart
      ? fmtDateTime(new Date(t.bookings[0].scheduledStart))
      : null,
    instructions: t.instructions,
  }));
}

async function fetchMonthlySpending(householdId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const tasks = await db.task.findMany({
    where: {
      householdId,
      createdAt: { gte: monthStart },
    },
    include: {
      escrowEntries: { where: { state: { in: ["HELD", "RELEASED"] } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalCents = tasks.reduce((sum, t) => sum + t.amountCents, 0);
  const releasedCents = tasks.reduce(
    (sum, t) =>
      sum +
      t.escrowEntries
        .filter((e) => e.state === "RELEASED")
        .reduce((s, e) => s + e.amountCents, 0),
    0
  );
  const heldCents = tasks.reduce(
    (sum, t) =>
      sum +
      t.escrowEntries
        .filter((e) => e.state === "HELD")
        .reduce((s, e) => s + e.amountCents, 0),
    0
  );

  return {
    month: monthStart.toLocaleDateString("en-SG", { month: "long", year: "numeric" }),
    totalTasks: tasks.length,
    totalSpent: sgd(totalCents),
    totalSpentCents: totalCents,
    escrowReleased: sgd(releasedCents),
    escrowHeld: sgd(heldCents),
    tasks: tasks.map((t) => ({
      id: t.id,
      category: t.category,
      status: t.status,
      amount: sgd(t.amountCents),
      createdAt: fmtDate(t.createdAt),
    })),
  };
}

async function fetchVendorHistory(
  householdId: string,
  category?: string
) {
  const where: Record<string, unknown> = { householdId };
  if (category) {
    where.category = category as never;
  }

  const affinities = await db.vendorHouseholdAffinity.findMany({
    where,
    include: { vendor: true },
    orderBy: { lastCompletedAt: "desc" },
    take: 10,
  });

  // Also get recent bookings to supplement
  const recentBookings = await db.booking.findMany({
    where: {
      task: { householdId },
    },
    include: {
      vendor: true,
      task: { select: { category: true, amountCents: true } },
    },
    orderBy: { scheduledStart: "desc" },
    take: 15,
  });

  return {
    vendors: affinities.map((a) => ({
      name: a.vendor.name,
      category: a.category,
      bookingCount: a.bookingCount,
      completedCount: a.completedCount,
      avgRating: a.avgRating ? a.avgRating.toFixed(1) : "N/A",
      disputeCount: a.disputeCount,
      lastAssigned: a.lastAssignedAt ? fmtDate(a.lastAssignedAt) : "Never",
    })),
    recentBookings: recentBookings.map((b) => ({
      vendorName: b.vendor.name,
      category: b.task.category,
      status: b.status,
      amount: sgd(b.task.amountCents),
      scheduledStart: fmtDateTime(new Date(b.scheduledStart)),
      rating: b.rating,
    })),
  };
}

async function fetchEscrowStatus(householdId: string) {
  const entries = await db.escrowLedger.findMany({
    where: {
      task: { householdId },
    },
    include: {
      task: { select: { category: true, amountCents: true, status: true } },
      booking: { include: { vendor: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const totalHeld = entries
    .filter((e) => e.state === "HELD")
    .reduce((s, e) => s + e.amountCents, 0);
  const totalReleased = entries
    .filter((e) => e.state === "RELEASED")
    .reduce((s, e) => s + e.amountCents, 0);
  const totalDisputed = entries
    .filter((e) => e.state === "DISPUTED")
    .reduce((s, e) => s + e.amountCents, 0);

  return {
    totalHeld: sgd(totalHeld),
    totalReleased: sgd(totalReleased),
    totalDisputed: sgd(totalDisputed),
    entries: entries.map((e) => ({
      id: e.id,
      amount: sgd(e.amountCents),
      state: e.state,
      category: e.task.category,
      vendorName: e.booking?.vendor?.name || "Unknown",
      createdAt: fmtDate(e.createdAt),
      heldAt: fmtDate(e.heldAt),
      releasedAt: e.releasedAt ? fmtDate(e.releasedAt) : null,
      disputedAt: e.disputedAt ? fmtDate(e.disputedAt) : null,
      disputeReason: e.disputeReason,
    })),
  };
}

async function fetchAutonomyStatus(householdId: string) {
  const autonomyRecords = await db.householdCategoryAutonomy.findMany({
    where: { householdId },
    orderBy: { category: "asc" },
  });

  const thresholds = await db.autonomyLevelThreshold.findMany({
    orderBy: [{ category: "asc" }, { level: "asc" }],
  });

  return {
    categories: autonomyRecords.map((a) => {
      const nextThreshold = thresholds.find(
        (t) => t.category === a.category && t.level === a.currentLevel + 1
      );
      const currentLevelName =
        AUTONOMY_LEVEL_NAMES[a.currentLevel - 1] || "Unknown";
      const nextLevelName =
        AUTONOMY_LEVEL_NAMES[a.currentLevel] || null;

      return {
        category: a.category,
        currentLevel: a.currentLevel,
        currentLevelName,
        verifiedCyclesAtLevel: a.verifiedCyclesAtLevel,
        totalVerifiedCycles: a.totalVerifiedCycles,
        promotionPaused: a.promotionPaused,
        cyclesToNextLevel: nextThreshold
          ? nextThreshold.cyclesRequired - a.verifiedCyclesAtLevel
          : 0,
        nextLevelName,
        lastPromotedAt: a.lastPromotedAt
          ? fmtDate(a.lastPromotedAt)
          : "Never",
      };
    }),
  };
}

async function fetchHouseholdSummary(householdId: string) {
  const household = await db.household.findUnique({
    where: { id: householdId },
    include: {
      members: { select: { name: true, role: true } },
      subscriptions: { where: { status: "ACTIVE" }, take: 1 },
    },
  });

  if (!household) throw new Error("Household not found");

  const activeTasks = await db.task.count({
    where: {
      householdId,
      status: { in: ["CREATED", "DISPATCHED", "IN_PROGRESS"] },
    },
  });

  const completedThisMonth = await db.task.count({
    where: {
      householdId,
      status: { in: ["VERIFIED", "ESCROW_RELEASED"] },
      verifiedAt: {
        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
    },
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlySpend = await db.task.aggregate({
    where: {
      householdId,
      createdAt: { gte: monthStart },
    },
    _sum: { amountCents: true },
  });

  const autonomyRecords = await db.householdCategoryAutonomy.findMany({
    where: { householdId },
  });
  const avgLevel =
    autonomyRecords.length > 0
      ? (
          autonomyRecords.reduce((s, a) => s + a.currentLevel, 0) /
          autonomyRecords.length
        ).toFixed(1)
      : "N/A";

  return {
    householdName: household.name,
    address: household.address,
    members: household.members.map((m) => ({
      name: m.name,
      role: m.role,
    })),
    subscription: household.subscriptions[0]
      ? {
          tier: household.subscriptions[0].tier,
          price: sgd(household.subscriptions[0].priceCents),
        }
      : null,
    activeTasks,
    completedThisMonth,
    monthlySpend: sgd(monthlySpend._sum.amountCents || 0),
    avgAutonomyLevel: avgLevel,
    categories: autonomyRecords.map((a) => ({
      category: a.category,
      level: a.currentLevel,
      levelName: AUTONOMY_LEVEL_NAMES[a.currentLevel - 1] || "Unknown",
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Anna.I, the AI operating system for modern households in Singapore. You help households understand their service management status. You are precise, confident, and substantive — no hype or filler.

CRITICAL: You are READ-ONLY. You can only provide information about the household's current state. You CANNOT create tasks, dispatch vendors, release escrow, or perform any write actions. If a user asks you to do something, guide them to the appropriate in-app action.

Be concise. Use SGD currency format. Reference specific dates and amounts. Speak naturally like a knowledgeable assistant, not a robot.`;

// ─────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, householdId } = body as {
      message: string;
      householdId: string;
      conversationId?: string;
    };

    if (!message || !householdId) {
      return NextResponse.json(
        { error: "Missing message or householdId" },
        { status: 400 }
      );
    }

    // 1. Detect intent
    const intent = detectIntent(message);
    const dataUsed: string[] = [];
    let contextStr = "";

    // 2. Fetch relevant data based on intent
    switch (intent) {
      case "upcoming": {
        const data = await fetchUpcomingTasks(householdId);
        dataUsed.push("fetchUpcomingTasks");
        contextStr = `## Upcoming & Active Tasks\n\n${JSON.stringify(data, null, 2)}`;
        break;
      }
      case "spending": {
        const data = await fetchMonthlySpending(householdId);
        dataUsed.push("fetchMonthlySpending");
        contextStr = `## Monthly Spending\n\n${JSON.stringify(data, null, 2)}`;
        break;
      }
      case "vendor": {
        // Try to detect category from message
        const catMap: Record<string, string> = {
          cleaning: "CLEANING",
          laundry: "LAUNDRY",
          aircon: "AIRCON",
          handyman: "HANDYMAN",
        };
        const lower = message.toLowerCase();
        const detectedCat = Object.entries(catMap).find(([k]) =>
          lower.includes(k)
        )?.[1];
        const data = await fetchVendorHistory(
          householdId,
          detectedCat as "CLEANING" | "LAUNDRY" | "AIRCON" | "HANDYMAN" | undefined
        );
        dataUsed.push("fetchVendorHistory");
        if (detectedCat) dataUsed.push(`filter:${detectedCat}`);
        contextStr = `## Vendor History\n\n${JSON.stringify(data, null, 2)}`;
        break;
      }
      case "escrow": {
        const data = await fetchEscrowStatus(householdId);
        dataUsed.push("fetchEscrowStatus");
        contextStr = `## Escrow Status\n\n${JSON.stringify(data, null, 2)}`;
        break;
      }
      case "autonomy": {
        const data = await fetchAutonomyStatus(householdId);
        dataUsed.push("fetchAutonomyStatus");
        contextStr = `## Autonomy Status\n\n${JSON.stringify(data, null, 2)}`;
        break;
      }
      case "summary":
      default: {
        const data = await fetchHouseholdSummary(householdId);
        dataUsed.push("fetchHouseholdSummary");
        contextStr = `## Household Summary\n\n${JSON.stringify(data, null, 2)}`;
        break;
      }
    }

    // 3. Build full context for LLM
    const fullSystemPrompt = `${SYSTEM_PROMPT}\n\nHere is the current household data the user is asking about:\n\n${contextStr}\n\nAnswer the user's question based on this data. If the data is empty or shows no results, say so clearly. Do not make up information.`;

    // 4. Call LLM
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: fullSystemPrompt },
        { role: "user", content: message },
      ],
      thinking: { type: "disabled" },
    });

    const response =
      completion.choices[0]?.message?.content ||
      "Sorry, I couldn't generate a response. Please try again.";

    return NextResponse.json({ response, dataUsed });
  } catch (error) {
    console.error("[AskAnna] Error:", error);
    return NextResponse.json(
      { error: "Failed to process your request. Please try again." },
      { status: 500 }
    );
  }
}