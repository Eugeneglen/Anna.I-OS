// ============================================================
// Anna.I — Booking add-on proposal: ONE shared validation envelope
// (F-7, Item 8)
// ============================================================
// The vendor-session route and the share-link route both create the SAME
// financial event (a vendor-side add-on charge proposal awaiting
// household approval), but previously carried DIVERGENT validation:
//   vendor route: description 1-500, amountCents positive, max 100_000_00
//                 ($100k cap, NO minimum)
//   share route:  description 3-500, amountCents 50..1_000_000
//                 ($0.50 min, $10k cap)
// and different status allowlists. This module is now the single
// envelope both routes share — same payload rules, same booking-status
// allowlist — so the same money event is validated identically no matter
// which surface it enters through.
//
// Bound decision (documented, deliberate): the STRICTER envelope wins —
// min $0.50, max $10,000 per add-on charge. The $100k figure elsewhere
// in the system (MAX_ADHOC_TASK_CENTS) caps an ENTIRE ad-hoc task; a
// single add-on on top of an already-booked job is not the same event
// and gets the tighter consumer-facing bound that the share page (the
// public surface) already enforced.
//
// Money flow (unchanged, authoritative): vendor proposes → household
// reviews → household approves → SERVER composes the final total via
// calculateOrderTotal() + getCommissionRate() and writes a separate
// escrow ledger row. The vendor NEVER directly establishes the final
// payable amount — this proposal payload only ever creates a `pending`
// BookingAddon.
// ============================================================

import { z } from "zod";

/** The single payload schema for proposing a booking add-on charge. */
export const createAddonProposalSchema = z.object({
  description: z
    .string()
    .min(3, "Description must be at least 3 characters")
    .max(500, "Description must be under 500 characters"),
  amountCents: z
    .number()
    .int("Amount must be a whole number")
    .min(50, "Minimum charge is $0.50")
    .max(1_000_000, "Maximum charge is $10,000"),
});

export type CreateAddonProposalInput = z.infer<typeof createAddonProposalSchema>;

/**
 * Booking statuses in which an add-on charge may be PROPOSED. The union of
 * the two previous route-specific lists — matches the share page's
 * canAddAddon gate and keeps the vendor portal consistent with it.
 */
export const ADDON_PROPOSAL_BOOKING_STATUSES = [
  "assigned",
  "accepted",
  "in_progress",
] as const;

export function isAddonProposalAllowedStatus(bookingStatus: string): boolean {
  return (ADDON_PROPOSAL_BOOKING_STATUSES as readonly string[]).includes(bookingStatus);
}
