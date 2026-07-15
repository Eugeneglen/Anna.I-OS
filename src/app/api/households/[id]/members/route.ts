import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { z } from "zod"

const addMemberSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email").max(200),
  phone: z.string().max(20).optional(),
  role: z.enum(["OWNER", "MEMBER"]).default("MEMBER"),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: householdId } = await params
    const body = await request.json()
    const parsed = addMemberSchema.parse(body)

    // Verify household exists
    const household = await db.household.findUnique({ where: { id: householdId } })
    if (!household) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 })
    }

    const member = await db.familyMember.create({
      data: {
        householdId,
        name: parsed.name,
        email: parsed.email,
        phone: parsed.phone ?? null,
        role: parsed.role,
      },
    })

    return NextResponse.json({ member }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    console.error("POST /api/households/[id]/members error:", error)
    return NextResponse.json(
      { error: "Failed to add member" },
      { status: 500 }
    )
  }
}