import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ServiceCategory, TaskStatus } from "@prisma/client"

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
  recurrencePattern: z.record(z.unknown()).nullable().optional(),
  scheduledStart: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  jobTypeId: z.string().optional(),
  quotationId: z.string().optional(),
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
      where: { householdId },
      orderBy: { createdAt: "desc" },
      include: {
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

    const { householdId, category, instructions, amountCents, recurrencePattern, attachments, jobTypeId, quotationId } = parsed.data

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

    const task = await db.task.create({
      data: {
        householdId,
        category,
        status: TaskStatus.CREATED,
        instructions: instructions ?? null,
        instructionsSource: "new",
        amountCents: finalAmountCents,
        recurrencePattern: recurrencePattern ?? null,
        jobTypeId: jobTypeId ?? null,
        quotationId: quotationId ?? null,
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
    })

    // If quotationId was provided, update the quotation status to ACCEPTED
    if (quotationId) {
      await db.quotation.update({
        where: { id: quotationId },
        data: { status: "ACCEPTED" },
      });
    }

    return NextResponse.json({ task }, { status: 201 })
  } catch (error) {
    console.error("POST /api/tasks error:", error)
    return NextResponse.json(
      { error: "Failed to create task" },
      { status: 500 }
    )
  }
}