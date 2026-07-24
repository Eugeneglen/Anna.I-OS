// ============================================================
// Anna.I — Ops Promotion Engine
// ============================================================
// Batch-scans all households for autonomy promotion eligibility
// and executes promotions deterministically.
// Per CLAUDE.md: "2–3 verified, undisputed bookings at a household's
// current level in a category promotes them to the next level."
// This is a rule-engine calculation — auditable and explainable.
// ============================================================

import { db } from "@/lib/db";
import {
  AUTONOMY_LEVEL_NAMES,
  MAX_AUTONOMY_LEVEL,
} from "./constants";
import {
  NotificationEventType,
  NotificationChannel,
  RecipientType,
  NotificationStatus,
} from "@prisma/client";

export interface PromotionCandidate {
  householdId: string;
  householdName: string;
  category: string;
  currentLevel: number;
  currentLevelName: string;
  newLevel: number;
  newLevelName: string;
  verifiedCyclesAtLevel: number;
  cyclesRequired: number;
}

export interface PromotionResult {
  candidate: PromotionCandidate;
  success: boolean;
  error?: string;
}

/**
 * Scan all households and find those eligible for autonomy promotion.
 *
 * Eligibility criteria (deterministic, rule-based):
 * 1. verifiedCyclesAtLevel >= cyclesRequired for next level
 * 2. currentLevel < MAX_AUTONOMY_LEVEL
 * 3. promotionPaused is false
 */
export async function scanForPromotions(): Promise<PromotionCandidate[]> {
  // 1. Load all thresholds into memory for O(1) lookup
  const thresholds = await db.autonomyLevelThreshold.findMany();
  const thresholdMap = new Map<string, Map<number, number>>();
  for (const t of thresholds) {
    if (!thresholdMap.has(t.category)) {
      thresholdMap.set(t.category, new Map());
    }
    thresholdMap.get(t.category)!.set(t.level, t.cyclesRequired);
  }

  // 2. Get all autonomy records that could potentially promote
  const allAutonomy = await db.householdCategoryAutonomy.findMany({
    where: {
      promotionPaused: false,
      currentLevel: { lt: MAX_AUTONOMY_LEVEL },
    },
    include: {
      household: { select: { id: true, name: true } },
    },
  });

  // 3. Check each against thresholds
  const candidates: PromotionCandidate[] = [];
  for (const a of allAutonomy) {
    const nextLevel = a.currentLevel + 1;
    const catThresholds = thresholdMap.get(a.category);
    if (!catThresholds) continue;

    const required = catThresholds.get(nextLevel);
    if (required === undefined) continue;

    if (a.verifiedCyclesAtLevel >= required) {
      candidates.push({
        householdId: a.householdId,
        householdName: a.household.name,
        category: a.category,
        currentLevel: a.currentLevel,
        currentLevelName:
          AUTONOMY_LEVEL_NAMES[a.currentLevel - 1] ??
          `Level ${a.currentLevel}`,
        newLevel: nextLevel,
        newLevelName:
          AUTONOMY_LEVEL_NAMES[nextLevel - 1] ?? `Level ${nextLevel}`,
        verifiedCyclesAtLevel: a.verifiedCyclesAtLevel,
        cyclesRequired: required,
      });
    }
  }

  return candidates;
}

/**
 * Execute promotions for eligible candidates.
 * For each candidate:
 * 1. Increment currentLevel, reset verifiedCyclesAtLevel to 0
 * 2. Set lastPromotedAt = now()
 * 3. Create AUTONOMY_PROMOTED notification for all household members
 */
export async function executePromotions(
  candidates: PromotionCandidate[]
): Promise<PromotionResult[]> {
  const results: PromotionResult[] = [];

  for (const candidate of candidates) {
    try {
      const promoted = await db.householdCategoryAutonomy.update({
        where: {
          householdId_category: {
            householdId: candidate.householdId,
            category: candidate.category,
          },
        },
        data: {
          currentLevel: candidate.newLevel,
          verifiedCyclesAtLevel: 0,
          lastPromotedAt: new Date(),
        },
      });

      // Notify all household members
      const members = await db.familyMember.findMany({
        where: { householdId: candidate.householdId },
        select: { id: true },
      });

      for (const member of members) {
        await db.notification.create({
          data: {
            householdId: candidate.householdId,
            recipientType: RecipientType.HOUSEHOLD_MEMBER,
            memberId: member.id,
            channel: NotificationChannel.WHATSAPP,
            eventType: NotificationEventType.AUTONOMY_PROMOTED,
            title: "Autonomy Level Up!",
            body: `Your ${candidate.category.toLowerCase()} service has been promoted to ${candidate.newLevelName}.`,
            status: NotificationStatus.PENDING,
            referenceType: "autonomy",
            referenceId: promoted.id,
          },
        });
      }

      results.push({ candidate, success: true });
    } catch (error) {
      results.push({
        candidate,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}
