import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";
import { getOpsSession, type OpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";

/**
 * Shared API auth guards (remediation cards F1 / F2 / F21).
 *
 * Every household-facing task / booking / escrow / marketing route MUST
 * resolve its actor through one of these guards instead of trusting
 * body/query identifiers. Rules:
 *
 *   - No session cookie at all          → 401 Unauthorized
 *   - Household session, foreign object → 403 Forbidden (IDOR closed)
 *   - Household session, own object     → allowed, householdId is DERIVED
 *                                         from the session and any body /
 *                                         query householdId is ignored.
 *   - Ops session (any role)            → allowed for task/booking guards
 *                                         (ops console acts on all homes);
 *                                         marketing redeem additionally
 *                                         requires marketing:edit.
 *
 * Vendor sessions are intentionally NOT accepted here — vendors have their
 * own `/api/vendors/[id]/...` route family.
 */

export type ApiActor =
  | { kind: "household"; householdId: string; memberId: string }
  | { kind: "ops"; userId: string; session: OpsSession };

export type GuardOk = { ok: true; actor: ApiActor };
export type GuardFail = { ok: false; status: 401 | 403 | 404; error: string };
export type GuardResult = GuardOk | GuardFail;

export function guardErrorResponse(fail: GuardFail): NextResponse {
  return NextResponse.json({ error: fail.error }, { status: fail.status });
}

/** Resolve whichever session is present; null when unauthenticated. */
export async function resolveApiActor(): Promise<ApiActor | null> {
  const hh = await getHouseholdSession();
  if (hh) {
    return { kind: "household", householdId: hh.householdId, memberId: hh.memberId };
  }
  const ops = await getOpsSession();
  if (ops) {
    return { kind: "ops", userId: ops.userId, session: ops };
  }
  return null;
}

/**
 * Guard access to a task-scoped route. Household must own the task;
 * ops is always allowed. 404 leaks nothing (same message as before gating).
 */
export async function guardTaskAccess(taskId: string): Promise<GuardResult> {
  const actor = await resolveApiActor();
  if (!actor) return { ok: false, status: 401, error: "Unauthorized" };
  if (actor.kind === "ops") return { ok: true, actor };

  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { householdId: true },
  });
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  if (task.householdId !== actor.householdId) {
    return { ok: false, status: 403, error: "Forbidden — this task belongs to another household" };
  }
  return { ok: true, actor };
}

/** Guard access to a booking-scoped route (via booking.task.householdId). */
export async function guardBookingAccess(bookingId: string): Promise<GuardResult> {
  const actor = await resolveApiActor();
  if (!actor) return { ok: false, status: 401, error: "Unauthorized" };
  if (actor.kind === "ops") return { ok: true, actor };

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { task: { select: { householdId: true } } },
  });
  if (!booking) return { ok: false, status: 404, error: "Booking not found" };
  if (booking.task.householdId !== actor.householdId) {
    return { ok: false, status: 403, error: "Forbidden — this booking belongs to another household" };
  }
  return { ok: true, actor };
}

/**
 * Resolve which household a household-targeted mutation may act on
 * (used by POST /api/tasks and marketing redeem — F1).
 *
 * - Household session → always its OWN householdId (client-supplied id is
 *   ignored, spoofing impossible).
 * - Ops session → may act on the supplied householdId (programmatic/manual
 *   path), optionally restricted by a permission check at the call site.
 * - Nobody → 401.
 */
export type HouseholdScope =
  | { ok: true; householdId: string; actor: ApiActor }
  | { ok: false; status: 400 | 401 | 403; error: string };

export async function resolveHouseholdScope(
  suppliedHouseholdId: string | null | undefined,
  opts?: { opsPermission?: [resource: string, action: string] }
): Promise<HouseholdScope> {
  const actor = await resolveApiActor();
  if (!actor) return { ok: false, status: 401, error: "Unauthorized" };

  if (actor.kind === "household") {
    return { ok: true, householdId: actor.householdId, actor };
  }

  // Ops path — requires a target household id and (optionally) a permission.
  if (!suppliedHouseholdId) {
    return { ok: false, status: 400, error: "householdId is required for ops callers" };
  }
  if (opts?.opsPermission) {
    const [resource, action] = opts.opsPermission;
    const allowed = await hasPermission(actor.session, resource, action);
    if (!allowed) {
      return { ok: false, status: 403, error: `Forbidden — requires ${resource}:${action}` };
    }
  }
  return { ok: true, householdId: suppliedHouseholdId, actor };
}
