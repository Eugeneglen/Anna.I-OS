// ============================================================
// Anna.I — Escrow primary-entry selection (F-8, Item 8)
// ============================================================
// One shared, PURE selector for "the escrow entry a surface should
// display/act on" for a task (or a specific booking).
//
// Why this exists: multiple surfaces picked `escrowEntries[0]` —
// the OLDEST row. After a cancel → rematch the old hold is VOIDED
// and a NEW live hold exists, so [0] showed (and, worse, acted on)
// a dead entry: vendor schedule cards displayed a VOIDED escrow,
// the household dashboard showed no held money, and the ops
// pending-release card passed a VOIDED entry id to the release
// action (409, payment stuck).
//
// Selection rules (relationship + live status, NOT array order):
//   1. bookingId given → only that booking's entries (the entry
//      associated with the booking being displayed); empty → null.
//   2. Prefer LIVE (non-VOIDED) entries; fall back to all-VOIDED
//      only when nothing else exists (honest "Voided" display).
//   3. Among live entries prefer actively-held money (HELD /
//      DISPUTED), then RELEASED, then DISPUTE_CLOSED, then REFUNDED.
//   4. Within a tier, the most recent by heldAt (newest hold wins —
//      a post-rematch hold supersedes the voided original).
//
// Pure function — no DB, no server-only imports — safe for client
// components and API routes alike.
// ============================================================

/** Minimal shape the selector needs (all escrow selects carry these). */
export interface EscrowEntryLike {
  id?: string;
  state?: string | null;
  bookingId?: string | null;
  heldAt?: string | Date | null;
}

/** Tier rank: lower = more "primary" for display/action. */
function stateTier(state: string | null | undefined): number {
  switch (state) {
    case "HELD":
    case "DISPUTED":
      return 0; // money currently held (or held under dispute)
    case "RELEASED":
      return 1;
    case "DISPUTE_CLOSED":
      return 2;
    case "REFUNDED":
      return 3;
    default:
      return 4; // VOIDED and unknown states — dead last
  }
}

function entryTime(e: EscrowEntryLike): number {
  const t = e.heldAt;
  if (t instanceof Date) return t.getTime();
  if (typeof t === "string") {
    const parsed = Date.parse(t);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

/**
 * Entries that represent LIVE money for display aggregation.
 *
 * P2-1 (Item 8 final review): several display surfaces REDUCED over the
 * full entry list — after a cancel → rematch the task's oldest entry is
 * VOIDED but still carries its original vendorPayoutCents (voiding never
 * zeroes the figures), so "Your Payout" / "Payment released" / household
 * "Paid" sums overstated by the dead entry. Aggregations must run over
 * LIVE entries only, mirroring pickPrimaryEscrowEntry's live-first rule.
 *
 * REFUNDED entries are intentionally KEPT: they are real money history
 * (their amount nets against their cumulative refundCents). Only VOIDED
 * rows are dead holds superseded by a newer entry.
 *
 * @param opts.bookingId when given, restrict to THAT booking's entries
 *                 (vendor views — the entry associated with the booking
 *                 being displayed, incl. its add-on entries); when
 *                 omitted, task-level (household/ops views).
 */
export function liveEscrowEntries<T extends EscrowEntryLike>(
  entries: readonly T[] | null | undefined,
  opts: { bookingId?: string | null } = {}
): T[] {
  if (!entries || entries.length === 0) return [];
  let pool: readonly T[] = entries;
  if (opts.bookingId) {
    pool = entries.filter((e) => e.bookingId === opts.bookingId);
  }
  return pool.filter((e) => e.state !== "VOIDED");
}

/**
 * Pick the escrow entry a surface should show / act on.
 *
 * @param entries  escrow entries of the task (any select shape that
 *                 includes id, state, bookingId, heldAt)
 * @param opts.bookingId when given, restrict to THAT booking's entries
 *                 (vendor schedule cards); when omitted, task-level
 *                 selection (household dashboard, task detail, ops cards)
 */
export function pickPrimaryEscrowEntry<T extends EscrowEntryLike>(
  entries: readonly T[] | null | undefined,
  opts: { bookingId?: string | null } = {}
): T | null {
  if (!entries || entries.length === 0) return null;

  let pool: readonly T[] = entries;
  if (opts.bookingId) {
    pool = entries.filter((e) => e.bookingId === opts.bookingId);
    if (pool.length === 0) return null; // no escrow for THIS booking
  }

  // Prefer live entries; all-VOIDED is an acceptable last resort.
  const live = pool.filter((e) => e.state !== "VOIDED");
  const candidates = live.length > 0 ? live : pool;

  // Tier (held money first), then most recent hold.
  const sorted = [...candidates].sort((a, b) => {
    const tierDiff = stateTier(a.state) - stateTier(b.state);
    if (tierDiff !== 0) return tierDiff;
    return entryTime(b) - entryTime(a);
  });
  return sorted[0] ?? null;
}
