/**
 * Response sanitisation helpers (FIX-1a item 4).
 * ============================================
 *
 * bcrypt passwordHash strings (and vendor verificationData — NRIC /
 * background-check documents) must never leave the server in an API
 * response. Login/reset routes legitimately READ these columns to verify
 * credentials; every other surface strips them before serialising.
 *
 * These helpers work on plain objects (post-Prisma rows), returning shallow
 * copies with the secret fields removed.
 */

/** Vendor row secrets: portal password hash + KYC/verification documents. */
export function stripVendorSecrets<T extends { passwordHash?: string | null; verificationData?: unknown }>(
  vendor: T
): Omit<T, "passwordHash" | "verificationData"> {
  const { passwordHash: _passwordHash, verificationData: _verificationData, ...safe } = vendor;
  return safe;
}

/** FamilyMember row secret: household portal password hash. */
export function stripMemberSecrets<T extends { passwordHash?: string | null }>(
  member: T
): Omit<T, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safe } = member;
  return safe;
}
