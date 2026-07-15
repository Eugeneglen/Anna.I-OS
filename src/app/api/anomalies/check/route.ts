import { NextResponse } from "next/server";
import { runAnomalyDetection } from "@/lib/anomaly-detector";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const householdId = body.householdId as string | undefined;

    const result = await runAnomalyDetection(householdId);

    return NextResponse.json({
      message: `Detection complete: ${result.created} new anomalies detected, ${result.skipped} filtered`,
      ...result,
    });
  } catch (error) {
    console.error("POST /api/anomalies/check error:", error);
    return NextResponse.json(
      { error: "Anomaly detection failed" },
      { status: 500 }
    );
  }
}