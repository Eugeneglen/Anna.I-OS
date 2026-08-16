import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const task = await db.task.findUnique({
      where: { id },
      include: {
        household: {
          select: { id: true, name: true, address: true, postalCode: true, unitNumber: true },
        },
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
        jobType: { select: { id: true, name: true, slug: true } },
        quotation: { select: { id: true, totalCents: true, breakdown: true } },
      },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    return NextResponse.json({ task })
  } catch (error) {
    console.error("GET /api/tasks/[id] error:", error)
    return NextResponse.json(
      { error: "Failed to fetch task" },
      { status: 500 }
    )
  }
}