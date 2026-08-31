/**
 * F4 repair script — data/attribution integrity (idempotent, re-runnable).
 *
 * 1) CodeRedemption marker re-key: pre-F4 checkout markers stored the Task
 *    id in the free `bookingId` string (spoofable, no FK). Re-key them onto
 *    the real `taskId` column: every row whose bookingId matches an existing
 *    Task.id (the marker convention) gets taskId set. bookingId is left
 *    as-is for data preservation (restore keys on taskId only).
 *
 * 2) CampaignAttribution swap repair: the pre-F4 write stored the raw
 *    `bookingId` param into CampaignAttribution.taskId (FK → Task). Genuine
 *    Booking ids either failed the FK silently or, where SQLite let them
 *    through, now dangle. Repair: rows whose taskId matches no Task —
 *    resolve via Booking.id → Booking.taskId when possible, else null.
 *
 * 3) Segment filter normalization: legacy/junk Segment.filters rows
 *    (pre-F8 arbitrary JSON) are normalized to the current filter shape
 *    via the tolerant F4 sanitizer (invalid/unknown keys dropped).
 *
 * 4) Legacy expiry-reminder watermark reset (police-wave-b finding 1):
 *    pre-F20 issueVoucher stamped notifiedAt at ISSUANCE, pre-arming the
 *    reminder sweep's watermark — CLAIMED vouchers issued before F20 can
 *    never be reminded. Reset notifiedAt to null for CLAIMED vouchers that
 *    have NO voucher-referenced notification (the F20 reminder fan-out
 *    creates referenceType="voucher" notifications — so legitimately
 *    reminded vouchers keep their watermark and this stays idempotent
 *    even if reminders have already started sending).
 *
 * Usage: bunx tsx scripts/ops/f4-backfill.ts [--dry-run]
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { sanitizeSegmentFilters } from "../../src/lib/marketing/schemas";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (dryRun) console.log("[dry-run] no writes will be performed\n");

  // ── 1) CodeRedemption marker re-key ─────────────────────────────────
  const taskIds = new Set((await db.task.findMany({ select: { id: true } })).map((t) => t.id));
  const redemptionRows = await db.codeRedemption.findMany({
    select: { id: true, bookingId: true, taskId: true },
  });
  const markerTargets = redemptionRows.filter(
    (r) => r.taskId === null && r.bookingId !== null && taskIds.has(r.bookingId)
  );
  console.log(
    `[1] CodeRedemption rows scanned: ${redemptionRows.length}; marker re-key targets (taskId=null, bookingId=Task.id): ${markerTargets.length}`
  );
  let markersBackfilled = 0;
  for (const r of markerTargets) {
    if (!dryRun) {
      await db.codeRedemption.update({
        where: { id: r.id },
        data: { taskId: r.bookingId },
      });
    }
    markersBackfilled++;
  }
  console.log(
    `    ${dryRun ? "would re-key" : "re-keyed"} ${markersBackfilled} marker row(s) onto taskId (bookingId preserved)`
  );

  // ── 2) CampaignAttribution swap repair ──────────────────────────────
  const attributionRows = await db.campaignAttribution.findMany({
    select: { id: true, taskId: true, touchpoint: true },
  });
  const dangling = attributionRows.filter((a) => a.taskId !== null && !taskIds.has(a.taskId));
  console.log(
    `\n[2] CampaignAttribution rows scanned: ${attributionRows.length}; dangling taskIds (no matching Task): ${dangling.length}`
  );
  let attrRepaired = 0;
  let attrNulled = 0;
  for (const a of dangling) {
    // The pre-F4 write stored the bookingId param in taskId — a dangling
    // value here IS a booking id that belongs in the taskId slot only via
    // its Booking.taskId. Resolve or null.
    const booking = await db.booking.findUnique({
      where: { id: a.taskId! },
      select: { taskId: true },
    });
    const resolved = booking && taskIds.has(booking.taskId) ? booking.taskId : null;
    if (!dryRun) {
      await db.campaignAttribution.update({
        where: { id: a.id },
        data: { taskId: resolved },
      });
    }
    if (resolved) attrRepaired++;
    else attrNulled++;
    console.log(
      `    ${dryRun ? "would fix" : "fixed"} ${a.id} (${a.touchpoint}): taskId ${a.taskId} → ${resolved ?? "null"}${booking && !resolved ? " (booking's task no longer exists)" : booking ? "" : " (not a booking id either)"}`
    );
  }
  console.log(
    `    resolved-to-task: ${attrRepaired}, nulled: ${attrNulled} (already-valid rows untouched)`
  );

  // ── 3) Segment filter normalization ─────────────────────────────────
  const segments = await db.segment.findMany({
    select: { id: true, name: true, filters: true },
  });
  console.log(`\n[3] Segments scanned: ${segments.length}`);
  let segmentsRepaired = 0;
  for (const s of segments) {
    const strict = sanitizeSegmentFilters(s.filters);
    // Re-run sanitize on the result to a stable fixpoint (single pass is
    // already stable; this guard just documents it).
    const normalized = strict.filters as unknown as Record<string, unknown>;
    const current = s.filters as unknown as Record<string, unknown>;
    const changed =
      JSON.stringify(normalized ?? {}) !== JSON.stringify(current ?? {});
    if (!changed) continue;
    console.log(
      `    ${dryRun ? "would normalize" : "normalizing"} segment ${s.id} (${s.name})${strict.warnings.length ? ` — ${strict.warnings.join("; ")}` : ""}`
    );
    if (!dryRun) {
      await db.segment.update({
        where: { id: s.id },
        data: { filters: normalized as unknown as Prisma.InputJsonValue },
      });
    }
    segmentsRepaired++;
  }
  console.log(`    segments normalized: ${segmentsRepaired} (already-conformant: ${segments.length - segmentsRepaired})`);

  // ── 4) Legacy expiry-reminder watermark reset (police-wave-b f1) ────
  // Pre-F20 issueVoucher stamped notifiedAt at ISSUANCE, pre-arming the
  // reminder sweep's watermark — CLAIMED vouchers issued before F20 could
  // never be reminded. Reset notifiedAt to null for CLAIMED vouchers with
  // NO voucher-referenced notification (the F20 reminder fan-out creates
  // referenceType "voucher" notifications, so legitimately-reminded
  // vouchers keep their watermark — idempotent even mid-sweep).
  const preStamped = await db.voucher.findMany({
    where: { status: "CLAIMED", notifiedAt: { not: null } },
    select: { id: true },
  });
  let watermarksReset = 0;
  for (const v of preStamped) {
    // Distinguish REMINDER notifications (title "Voucher Expiring Soon") from
    // the VOUCHER_ISSUED fan-out (which also uses referenceType "voucher").
    const reminded = await db.notification.findFirst({
      where: { referenceType: "voucher", referenceId: v.id, title: "Voucher Expiring Soon" },
      select: { id: true },
    });
    if (reminded) continue;
    if (!dryRun) {
      await db.voucher.update({ where: { id: v.id }, data: { notifiedAt: null } });
    }
    watermarksReset++;
  }
  console.log(`    legacy reminder watermarks reset: ${watermarksReset} (of ${preStamped.length} pre-stamped CLAIMED; reminded ones untouched)`);

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(`\n=== F4 backfill ${dryRun ? "(dry-run) " : ""}summary ===`);
  console.log(`  CodeRedemption markers re-keyed: ${markersBackfilled}`);
  console.log(`  CampaignAttribution rows repaired: ${dangling.length} (resolved ${attrRepaired} / nulled ${attrNulled})`);
  console.log(`  Segment filters normalized: ${segmentsRepaired}`);
  console.log(`  Legacy reminder watermarks reset: ${watermarksReset}`);
  console.log("  Re-running this script is safe (all steps are no-ops once applied).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
