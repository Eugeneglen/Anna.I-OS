import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { VendorStatus } from "@prisma/client"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category")

    const vendors = await db.vendor.findMany({
      where: { status: VendorStatus.ACTIVE },
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