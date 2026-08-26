/**
 * Job Number Generator
 * ====================
 * Generates human-readable, globally-sequential job numbers in the format:
 *   AI-00000001  (8-digit zero-padded sequence, prefix "AI-")
 *
 * Stored on the Task model at creation time. Sequence is global across
 * all tasks (regardless of category, household, or date).
 *
 * Race-condition handling: caller must pass a Prisma transaction client
 * and retry on P2002 (unique constraint violation) if two concurrent
 * creations pick the same sequence number.
 */

import type { PrismaClient } from "@prisma/client";

const JOB_NO_PREFIX = "AI-";
const SEQUENCE_PAD = 8;

/**
 * Format a sequence number as a job number.
 *   1   → "AI-00000001"
 *   42  → "AI-00000042"
 *   999 → "AI-00000999"
 */
export function formatJobNo(seq: number): string {
  return `${JOB_NO_PREFIX}${String(seq).padStart(SEQUENCE_PAD, "0")}`;
}

/**
 * Generate the next job number within a Prisma transaction.
 *
 * Finds the highest existing sequence number, increments by 1.
 * Returns the formatted job number string (e.g. "AI-00000010").
 *
 * Must be called inside a transaction with the task.create() to ensure
 * atomicity. If the resulting jobNo collides with a concurrent insert,
 * the caller should retry (P2002 unique constraint error).
 */
export async function generateJobNo(
  tx: PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]
): Promise<string> {
  // Find the task with the highest jobNo
  const latest = await tx.task.findFirst({
    where: {
      jobNo: { not: null },
    },
    orderBy: { jobNo: "desc" },
    select: { jobNo: true },
  });

  let nextSeq = 1;
  if (latest?.jobNo) {
    // Extract the numeric suffix from "AI-00000009"
    const match = latest.jobNo.match(/(\d+)$/);
    if (match) {
      nextSeq = parseInt(match[1], 10) + 1;
    }
  }

  return formatJobNo(nextSeq);
}

/**
 * Parse a job number string back to its sequence number.
 *   "AI-00000042" → 42
 *   "ai-42"       → 42
 *   "garbage"     → 0
 */
export function parseJobNo(jobNo: string): number {
  const match = jobNo.match(/(\d+)$/i);
  return match ? parseInt(match[1], 10) : 0;
}
