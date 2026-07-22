import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { z } from "zod"

const patchHouseholdSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  address: z.string().min(1).max(200).optional(),
  unitNumber: z.string().max(20).optional(),
  postalCode: z.string().max(10).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const parsed = patchHouseholdSchema.parse(body)

    const household = await db.household.update({
      where: { id },
      data: parsed,
    })

    return NextResponse.json({ household })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    console.error("PATCH /api/households/[id] error:", error)
    return NextResponse.json(
      { error: "Failed to update household" },
      { status: 500 }
    )
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const household = await db.household.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        postalCode: true,
        unitNumber: true,
        activeCategories: true,
        preferences: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!household) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 })
    }

    const [members, tasks, subscriptions, categoryAutonomy] = await Promise.all([
      db.familyMember.findMany({
        where: { householdId: id },
        orderBy: { createdAt: "asc" },
      }),
      db.task.findMany({
        where: {
          householdId: id,
          // Exclude cancelled predicted tasks
          OR: [
            { cancelledAt: null },
            { status: { not: "PREDICTED" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        include: {
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
      }),
      db.subscription.findMany({ where: { householdId: id } }),
      db.householdCategoryAutonomy.findMany({ where: { householdId: id } }),
    ])

    return NextResponse.json({
      household,
      members,
      tasks,
      subscriptions,
      categoryAutonomy,
    })
  } catch (error) {
    console.error("GET /api/households/[id] error:", error)
    return NextResponse.json(
      { error: "Failed to fetch household" },
      { status: 500 }
    )
  }
}