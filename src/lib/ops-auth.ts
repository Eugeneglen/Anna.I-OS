import { cookies } from "next/headers";
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

// ─────────────────────────────────────────────────────────────
// P7 (AUDIT-4): per-request re-verification of the JWT's user row.
//
// Previously an 8h ops token trusted its role claims for the whole TTL:
// deactivating a user, or changing/demoting their role, had NO effect
// until the token expired. getOpsSession now re-checks the user row
// (with a short in-process cache to avoid a DB hit on every request):
//   • user deleted or isActive=false  → session invalidated immediately
//   • role / roleId / name changed    → fresh values override the claims
// On a transient DB error the check fails OPEN (the JWT is still
// cryptographically valid) so logins keep working during DB hiccups.
// ─────────────────────────────────────────────────────────────

interface OpsUserVerifyEntry {
  ok: boolean;
  role?: string;
  name?: string;
  roleId?: string;
  roleName?: string;
  expiresAt: number;
}

const OPS_SESSION_VERIFY_TTL_MS = 30_000; // 30s
const opsUserVerifyCache = new Map<string, OpsUserVerifyEntry>();

/** Invalidate the re-verification cache (call after role/isActive changes). */
export function invalidateOpsSessionCache(userId?: string): void {
  if (userId) {
    opsUserVerifyCache.delete(userId);
  } else {
    opsUserVerifyCache.clear();
  }
}

async function verifyOpsUser(userId: string): Promise<OpsUserVerifyEntry | null> {
  const cached = opsUserVerifyCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached;
  }
  try {
    const user = await db.opsUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        name: true,
        role: true,
        roleId: true,
        roleRel: { select: { name: true } },
      },
    });
    const entry: OpsUserVerifyEntry =
      user && user.isActive
        ? {
            ok: true,
            role: user.role,
            name: user.name,
            roleId: user.roleId ?? undefined,
            roleName: user.roleRel?.name,
            expiresAt: Date.now() + OPS_SESSION_VERIFY_TTL_MS,
          }
        : { ok: false, expiresAt: Date.now() + OPS_SESSION_VERIFY_TTL_MS };
    opsUserVerifyCache.set(userId, entry);
    return entry;
  } catch (e) {
    // DB unavailable — fail open on the (still valid) JWT, but log it.
    console.warn("[ops-auth] session re-verification skipped (DB error, fail-open):", e);
    return null;
  }
}

export async function getOpsSession(): Promise<OpsSession | null> {
  const key = secretKey(); // resolve BEFORE try — missing prod secret must fail loud, not silently return null
  const cookieStore = await cookies();
  const token = cookieStore.get("ops_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    const base = payload as unknown as OpsSession;

    // P7: re-verify the user row against the DB (cached ~30s)
    const entry = await verifyOpsUser(base.userId);
    if (entry === null) return base; // DB error — fail open on valid JWT
    if (!entry.ok) return null; // deleted / deactivated — kill session now

    // Fresh DB values override stale token claims (role changes apply
    // within the cache TTL, not the 8h token TTL).
    return {
      ...base,
      role: entry.role ?? base.role,
      name: entry.name ?? base.name,
      roleId: entry.roleId ?? base.roleId,
      roleName: entry.roleName ?? base.roleName,
    };
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

/**
 * P6 (AUDIT-4): map an RBAC role slug → the legacy 3-level OpsRole enum
 * kept in sync on OpsUser.role.
 *
 * IMPORTANT: `operations` maps to COORDINATOR, NOT ADMIN. It previously
 * mapped to ADMIN, which collapsed Operations ≡ Super Admin on every
 * legacy tier-gated (hasMinRole) money/config route — e.g. vendor status
 * changes and config writes require hasMinRole(role, "ADMIN"). Operations
 * is a mid-tier role (RBAC level 3 between coordinator 2 and super_admin
 * 4); the closest SAFE legacy tier is COORDINATOR. Fine-grained authority
 * for operations users comes from their permission set (55 perms), not
 * from the legacy enum.
 */
export function legacyRoleForSlug(
  slug: string
): "ADMIN" | "COORDINATOR" | "ANALYST" {
  switch (slug) {
    case "super_admin":
      return "ADMIN";
    case "operations":
    case "coordinator":
      return "COORDINATOR";
    default:
      return "ANALYST";
  }
}