import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { ServiceCategory, TaskStatus } from "@prisma/client"
import { triggerAutomationOnTaskCreated } from "@/lib/automation"
import { isCategoryActive } from "@/lib/get-active-categories"
import { validateRedemption, applyRedemption } from "@/lib/marketing/campaign-service"
import { generateJobNo } from "@/lib/job-number"

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
  discountCode: z.string().optional(), // Phase 3: optional promo code
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
})

// GET /api/tasks?householdId=xxx
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const householdId = searchParams.get("householdId")

    if (!householdId) {
      return NextResponse.json({ error: "householdId required" }, { status: 400 })
    }

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

    const { householdId, category, instructions, amountCents, discountCode, recurrencePattern, scheduledStart, attachments, jobTypeId, quotationId } = parsed.data

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

    // Phase 3: Validate discount code if provided (before creating the task)
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

    // Create the task with an auto-generated jobNo inside a transaction.
    // Retry on unique-constraint collision (P2002) in case two concurrent
    // creations pick the same sequence number.
    const MAX_JOB_NO_RETRIES = 5;
    let task;
    let lastCreateError: unknown = null;
    for (let attempt = 0; attempt < MAX_JOB_NO_RETRIES; attempt++) {
      try {
        task = await db.$transaction(async (tx) => {
          const jobNo = await generateJobNo(tx);
          return tx.task.create({
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
        });
        lastCreateError = null;
        break;
      } catch (err) {
        lastCreateError = err;
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          // unique constraint on jobNo — retry with a fresh sequence
          continue;
        }
        throw err; // unrelated error — rethrow
      }
    }
    if (!task) {
      console.error("[POST /api/tasks] Failed to generate unique jobNo after retries:", lastCreateError);
      return NextResponse.json(
        { error: "Failed to assign a job number. Please retry." },
        { status: 500 }
      );
    }

    // Phase 3: Apply the discount redemption now that the task exists
    if (discountCode && discountCodeId && discountCampaignId) {
      try {
        await applyRedemption({
          code: discountCode.trim(),
          householdId,
          discountCents,
          campaignId: discountCampaignId,
          codeId: discountCodeId,
          bookingId: task.id, // link redemption to this task
        });
      } catch (redeemError) {
        console.error("[POST /api/tasks] Failed to apply discount redemption:", redeemError);
        // Non-fatal — task is created, but redemption failed.
        // The code was already validated, so this is likely a race condition
        // (another request used the last use). Log and continue.
      }
    }

    // If quotationId was provided, update the quotation status to ACCEPTED
    if (quotationId) {
      await db.quotation.update({
        where: { id: quotationId },
        data: { status: "ACCEPTED" },
      });
    }

    // Phase 7: Fire-and-forget auto-dispatch check (Level 3+)
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