import { NextResponse } from "next/server";
import { getZAI } from "@/lib/zai";

/**
 * GET /api/ai-status
 *
 * Returns whether the AI (z-ai-web-dev-sdk) is configured and available.
 * The frontend uses this to show a friendly "AI unavailable" message
 * instead of letting users type a message and get an error.
 */
export async function GET() {
  const zai = await getZAI();
  return NextResponse.json({
    available: zai !== null,
  });
}
