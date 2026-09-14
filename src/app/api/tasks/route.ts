import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { ServiceCategory, TaskStatus } from "@prisma/client"
import { triggerAutomationOnTaskCreated } from "@/lib/automation"
import { isCategoryActive } from "@/lib/get-active-categories"
import { validateRedemption } from "@/lib/marketing/campaign-service"
import { generateJobNo } from "@/lib/job-number"
import { resolveHouseholdScope } from "@/lib/api-guards"
import {
  quoteJobType,
  stampTaskAmounts,
} from "@/lib/service-authority"

const attachmentSchema = z.object({
  fileUrl: z.string(),
  fileType: z.enum(["PHOTO", "VIDEO"]),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
})

const createTaskSchema = z.object({
  householdId: z.string().min(1),
  category: z.nativeEnum(ServiceCategory),
  instructions: z.string().optional(),
  amountCents: z.number().int().positive(),
  // ── Service/Pricing/Availability Authority ──
  // Number of units for per-unit catalogue services (e.g. 2 aircon
  // units). Used ONLY by the server-side quote engine — the client
  // amountCents is never a pricing authority for catalogue services.
  units: z.number().int().min(1).max(999).optional(),
  // ── F-3 (Item 8): dynamic-field answers for the no-quotation catalogue
  // path — the AUTHORITATIVE values the server quotes from (the client
  // cannot silently fall back to defaults by omitting them, and its
  // amountCents is never read here).
  fieldValues: z.record(z.string(), z.number()).optional(),
  discountCode: z.string().optional(), // optional promo code
  recurrencePattern: z.object({ type: z.string(), interval: z.number() }).nullable().optional(),
  scheduledStart: z.string().optional().refine(
    (val) => {
      if (!val) return true; // optional — skip if not provided
      // Reject dates before today (Singapore timezone)
      const todaySG = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Singapore" });
      const dateOnly = val.substring(0, 10); // extract YYYY-MM-DD
      return dateOnly >= todaySG;
    },
    { message: "Scheduled date cannot be in the past" }
  ),
  attachments: z.array(attachmentSchema).optional(),
  jobTypeId: z.string().nullable().optional(),
  quotationId: z.string().nullable().optional(),
  // Idempotency: a client-supplied key. If a task with the same
  // householdId + idempotencyKey exists within the last 60s, the existing
  // task is returned unchanged — preventing double-clicks / network retries
  // from spawning duplicate bookings (audit proposal E).
  idempotencyKey: z.string().max(200).optional(),
})

// GET /api/tasks?householdId=xxx
export async function GET(request: Request) {
  try {
    // ── F21 auth gate (audit C7 family) ── task lists expose vendor
    // contact info + escrow amounts: household session sees ONLY its own
    // tasks (query param must match the session); ops may list any home.
    const scope = await resolveHouseholdScope(new URL(request.url).searchParams.get("householdId"))
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const householdId = scope.householdId

    const tasks = await db.task.findMany({
      where: {
        householdId,
        // Exclude cancelled predicted tasks
        OR: [
          { cancelledAt: null },
          { status: { not: "PREDICTED" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        // H-7 FIX: Add jobType and quotation includes
        jobType: { select: { id: true, name: true, slug: true } },
        quotation: { select: { id: true, totalCents: true, breakdown: true } },
        bookings: {
          include: {
            vendor: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                categories: true,
                status: true,
              },
            },
          },
        },
        verificationPhotos: true,
        escrowEntries: true,
        attachments: true,
      },
    })

    return NextResponse.json({ tasks })
  } catch (error) {
    console.error("GET /api/tasks error:", error)
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    )
  }
}

// POST /api/tasks
export async function POST(request: Request) {
  try {
    // ── F17 (police-1a f4): auth gate BEFORE body validation ── an
    // unauthenticated caller with an invalid body must get 401, not 400.
    // The raw body is only READ here (parse failures fall through to the
    // schema check below); only the householdId hint is peeked at, and a
    // household session ignores it anyway (F1: scope is session-derived).
    const body = await request.json().catch(() => ({}))
    const scope = await resolveHouseholdScope(
      typeof body?.householdId === "string" ? body.householdId : undefined
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const householdId = scope.householdId

    const parsed = createTaskSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { category, instructions, amountCents, units, fieldValues, discountCode, recurrencePattern, scheduledStart, attachments, jobTypeId, quotationId, idempotencyKey } = parsed.data

    // Category active guard — reject if category is currently unavailable
    const categoryActive = await isCategoryActive(category)
    if (!categoryActive) {
      return NextResponse.json(
        { error: `Category ${category} is currently unavailable`, code: "CATEGORY_INACTIVE" },
        { status: 403 }
      )
    }

    // M-1 FIX: Validate household exists
    const household = await db.household.findUnique({ where: { id: householdId } })
    if (!household) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 })
    }

    // Idempotency: if the client supplied an idempotencyKey AND we already
    // have a task for this household with that key created within the last
    // 60 seconds, return the existing task instead of creating a duplicate.
    // (Audit proposal E §3.) We deliberately allow replay AFTER 60s so a
    // stuck retry loop eventually does create a fresh task.
    if (idempotencyKey) {
      const sixtySecondsAgo = new Date(Date.now() - 60_000)
      const existing = await db.task.findFirst({
        where: {
          householdId,
          idempotencyKey,
          createdAt: { gte: sixtySecondsAgo },
        },
        include: { attachments: true },
      })
      if (existing) {
        return NextResponse.json({ task: existing, idempotentReplay: true }, { status: 200 })
      }
    }

    // If quotationId provided, validate it exists and belongs to this household
    let finalAmountCents = amountCents;
    if (quotationId) {
      const quotation = await db.quotation.findUnique({
        where: { id: quotationId },
      });
      if (!quotation) {
        return NextResponse.json(
          { error: "Quotation not found" },
          { status: 404 }
        );
      }
      if (quotation.householdId !== householdId) {
        return NextResponse.json(
          { error: "Quotation does not belong to this household" },
          { status: 400 }
        );
      }
      if (quotation.status !== "DRAFT") {
        return NextResponse.json(
          { error: "Quotation is not in DRAFT status" },
          { status: 409 }
        );
      }
      // ── F-3 (Item 8): quotation ↔ jobType linkage ──
      // When the caller names BOTH a quotation and a jobTypeId, they must
      // be the SAME service — a quotation for the gas top-up can never be
      // used to book the chemical wash at the gas quote's price.
      if (jobTypeId && jobTypeId !== quotation.jobTypeId) {
        return NextResponse.json(
          {
            error: "The quotation does not belong to this job type — request a fresh quote for the service you are booking",
            code: "QUOTATION_JOB_TYPE_MISMATCH",
          },
          { status: 400 }
        );
      }
      // ── F-3 (Item 8): PRICE_STALE — the quotation is a SNAPSHOT ──
      // Re-price the quotation's config against the CURRENT catalogue
      // (the same authority that produced it). If the live price has moved
      // since the household saw the quote, refuse: the displayed price and
      // the booked price must never silently diverge.
      const recheck = await quoteJobType(
        quotation.jobTypeId,
        {
          fieldValues: (quotation.fieldValues as Record<string, number>) ?? {},
          selectedAddOns: (quotation.selectedAddOns as string[]) ?? [],
        }
      );
      if (recheck.ok && recheck.quote.totalCents !== quotation.totalCents) {
        return NextResponse.json(
          {
            error: `The price of this service has changed since the quote was displayed (quoted SGD $${(quotation.totalCents / 100).toFixed(2)}, now SGD $${(recheck.quote.totalCents / 100).toFixed(2)}). Request a fresh quote to book at the current price.`,
            code: "PRICE_STALE",
          },
          { status: 409 }
        );
      }
      finalAmountCents = quotation.totalCents;
    }

    // ── Service/Pricing/Availability Authority (supersedes P5/AUDIT-3) ──
    // Pricing precedence — the Ops-managed catalogue is the sole authority:
    //   1. quotationId  → quotation.totalCents (server-calculated from the
    //                     catalogue by calculateQuote at /api/quote —
    //                     includes units, multipliers, surcharges, add-ons)
    //   2. jobTypeId    → LIVE catalogue quote via calculateQuote() with the
    //                     requested `units` (or the field defaults). The
    //                     client-sent amountCents is IGNORED for catalogue
    //                     services. Previously this path stamped the FLAT
    //                     basePriceCents, silently dropping per-unit math
    //                     (a 2-unit gas top-up was booked at the 1-unit
    //                     price).
    //   3. neither      → explicit off-catalogue "custom request": the
    //                     client-stated amount is the household's budget
    //                     for a non-catalogue job — sanity-capped and
    //                     stamped metadata.pricingSource="custom_request"
    //                     so it can never masquerade as catalogue pricing.
    if (jobTypeId && !quotationId) {
      const authority = await quoteJobType(jobTypeId, { units, fieldValues });
      if (!authority.ok && authority.code === "NOT_FOUND") {
        return NextResponse.json(
          { error: "Unknown job type", code: "JOB_TYPE_NOT_FOUND" },
          { status: 400 }
        );
      }
      if (authority.ok && authority.jobType.category !== category) {
        return NextResponse.json(
          {
            error: `Job type "${authority.jobType.name}" belongs to category ${authority.jobType.category}, not ${category}`,
            code: "JOB_TYPE_CATEGORY_MISMATCH",
          },
          { status: 400 }
        );
      }
      if (!authority.ok && authority.code === "INACTIVE") {
        return NextResponse.json(
          { error: authority.message, code: "JOB_TYPE_INACTIVE" },
          { status: 403 }
        );
      }
      if (!authority.ok && authority.code === "UNITS_OUT_OF_RANGE") {
        return NextResponse.json(
          { error: authority.message, code: "UNITS_OUT_OF_RANGE" },
          { status: 400 }
        );
      }
      if (!authority.ok) {
        return NextResponse.json(
          { error: "Cannot price this service from the catalogue", code: "QUOTE_FAILED" },
          { status: 400 }
        );
      }
      finalAmountCents = authority.quote.totalCents;
    }

    // Ad-hoc tasks (no catalog job type, no quotation): the amount stays
    // client-supplied, but is sanity-capped so a tampered/buggy client
    // cannot mint a six-figure charge into the escrow flow.
    const MAX_ADHOC_TASK_CENTS = 10_000_000; // $100k — matches F8 campaign bound convention
    if (!jobTypeId && !quotationId && finalAmountCents > MAX_ADHOC_TASK_CENTS) {
      return NextResponse.json(
        {
          error: `Task amount exceeds the maximum allowed (SGD $${(MAX_ADHOC_TASK_CENTS / 100).toLocaleString()}). Use a quoted service for larger jobs.`,
          code: "AMOUNT_TOO_LARGE",
        },
        { status: 400 }
      );
    }

    // Validate discount code if provided (before creating the task).
    // The result is fed into the same transaction that creates the task
    // AND applies the redemption — so if applyRedemption fails, the task
    // creation rolls back too (audit proposal E §1, §2).
    let discountCents = 0;
    let discountCodeId: string | null = null;
    let discountCampaignId: string | null = null;
    if (discountCode && discountCode.trim()) {
      const redemption = await validateRedemption({
        code: discountCode.trim(),
        householdId,
        orderValueCents: finalAmountCents,
        orderType: "job",
        category,
      });
      if (!redemption.valid) {
        return NextResponse.json(
          { error: `Discount code invalid: ${redemption.reason}`, code: "DISCOUNT_INVALID" },
          { status: 400 }
        );
      }
      discountCents = redemption.discountCents || 0;
      discountCodeId = redemption.codeId || null;
      discountCampaignId = redemption.campaignId || null;
    }

    // Ensure HouseholdCategoryAutonomy exists for this household+category
    await db.householdCategoryAutonomy.upsert({
      where: {
        householdId_category: { householdId, category },
      },
      create: {
        householdId,
        category,
        currentLevel: 1,
        verifiedCyclesAtLevel: 0,
        totalVerifiedCycles: 0,
        promotionPaused: false,
      },
      update: {},
    })

    // ── Two-phase commit (audit proposal E §1, §2) ──
    // Wrap the task.create + applyRedemption in a SINGLE transaction so a
    // failure in applyRedemption (e.g. concurrent redemption took the last
    // use between validate and apply) rolls back the task creation too.
    // Previously the task was created in its own transaction and the
    // redemption ran separately — leaving a task without the discount but
    // a "success" toast to the user.
    const MAX_JOB_NO_RETRIES = 5;
    let task;
    let lastCreateError: unknown = null;
    let redemptionFailureReason: string | null = null;
    // ── Price-authority audit stamp ── records which authority priced
    // this task (quotation | catalogue | custom_request). Snapshot rule:
    // these amounts are frozen at creation; later Ops catalogue edits
    // never retro-change them.
    const pricingSource = quotationId
      ? "quotation"
      : jobTypeId
        ? "catalogue"
        : "custom_request";
    const stamped = stampTaskAmounts(finalAmountCents, discountCents);
    for (let attempt = 0; attempt < MAX_JOB_NO_RETRIES; attempt++) {
      try {
        task = await db.$transaction(async (tx) => {
          const jobNo = await generateJobNo(tx);
          const created = await tx.task.create({
            data: {
              jobNo,
              householdId,
              category,
              status: TaskStatus.CREATED,
              instructions: instructions ?? null,
              instructionsSource: "new",
              amountCents: stamped.amountCents,
              discountCents: stamped.discountCents,
              discountCodeId,
              finalAmountCents: stamped.finalAmountCents,
              recurrencePattern: recurrencePattern ?? null,
              jobTypeId: jobTypeId ?? null,
              quotationId: quotationId ?? null,
              idempotencyKey: idempotencyKey ?? null,
              scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
              metadata: {
                pricingSource,
                ...(units !== undefined ? { units } : {}),
              },
              ...(attachments && attachments.length > 0
                ? {
                    attachments: {
                      create: attachments.map((a) => ({
                        fileType: a.fileType,
                        fileUrl: a.fileUrl,
                        fileName: a.fileName,
                        fileSize: a.fileSize,
                        mimeType: a.mimeType,
                      })),
                    },
                  }
                : {}),
            },
            include: { attachments: true },
          });

          // Apply the discount redemption INSIDE the same transaction.
          // If this throws, the entire task creation rolls back — the user
          // sees a 422 with the failure reason, not a "success" toast with
          // a silently-dropped discount.
          if (discountCode && discountCodeId && discountCampaignId) {
            try {
              // ── F3 (C3): atomic guarded decrement — the conditional ──
              // updateMany is the compare-and-decrement; racing checkouts
              // can no longer both consume the same remaining use.
              const dec = await tx.discountCode.updateMany({
                where: { id: discountCodeId, usesRemaining: { gt: 0 } },
                data: { usesRemaining: { decrement: 1 } },
              });
              if (dec.count === 0) {
                // count=0 → exhausted OR unlimited (null). Distinguish.
                const codeRow = await tx.discountCode.findUnique({
                  where: { id: discountCodeId },
                  select: { usesRemaining: true },
                });
                if (codeRow && codeRow.usesRemaining !== null) {
                  throw new Error("This voucher's usage limit has been reached");
                }
              }

              // ── F3: campaign cap backstop (increment-then-verify; race- ──
              // free under SQLite single-writer serialization — see
              // campaign-service.ts applyRedemption for the full note)
              const campaignRow = await tx.campaign.update({
                where: { id: discountCampaignId },
                data: { redemptionsCount: { increment: 1 } },
              });
              if (
                campaignRow.maxRedemptions !== null &&
                campaignRow.redemptionsCount > campaignRow.maxRedemptions
              ) {
                await tx.campaign.update({
                  where: { id: discountCampaignId },
                  data: { redemptionsCount: { decrement: 1 } },
                });
                throw new Error("This campaign's redemption limit has been reached");
              }

              // Write redemption record
              // F4: the checkout marker is keyed on the REAL taskId column
              // (was bookingId: created.id — the task id never was a booking
              // id; the cancellation-restore lookup now filters on taskId, so
              // a spoofed bookingId string can no longer fabricate/consume
              // the marker).
              await tx.codeRedemption.create({
                data: {
                  discountCodeId,
                  campaignId: discountCampaignId,
                  householdId,
                  taskId: created.id,
                  discountAppliedCents: discountCents,
                },
              });

              // If a Voucher exists for this household+code, mark it USED
              const voucher = await tx.voucher.findUnique({
                where: {
                  householdId_discountCodeId: {
                    householdId,
                    discountCodeId,
                  },
                },
              }).catch(() => null);

              if (voucher) {
                await tx.voucher.update({
                  where: { id: voucher.id },
                  data: { status: "USED", usedAt: new Date() },
                });
              }

              // Record attribution (best-effort, non-fatal)
              // F22: REFUND_CREDIT campaigns are transactional — skip.
              if (campaignRow.type !== "REFUND_CREDIT") {
                await tx.campaignAttribution.create({
                  data: {
                    householdId,
                    campaignId: discountCampaignId,
                    taskId: created.id,
                    touchpoint: voucher ? "VOUCHER_USED" : "CODE_REDEEMED",
                    weight: 1.0,
                  },
                }).catch(() => {});
              }

              // Record campaign event (best-effort, non-fatal)
              await tx.campaignEvent.create({
                data: {
                  campaignId: discountCampaignId,
                  householdId,
                  eventType: "VOUCHER_REDEEMED",
                  metadata: { code: discountCode.trim(), discountCents, taskId: created.id },
                },
              }).catch(() => {});

              // Update household acquisition source if first redemption
              // F22 (police-2a f3): REFUND_CREDIT spends are transactional —
              // never reclassify acquisition from a credit redemption.
              const hh = await tx.household.findUnique({ where: { id: householdId } });
              if (
                hh &&
                hh.acquisitionSource === "ORGANIC" &&
                campaignRow.type !== "REFUND_CREDIT"
              ) {
                await tx.household.update({
                  where: { id: householdId },
                  data: {
                    acquisitionSource: "PUBLIC_CODE",
                    acquisitionCampaignId: discountCampaignId,
                  },
                });
              }
            } catch (redeemError) {
              // Capture the reason and re-throw to abort the transaction.
              const reason = redeemError instanceof Error ? redeemError.message : "Unknown error";
              redemptionFailureReason = reason;
              throw redeemError;
            }
          }

          return created;
        });
        lastCreateError = null;
        break;
      } catch (err) {
        lastCreateError = err;
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          // unique constraint on jobNo (or idempotencyKey) — retry with a fresh sequence.
          // If the collision was on idempotencyKey, the replay lookup above should have
          // caught it, but in the race between two concurrent requests we still retry
          // here and let the next iteration's replay lookup handle it.
          continue;
        }
        // If this was a redemption failure, surface a 422 immediately — don't retry.
        if (redemptionFailureReason) {
          return NextResponse.json(
            {
              error: `Voucher could not be applied: ${redemptionFailureReason}. Please try again or remove the voucher.`,
              code: "VOUCHER_APPLY_FAILED",
            },
            { status: 422 }
          );
        }
        throw err; // unrelated error — rethrow
      }
    }
    if (!task) {
      // If the redemption failed mid-transaction we already returned above.
      if (redemptionFailureReason) {
        return NextResponse.json(
          {
            error: `Voucher could not be applied: ${redemptionFailureReason}. Please try again or remove the voucher.`,
            code: "VOUCHER_APPLY_FAILED",
          },
          { status: 422 }
        );
      }
      console.error("[POST /api/tasks] Failed to generate unique jobNo after retries:", lastCreateError);
      return NextResponse.json(
        { error: "Failed to assign a job number. Please retry." },
        { status: 500 }
      );
    }

    // If quotationId was provided, update the quotation status to ACCEPTED
    if (quotationId) {
      await db.quotation.update({
        where: { id: quotationId },
        data: { status: "ACCEPTED" },
      });
    }

    // Fire-and-forget auto-dispatch check (Level 3+)
    triggerAutomationOnTaskCreated(task.id, householdId, category)

    return NextResponse.json({ task }, { status: 201 })
  } catch (error) {
    console.error("POST /api/tasks error:", error)
    return NextResponse.json(
      { error: "Failed to create task" },
      { status: 500 }
    )
  }
}