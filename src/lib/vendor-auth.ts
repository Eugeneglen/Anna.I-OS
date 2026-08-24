import { cookies, headers } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

const JWT_SECRET = process.env.VENDOR_JWT_SECRET || "anna-vendor-dev-secret";
const secret = new TextEncoder().encode(JWT_SECRET);

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
  // 1. Check Authorization header (set by vendorFetch for multi-tab support).
  //    Each browser tab stores its own JWT in sessionStorage and sends
  //    it via the Authorization header, preventing cookie collision.
  try {
    const headersList = await headers();
    const authHeader = headersList.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { payload } = await jwtVerify(token, secret);
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
    const { payload } = await jwtVerify(token, secret);
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
    .sign(secret);
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
    .sign(secret);
}

export async function verifyVendorToken(token: string): Promise<VendorSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as VendorSession;
  } catch {
    return null;
  }
}
