import { cookies, headers } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
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
      return payload as unknown as VendorSession;
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
    return payload as unknown as VendorSession;
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
