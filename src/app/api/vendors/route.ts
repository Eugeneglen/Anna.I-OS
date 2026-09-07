import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { VendorStatus } from "@prisma/client"
import { getHouseholdSession } from "@/lib/household-auth"
import { getOpsSession } from "@/lib/ops-auth"
import { getVendorSession } from "@/lib/vendor-auth"

export async function GET(request: Request) {
  try {
    // FIX-1a: previously fully unauthenticated and returned full Vendor rows
    // including bcrypt passwordHash + verificationData (NRIC / background
    // checks) — verified live in AUDIT-1c. Now requires any portal session
    // (the only in-repo consumer is the vendor panel) and selects an
    // explicit safe field list.
    const [hhSession, opsSession, vendorSession] = await Promise.all([
      getHouseholdSession(),
      getOpsSession(),
      getVendorSession(),
    ])
    if (!hhSession && !opsSession && !vendorSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category")

    const vendors = await db.vendor.findMany({
      where: { status: VendorStatus.ACTIVE },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        contactPerson: true,
        contactEmail1: true,
        contactPhone1: true,
        contactPerson2: true,
        contactEmail2: true,
        contactPhone2: true,
        companyName: true,
        companyRegNo: true,
        registeredAddress: true,
        categories: true,
        status: true,
        vendorType: true,
        staffCount: true,
        dailyCapacity: true,
        maxTasksPerDay: true,
        maxTasksPerWeek: true,
        availability: true,
        zones: true,
        avatarUrl: true,
        roleId: true,
        createdAt: true,
        updatedAt: true,
        // passwordHash + verificationData intentionally NOT selected
      },
    })

    // If category filter is provided, filter in JS (categories is a JSON string)
    const filtered = category
      ? vendors.filter((v) => {
          try {
            const cats: string[] = JSON.parse(v.categories)
            return cats.includes(category)
          } catch {
            return false
          }
        })
      : vendors

    return NextResponse.json({ vendors: filtered })
  } catch (error) {
    console.error("GET /api/vendors error:", error)
    return NextResponse.json(
      { error: "Failed to fetch vendors" },
      { status: 500 }
    )
  }
}
