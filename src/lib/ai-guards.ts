import { NextResponse } from "next/server";
import { getOpsSession, hasMinRole, type OpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";

// ─────────────────────────────────────────────────────────────
// AI Governance guards (L4 foundation · Phase 1 · Step 1.1)
//
// Enforces the ai:* RBAC permissions at the API level. Uses the
// EXISTING permission system (Permission/RolePermission/Role tables +
// hasPermission) — no parallel permission store.
//
// ai:recommend — generate advisory AI output (ops AI chat, insights)
// ai:prepare   — trigger AI case-brief preparation for human review
// ai:approve   — record human decisions on AI case briefs
// ai:configure — change AI governance configuration
//
// Permission authority covers the AI OUTPUT lifecycle only. It never
// grants execution: money/dispute execution continues to flow through the
// existing gated services (ops escrow PATCH + refundConfirmed
// maker-checker 409). ai:approve records a human decision on a brief; it
// does not move funds.
// ─────────────────────────────────────────────────────────────

export type AiPermissionAction = "recommend" | "prepare" | "approve" | "configure";

export type AiGuardOk = { ok: true; session: OpsSession };
export type AiGuardFail = { ok: false; status: 401 | 403; error: string };
export type AiGuardResult = AiGuardOk | AiGuardFail;

export function aiGuardErrorResponse(fail: AiGuardFail): NextResponse {
  return NextResponse.json({ error: fail.error }, { status: fail.status });
}

/**
 * Guard an ops-side AI route with an ai:* permission.
 *
 *   - no session            → 401 Unauthorized
 *   - session without perm  → 403 Forbidden
 *   - session with perm     → ok (session returned for audit attribution)
 *
 * Legacy sessions without roleId fall back to the existing hasPermission
 * legacy path (ADMIN-tier), consistent with every other permission check
 * in the codebase.
 */
export async function requireAiPermission(
  action: AiPermissionAction
): Promise<AiGuardResult> {
  const session = await getOpsSession();
  if (!session) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const allowed = await hasPermission(session, "ai", action);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: `Forbidden — requires ai:${action}`,
    };
  }
  return { ok: true, session };
}

/**
 * Scope check helper for the AI governance surfaces: given a session and
 * an optional target household, decide whether the session may prepare
 * AI output about that household. Ops with ai:prepare may; anyone else
 * cannot reach this point (they were already rejected by
 * requireAiPermission at the route level).
 */
export async function mayPrepareForHousehold(
  session: OpsSession,
  _householdId: string
): Promise<boolean> {
  // Route-level guard already established ai:prepare / ai:recommend.
  // Ops staff have cross-household visibility by design (mirrors
  // resolveApiActor's ops branch: "the console acts on all homes").
  return hasMinRole(session.role, "ANALYST");
}
