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
    const body = await request.json()
    const parsed = createTaskSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    // ── F21 auth gate (audit C7 family) ── task creation must not be
    // spoofable: a household session always creates for ITSELF (body
    // householdId ignored on mismatch); ops may create on behalf.
    const scope = await resolveHouseholdScope(parsed.data.householdId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const householdId = scope.householdId

    const { category, instructions, amountCents, discountCode, recurrencePattern, scheduledStart, attachments, jobTypeId, quotationId, idempotencyKey } = parsed.data

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
      finalAmountCents = quotation.totalCents;
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
              amountCents: finalAmountCents,
              discountCents,
              discountCodeId,
              finalAmountCents: finalAmountCents - discountCents,
              recurrencePattern: recurrencePattern ?? null,
              jobTypeId: jobTypeId ?? null,
              quotationId: quotationId ?? null,
              idempotencyKey: idempotencyKey ?? null,
              scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
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
              // Decrement uses remaining
              const code = await tx.discountCode.findUnique({
                where: { id: discountCodeId },
              });
              if (code && code.usesRemaining !== null) {
                if (code.usesRemaining <= 0) {
                  throw new Error("This voucher's usage limit has been reached");
                }
                await tx.discountCode.update({
                  where: { id: discountCodeId },
                  data: { usesRemaining: code.usesRemaining - 1 },
                });
              }

              // Increment campaign redemption count
              await tx.campaign.update({
                where: { id: discountCampaignId },
                data: { redemptionsCount: { increment: 1 } },
              });

              // Write redemption record
              await tx.codeRedemption.create({
                data: {
                  discountCodeId,
                  campaignId: discountCampaignId,
                  householdId,
                  bookingId: created.id,
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
              await tx.campaignAttribution.create({
                data: {
                  householdId,
                  campaignId: discountCampaignId,
                  taskId: created.id,
                  touchpoint: voucher ? "VOUCHER_USED" : "CODE_REDEEMED",
                  weight: 1.0,
                },
              }).catch(() => {});

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
              const hh = await tx.household.findUnique({ where: { id: householdId } });
              if (hh && hh.acquisitionSource === "ORGANIC") {
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