import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { z } from "zod"
import { getHouseholdSession } from "@/lib/household-auth"
import { validateSgPhone } from "@/lib/phone-validation"
import { isValidPostalCode, normalizePostalCode } from "@/lib/postal-code"

const patchHouseholdSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  fullName: z.string().min(1).max(200).optional(),
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
    // Auth guard — only the household's own members can update
    const session = await getHouseholdSession()
    if (!session || session.householdId !== (await params).id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = patchHouseholdSchema.parse(body)

    // Validate phone number format if provided (not clearing it)
    if (parsed.phone) {
      const phoneResult = validateSgPhone(parsed.phone)
      if (!phoneResult.valid) {
        return NextResponse.json(
          { error: phoneResult.error || "Invalid Singapore phone number" },
          { status: 400 }
        )
      }
      // Normalize to +65XXXXXXXX format
      parsed.phone = phoneResult.normalized
    }

    // Validate postal code format if provided
    if (parsed.postalCode) {
      const code = normalizePostalCode(parsed.postalCode)
      if (!isValidPostalCode(code)) {
        return NextResponse.json(
          { error: "Invalid postal code. Must be exactly 6 digits." },
          { status: 400 }
        )
      }
      parsed.postalCode = code
    }

    // Ensure household exists + email uniqueness check
    const current = await db.household.findUnique({ where: { id } })
    if (!current) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 })
    }
    if (parsed.email && parsed.email !== current.email) {
      const emailTaken = await db.household.findUnique({
        where: { email: parsed.email },
        select: { id: true },
      })
      if (emailTaken) {
        return NextResponse.json(
          { error: "Email is already in use by another household" },
          { status: 409 }
        )
      }
    }

    const household = await db.household.update({
      where: { id },
      data: parsed,
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
        onboardingCompletedAt: true,
        onboardingProfile: true,
        createdAt: true,
        updatedAt: true,
      },
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
        fullName: true,
        email: true,
        phone: true,
        address: true,
        postalCode: true,
        unitNumber: true,
        activeCategories: true,
        preferences: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        onboardingProfile: true,
        acquisitionSource: true,
        acquisitionCampaignId: true,
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
