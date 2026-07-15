import { NextResponse } from "next/server"
import { db } from "@/lib/db"

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
        where: { householdId: id },
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