import { cookies, headers } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { db } from "@/lib/db";
import { resolveSecret } from "@/lib/secrets";

// Lazy, memoized secret resolution. Resolved on first USE (not at module
// import) so `next build` can collect page data without deployment secrets
// configured. Production still fails fast on the first request that needs
// the secret.
let _secretKey: Uint8Array | null = null;
function secretKey(): Uint8Array {
  if (!_secretKey) {
    _secretKey = new TextEncoder().encode(
      resolveSecret("VENDOR_JWT_SECRET", "anna-vendor-dev-secret", {
        owner: "vendor-auth",
      })
    );
  }
  return _secretKey;
}

export interface VendorSession {
  vendorId: string;   // parent Vendor.id (the business the user acts for)
  userId?: string;    // VendorUser.id — present when the actor is an HQ staff user (not the vendor owner)
  isStaff: boolean;   // true = HQ staff (VendorUser), false = vendor owner (Vendor table)
  email: string;
  name: string;
  vendorType: string;
  status: string;
}

// ─────────────────────────────────────────────────────────────
// P7 (AUDIT-4): per-request re-verification of vendor sessions.
//
// Previously a 24h vendor token was UNREVOCABLE: suspending the vendor
// (Vendor.status != ACTIVE) or deactivating an HQ staff user
// (VendorUser.isActive=false) had no effect until token expiry.
// getVendorSession now re-checks the underlying row (cached ~30s in
// process) and returns null when the actor has been cut off. DB errors
// fail open (JWT still cryptographically valid).
// ─────────────────────────────────────────────────────────────

interface VendorVerifyEntry {
  ok: boolean;
  status?: string;
  expiresAt: number;
}

const VENDOR_SESSION_VERIFY_TTL_MS = 30_000; // 30s
const vendorVerifyCache = new Map<string, VendorVerifyEntry>();

async function verifyVendorActor(session: VendorSession): Promise<VendorVerifyEntry | null> {
  const cacheKey = session.isStaff ? `staff:${session.userId}` : `vendor:${session.vendorId}`;
  const cached = vendorVerifyCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached;
  }
  try {
    let entry: VendorVerifyEntry;
    if (session.isStaff && session.userId) {
      const user = await db.vendorUser.findUnique({
        where: { id: session.userId },
        select: { id: true, isActive: true, vendor: { select: { status: true } } },
      });
      entry =
        user && user.isActive && user.vendor.status === "ACTIVE"
          ? { ok: true, status: user.vendor.status, expiresAt: Date.now() + VENDOR_SESSION_VERIFY_TTL_MS }
          : { ok: false, expiresAt: Date.now() + VENDOR_SESSION_VERIFY_TTL_MS };
    } else {
      const vendor = await db.vendor.findUnique({
        where: { id: session.vendorId },
        select: { id: true, status: true },
      });
      entry =
        vendor && vendor.status === "ACTIVE"
          ? { ok: true, status: vendor.status, expiresAt: Date.now() + VENDOR_SESSION_VERIFY_TTL_MS }
          : { ok: false, expiresAt: Date.now() + VENDOR_SESSION_VERIFY_TTL_MS };
    }
    vendorVerifyCache.set(cacheKey, entry);
    return entry;
  } catch (e) {
    console.warn("[vendor-auth] session re-verification skipped (DB error, fail-open):", e);
    return null;
  }
}

async function verifyVendorSessionPayload(payload: unknown): Promise<VendorSession | null> {
  const session = payload as unknown as VendorSession;
  const entry = await verifyVendorActor(session);
  if (entry === null) return session; // DB error — fail open on valid JWT
  if (!entry.ok) return null; // suspended / deactivated — kill session now
  // Refresh the status claim so freshly-suspended vendors can't keep
  // presenting a stale "ACTIVE" status from the token.
  return { ...session, status: entry.status ?? session.status };
}

export async function getVendorSession(): Promise<VendorSession | null> {
  // Resolve BEFORE the try blocks — a missing production secret must fail
  // loud (500 with clear error) instead of silently returning null, which
  // would make every login fail with a misleading "invalid credentials".
  const key = secretKey();

  // 1. Check Authorization header (set by vendorFetch for multi-tab support).
  //    Each browser tab stores its own JWT in sessionStorage and sends
  //    it via the Authorization header, preventing cookie collision.
  try {
    const headersList = await headers();
    const authHeader = headersList.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { payload } = await jwtVerify(token, key);
      return await verifyVendorSessionPayload(payload);
    }
  } catch {
    // Fall through to cookie check
  }

  // 2. Fall back to vendor_token cookie (for middleware / SSR / single-tab)
  const cookieStore = await cookies();
  const token = cookieStore.get("vendor_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    return await verifyVendorSessionPayload(payload);
  } catch {
    return null;
  }
}

// Token for a vendor OWNER (logs in via Vendor table). Backward-compatible shape.
export async function createVendorToken(vendor: {
  id: string;
  email: string;
  name: string;
  vendorType: string;
  status: string;
}): Promise<string> {
  return new SignJWT({
    vendorId: vendor.id,
    isStaff: false,
    email: vendor.email,
    name: vendor.name,
    vendorType: vendor.vendorType,
    status: vendor.status,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .setIssuedAt()
    .sign(secretKey());
}

// Token for an HQ staff USER (logs in via VendorUser table). Carries the
// parent vendorId so all vendor-scoped APIs continue to work unchanged.
export async function createVendorUserToken(params: {
  userId: string;       // VendorUser.id
  vendorId: string;     // parent Vendor.id
  email: string;
  name: string;
  vendorType: string;   // denormalised from parent Vendor for convenience
  status: string;       // VendorUser.isActive ? "ACTIVE" : "SUSPENDED"
}): Promise<string> {
  return new SignJWT({
    vendorId: params.vendorId,
    userId: params.userId,
    isStaff: true,
    email: params.email,
    name: params.name,
    vendorType: params.vendorType,
    status: params.status,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .setIssuedAt()
    .sign(secretKey());
}

export async function verifyVendorToken(token: string): Promise<VendorSession | null> {
  const key = secretKey(); // resolve BEFORE try — missing prod secret must fail loud
  try {
    const { payload } = await jwtVerify(token, key);
    return payload as unknown as VendorSession;
  } catch {
    return null;
  }
}
