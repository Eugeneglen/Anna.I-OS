import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";

export async function GET() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({
      user: {
        id: session.userId,
        name: session.name,
        email: session.email,
        role: session.role,
      },
    });
  } catch (error) {
    console.error("[/api/ops/session GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
