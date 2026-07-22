import { NextResponse } from "next/server";
import { getVendorSession } from "@/lib/vendor-auth";

export async function GET() {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({
      vendor: {
        id: session.vendorId,
        name: session.name,
        email: session.email,
        vendorType: session.vendorType,
        status: session.status,
      },
    });
  } catch (error) {
    console.error("[/api/vendor/session GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
