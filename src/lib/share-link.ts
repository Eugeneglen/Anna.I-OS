/**
 * P8 (AUDIT-4): share-link expiry.
 *
 * Booking share tokens are 72-bit random strings with a full job-detail
 * payload behind them (address, schedule, amounts, staff contact). They
 * were previously IMMORTAL — a link leaked once (WhatsApp screenshot,
 * log file, referrer header) exposed that household's job data forever.
 *
 * Expiry model (v2, post-review):
 *
 *   expiresAt = max(sharedAt + SHARE_LINK_TTL_DAYS, scheduledEnd + SHARE_LINK_JOB_GRACE_DAYS)
 *
 * • sharedAt + 30d (default) caps the lifetime of a leaked link.
 * • scheduledEnd + 7d (default) is a job-aware FLOOR: households book
 *   services months in advance, so a link generated at accept time must
 *   survive until a week after the scheduled job date — otherwise staff
 *   links die before the job happens.
 * • Bookings from before this field existed (sharedAt = null) keep
 *   working so no in-flight links are invalidated by the deploy.
 * • Expired links are ROTATABLE: POST /api/vendors/[id]/bookings/[bookingId]/share
 *   mints a fresh token (and revokes the old one) whenever the stored
 *   token is expired, or when called with ?rotate=1. See that route.
 *
 * Overrides via env: SHARE_LINK_TTL_DAYS=<n>, SHARE_LINK_JOB_GRACE_DAYS=<n>
 * (0/negative TTL disables expiry — not recommended).
 */

export const SHARE_LINK_TTL_DAYS: number = (() => {
  const parsed = Number(process.env.SHARE_LINK_TTL_DAYS ?? 30);
  return Number.isFinite(parsed) ? parsed : 30;
})();

export const SHARE_LINK_JOB_GRACE_DAYS: number = (() => {
  const parsed = Number(process.env.SHARE_LINK_JOB_GRACE_DAYS ?? 7);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 7;
})();

const DAY_MS = 24 * 3600 * 1000;

export interface ShareLinkExpiryInput {
  sharedAt: Date | null;
  scheduledEnd: Date | null;
}

/**
 * Absolute expiry timestamp for a booking share link, or null when the
 * link never expires (legacy link without a timestamp, or expiry
 * disabled by config).
 */
export function shareLinkExpiresAt(
  booking: ShareLinkExpiryInput
): Date | null {
  if (!booking.sharedAt) return null; // legacy link without a timestamp
  if (SHARE_LINK_TTL_DAYS <= 0) return null; // expiry disabled by config

  const fromGeneration = new Date(
    booking.sharedAt.getTime() + SHARE_LINK_TTL_DAYS * DAY_MS
  );

  // Job-aware floor: keep links alive for bookings scheduled far in the
  // future until SHARE_LINK_JOB_GRACE_DAYS after the scheduled end.
  const fromJob = booking.scheduledEnd
    ? new Date(booking.scheduledEnd.getTime() + SHARE_LINK_JOB_GRACE_DAYS * DAY_MS)
    : null;

  if (fromJob && fromJob.getTime() > fromGeneration.getTime()) return fromJob;
  return fromGeneration;
}

export function isShareLinkExpired(booking: ShareLinkExpiryInput): boolean {
  const expiresAt = shareLinkExpiresAt(booking);
  return expiresAt !== null && expiresAt.getTime() < Date.now();
}

export function shareLinkExpiredError(): string {
  return `Share link expired — links are valid for ${SHARE_LINK_TTL_DAYS} days after the vendor generates them (or ${SHARE_LINK_JOB_GRACE_DAYS} days after the scheduled job date, whichever is later). Ask the vendor for a fresh link.`;
}
