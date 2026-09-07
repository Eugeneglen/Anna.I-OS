import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getHouseholdSession } from "@/lib/household-auth"
import { getOpsSession } from "@/lib/ops-auth"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id: householdId, memberId } = await params

    // FIX-1a: previously unauthenticated — anyone could remove members
    // from any household. Own household session OR ops session required.
    const [hhSession, opsSession] = await Promise.all([
      getHouseholdSession(),
      getOpsSession(),
    ])
    if (!hhSession && !opsSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (hhSession && !opsSession && hhSession.householdId !== householdId) {
      return NextResponse.json(
        { error: "Forbidden — this household belongs to another account" },
        { status: 403 }
      )
    }

    const member = await db.familyMember.findUnique({
      where: { id: memberId },
    })

    if (!member || member.householdId !== householdId) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    if (member.role === "OWNER") {
      return NextResponse.json(
        { error: "Cannot remove the household owner" },
        { status: 409 }
      )
    }

    await db.familyMember.delete({ where: { id: memberId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("DELETE /api/households/[id]/members/[memberId] error:", error)
    return NextResponse.json(
      { error: "Failed to remove member" },
      { status: 500 }
    )
  }
}