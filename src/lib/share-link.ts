/**
 * P8 (AUDIT-4): share-link expiry.
 *
 * Booking share tokens are 72-bit random strings with a full job-detail
 * payload behind them (address, schedule, amounts, staff contact). They
 * were previously IMMORTAL — a link leaked once (WhatsApp screenshot,
 * log file, referrer header) exposed that household's job data forever.
 *
 * A link now expires SHARE_LINK_TTL_DAYS (default 30) after it was
 * generated (Booking.sharedAt). Bookings from before this field existed
 * (sharedAt = null) keep working so no in-flight links are invalidated
 * by the deploy.
 *
 * Override via env: SHARE_LINK_TTL_DAYS=<n> (0/negative disables expiry —
 * not recommended).
 */
export const SHARE_LINK_TTL_DAYS: number = (() => {
  const parsed = Number(process.env.SHARE_LINK_TTL_DAYS ?? 30);
  return Number.isFinite(parsed) ? parsed : 30;
})();

export function isShareLinkExpired(booking: { sharedAt: Date | null }): boolean {
  if (!booking.sharedAt) return false; // legacy link without a timestamp
  if (SHARE_LINK_TTL_DAYS <= 0) return false; // expiry disabled by config
  const expiresAt =
    booking.sharedAt.getTime() + SHARE_LINK_TTL_DAYS * 24 * 3600 * 1000;
  return expiresAt < Date.now();
}

export function shareLinkExpiredError(): string {
  return `Share link expired — links are valid for ${SHARE_LINK_TTL_DAYS} days after the vendor generates them. Ask the vendor for a fresh link.`;
}
