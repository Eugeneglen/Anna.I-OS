/**
 * Two-Way Refund Split — backfill + reconciliation
 * ================================================
 *
 * The two-way split policy (household cash leg ‖ platform promo leg) was
 * retrofitted onto live data. This script makes the existing DB coherent:
 *
 *   A. Cancel-path refunds that never wrote Refund rows (FIN-AUDIT-3:
 *      "refund trail misses 41% of refund value ($420)") → write the
 *      missing trail rows with both legs.
 *   B. Fully-refunded platform-discounted entries whose platform leg was
 *      never stamped (dispute-path and cancel-path alike) → stamp
 *      subsidyReversedCents on the entry and platformDiscountCents on the
 *      refund event that exhausted the household cash (the last row).
 *   C. Zero-cash 100%-discount refunds → trail row with a zero household
 *      leg and the full platform leg.
 *   D. Reconciliation report — the two invariants:
 *        Σ Refund.amountCents          = escrow.refundCents        (per entry)
 *        Σ Refund.platformDiscountCents = escrow.subsidyReversedCents (per entry)
 *      plus platform subsidy drawn (audit) vs reversed → net spend.
 *
 * Idempotent: A/B/C are keyed (idempotency keys / max()-style stamps), so
 * re-running is a no-op. D is read-only.
 *
 * Usage: bunx tsx scripts/ops/backfill-refund-split.ts [--dry]
 */
import { db } from "../../src/lib/db";
import { EscrowState } from "@prisma/client";
import { isPlatformFundedDiscount } from "../../src/lib/payments/calculations";

/** Platform leg owed by a fully-refunded entry (0 otherwise). */
function platformLegOwed(entry: {
  amountCents: number;
  refundCents: number;
  discountCents: number;
  originalAmountCents: number;
  discountFundedBy: string;
  subsidyReversedCents: number;
}): number {
  const fullyRefunded = entry.refundCents >= entry.amountCents;
  if (!fullyRefunded || !isPlatformFundedDiscount(entry)) return 0;
  return Math.max(0, entry.discountCents - (entry.subsidyReversedCents || 0));
}

async function main() {
  const dry = process.argv.includes("--dry");
  let rowsWritten = 0;
  let entriesStamped = 0;

  const entries = await db.escrowLedger.findMany({
    where: { refundCents: { gt: 0 } },
    include: { refunds: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  // C-qualifiers: zero-cash fully-refunded discounted entries (refundCents=0
  // but the discount still needs its reversal trail).
  const zeroCashEntries = await db.escrowLedger.findMany({
    where: { amountCents: 0, state: EscrowState.REFUNDED, discountCents: { gt: 0 } },
    include: { refunds: true, task: { select: { id: true, jobNo: true } } },
    orderBy: { createdAt: "asc" },
  });

  for (const entry of [...entries, ...zeroCashEntries]) {
    const label = entry.task?.jobNo ?? entry.taskId.slice(-6);
    const legOwed = platformLegOwed(entry);
    const trailCash = entry.refunds.reduce((s, r) => s + r.amountCents, 0);
    const trailPlatform = entry.refunds.reduce((s, r) => s + (r.platformDiscountCents || 0), 0);

    // ── A: missing trail rows (cash leg with no Refund row at all) ──
    if (entry.refunds.length === 0 && entry.refundCents > 0) {
      const platformLeg = legOwed;
      console.log(
        `[backfill-A] ${dry ? "[dry] " : ""}${label}: writing missing cancel-path refund row — cash $${(entry.refundCents / 100).toFixed(2)} ‖ promo $${(platformLeg / 100).toFixed(2)}`
      );
      if (!dry) {
        await db.refund.create({
          data: {
            escrowLedgerId: entry.id,
            amountCents: entry.refundCents,
            platformDiscountCents: platformLeg,
            reason: "Backfill: cancel-path refund pre-split — trail row reconstructed (two-way split policy)",
            issuedById: null,
            issuedByName: "system backfill",
            idempotencyKey: `backfill-refund-${entry.id}`,
            stripeStatus: "succeeded", // NoOp payment pilot
          },
        });
        rowsWritten += 1;
        if (platformLeg > 0) {
          await db.escrowLedger.update({
            where: { id: entry.id },
            data: { subsidyReversedCents: { increment: platformLeg } },
          });
          entriesStamped += 1;
        }
      }
      continue;
    }

    // ── C: zero-cash full refund (100% platform-funded discount), no row ──
    if (entry.refunds.length === 0 && entry.refundCents === 0 && entry.amountCents === 0 && legOwed > 0) {
      console.log(
        `[backfill-C] ${dry ? "[dry] " : ""}${label}: zero-cash refund — writing platform-leg-only row $${(legOwed / 100).toFixed(2)}`
      );
      if (!dry) {
        await db.refund.create({
          data: {
            escrowLedgerId: entry.id,
            amountCents: 0,
            platformDiscountCents: legOwed,
            reason: "Backfill: zero-cash full refund — platform-funded discount reversed (two-way split policy)",
            issuedById: null,
            issuedByName: "system backfill",
            idempotencyKey: `backfill-refund-zero-${entry.id}`,
            stripeStatus: "succeeded",
          },
        });
        rowsWritten += 1;
        await db.escrowLedger.update({
          where: { id: entry.id },
          data: { subsidyReversedCents: { increment: legOwed } },
        });
        entriesStamped += 1;
      }
      continue;
    }

    // ── B: trail rows exist but the platform leg was never stamped ──
    if (entry.refunds.length > 0 && legOwed > 0 && trailPlatform === 0) {
      // Stamp the event that exhausted the household cash — the last refund
      // row whose cumulative cash reaches refundCents (for full refunds via
      // a single event: the only row).
      const last = entry.refunds[entry.refunds.length - 1];
      console.log(
        `[backfill-B] ${dry ? "[dry] " : ""}${label}: stamping platform leg $${(legOwed / 100).toFixed(2)} on refund row ${last.id.slice(-6)} + entry`
      );
      if (!dry) {
        await db.refund.update({
          where: { id: last.id },
          data: { platformDiscountCents: legOwed },
        });
        await db.escrowLedger.update({
          where: { id: entry.id },
          data: { subsidyReversedCents: { increment: legOwed } },
        });
        entriesStamped += 1;
      }
      continue;
    }

    if (entry.refundCents > 0 && trailCash !== entry.refundCents) {
      console.log(
        `[backfill-WARN] ${label}: trail cash $${(trailCash / 100).toFixed(2)} ≠ entry refundCents $${(entry.refundCents / 100).toFixed(2)} — manual review needed`
      );
    }
  }

  console.log(
    `\n[backfill] ${dry ? "[dry] " : ""}rows written: ${rowsWritten}, entries stamped: ${entriesStamped}`
  );

  // ── D: reconciliation report (always runs, read-only) ──
  const allEntries = await db.escrowLedger.findMany({
    include: { refunds: true },
  });
  let mismatch = 0;
  let sumCash = 0;
  let sumPlatform = 0;
  for (const e of allEntries) {
    const trailCash = e.refunds.reduce((s, r) => s + r.amountCents, 0);
    const trailPlatform = e.refunds.reduce((s, r) => s + (r.platformDiscountCents || 0), 0);
    sumCash += trailCash;
    sumPlatform += trailPlatform;
    if (trailCash !== e.refundCents || trailPlatform !== (e.subsidyReversedCents || 0)) {
      mismatch += 1;
      console.log(
        `[reconcile-MISMATCH] entry ${e.id.slice(-6)} task=${e.taskId.slice(-6)}: trail cash ${trailCash} vs refundCents ${e.refundCents}; trail promo ${trailPlatform} vs subsidyReversed ${e.subsidyReversedCents}`
      );
    }
  }

  // Platform subsidy drawn at release (audit) vs reversed → subsidy ledger
  const subsidyLogs = await db.auditLog.findMany({
    where: { action: "PLATFORM_SUBSIDY_DRAWN" },
    select: { metadata: true },
  });
  let drawn = 0;
  for (const log of subsidyLogs) {
    const meta = log.metadata as Record<string, unknown> | null;
    drawn += (meta?.platformSubsidyDrawnCents as number) || 0;
  }
  // Subsidy ledger partition (each discounted entry falls in exactly one
  // bucket, so conservation always holds — even after post-release refunds
  // move an entry from still-drawn to reversed):
  //   still-drawn = released, discount not reversed (realized spend)
  //   reversed    = subsidyReversedCents > 0 (promo restored)
  //   in-flight   = not released, not reversed (pending)
  const discounted = await db.escrowLedger.findMany({
    where: { discountCents: { gt: 0 } },
    select: { discountCents: true, state: true, releasedAt: true, subsidyReversedCents: true },
  });
  const stillDrawn = discounted
    .filter((e) => e.releasedAt && (e.subsidyReversedCents || 0) === 0)
    .reduce((s, e) => s + e.discountCents, 0);
  const inFlight = discounted
    .filter((e) => !e.releasedAt && (e.subsidyReversedCents || 0) === 0)
    .reduce((s, e) => s + e.discountCents, 0);
  const totalDiscounts = discounted.reduce((s, e) => s + e.discountCents, 0);

  console.log("\n[reconcile] two-way refund split — ledger totals");
  console.log(`  Σ Refund.amountCents (household cash leg)          = $${(sumCash / 100).toFixed(2)}`);
  console.log(`  Σ escrow.refundCents (household cash leg)          = $${(allEntries.reduce((s, e) => s + e.refundCents, 0) / 100).toFixed(2)}`);
  console.log(`  Σ Refund.platformDiscountCents (platform promo leg) = $${(sumPlatform / 100).toFixed(2)}`);
  console.log(`  Σ escrow.subsidyReversedCents (platform promo leg)  = $${(allEntries.reduce((s, e) => s + (e.subsidyReversedCents || 0), 0) / 100).toFixed(2)}`);
  console.log("  subsidy ledger (platform marketing view):");
  console.log(`    drawn at release (historical, audit log)         = $${(drawn / 100).toFixed(2)}`);
  console.log(`    still-drawn (released, not reversed — spend)     = $${(stillDrawn / 100).toFixed(2)}`);
  console.log(`    reversed by refunds (promo restored)            = $${(sumPlatform / 100).toFixed(2)}`);
  console.log(`    in-flight (discounted, not yet released)         = $${(inFlight / 100).toFixed(2)}`);
  console.log(`    conservation Σ discount = still-drawn + reversed + in-flight → $${(totalDiscounts / 100).toFixed(2)} = $${(stillDrawn / 100).toFixed(2)} + $${(sumPlatform / 100).toFixed(2)} + $${(inFlight / 100).toFixed(2)} ${totalDiscounts === stillDrawn + sumPlatform + inFlight ? "✓" : "✗"}`);
  console.log(`  invariant mismatches: ${mismatch}${mismatch === 0 ? " ✓ (both invariants hold on every entry)" : " ✗"}`);
}

main()
  .catch((e) => {
    console.error("[backfill-refund-split] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
