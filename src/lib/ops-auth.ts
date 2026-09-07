import { cookies } from "next/headers";
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
      resolveSecret("OPS_JWT_SECRET", "anna-ops-dev-secret", {
        owner: "ops-auth",
      })
    );
  }
  return _secretKey;
}

export interface OpsSession {
  userId: string;
  email: string;
  role: string; // legacy, keep for backward compat
  name: string;
  roleId?: string; // new RBAC
  roleName?: string; // new RBAC
}

export async function getOpsSession(): Promise<OpsSession | null> {
  const key = secretKey(); // resolve BEFORE try — missing prod secret must fail loud, not silently return null
  const cookieStore = await cookies();
  const token = cookieStore.get("ops_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    return payload as unknown as OpsSession;
  } catch {
    return null;
  }
}

export async function createOpsToken(user: {
  id: string;
  email: string;
  role: string;
  name: string;
  roleId?: string;
  roleName?: string;
}): Promise<string> {
  const payload: Record<string, string> = {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  };
  if (user.roleId) payload.roleId = user.roleId;
  if (user.roleName) payload.roleName = user.roleName;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("8h")
    .setIssuedAt()
    .sign(secretKey());
}

export async function clearOpsCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("ops_token");
}

const ROLE_HIERARCHY: Record<string, number> = {
  ADMIN: 3,
  COORDINATOR: 2,
  ANALYST: 1,
};

export function hasMinRole(userRole: string, requiredRole: string): boolean {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
}