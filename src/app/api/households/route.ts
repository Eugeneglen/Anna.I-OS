import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET() {
  try {
    const households = await db.household.findMany({
      orderBy: { createdAt: "asc" },
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
        onboardingStep: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ households })
  } catch (error) {
    console.error("GET /api/households error:", error)
    return NextResponse.json(
      { error: "Failed to fetch households" },
      { status: 500 }
    )
  }
}