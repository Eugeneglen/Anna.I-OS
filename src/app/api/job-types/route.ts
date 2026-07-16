import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CATEGORIES } from "@/lib/constants";

// GET /api/job-types?category=CLEANING
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");

    if (!category) {
      return NextResponse.json(
        { error: "category query parameter is required" },
        { status: 400 }
      );
    }

    if (!CATEGORIES.includes(category as never)) {
      return NextResponse.json(
        {
          error: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const jobTypes = await db.serviceJobType.findMany({
      where: {
        category: category as never,
        isActive: true,
      },
      orderBy: { sortOrder: "asc" },
      include: {
        _count: {
          select: { quotations: true },
        },
      },
    });

    return NextResponse.json({ jobTypes });
  } catch (error) {
    console.error("GET /api/job-types error:", error);
    return NextResponse.json(
      { error: "Failed to fetch job types" },
      { status: 500 }
    );
  }
}