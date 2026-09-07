import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getOpsSession } from "@/lib/ops-auth"
import { hasPermission } from "@/lib/permissions"

export async function GET() {
  try {
    // FIX-1a: previously fully unauthenticated (full household PII dump).
    // The ops console (households page) is the only consumer — ops
    // session + households:view permission now required, mirroring the
    // convention used by the other /api/ops/* routes.
    const session = await getOpsSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const allowed = await hasPermission(session, "households", "view")
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const households = await db.household.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        fullName: true,
        email: true,
        phone: true,
        address: true,
        postalCode: true,
        unitNumber: true,
        activeCategories: true,
        preferences: true,
        onboardingStep: true,
        createdAt: true,
        updatedAt: true,
        subscriptions: {
          select: {
            id: true,
            tier: true,
            status: true,
            priceCents: true,
          },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
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