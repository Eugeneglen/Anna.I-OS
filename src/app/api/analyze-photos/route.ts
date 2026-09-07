import { NextResponse } from "next/server";
import { z } from "zod";
import { getZAI } from "@/lib/zai";
import { getHouseholdSession } from "@/lib/household-auth";
import { signServeUrl } from "@/lib/serve-auth";
import { db } from "@/lib/db";
import {
  checkRateLimit,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// ── AI Wave 2-A (A-7): the old contract accepted a client-supplied array
// of arbitrary photo URLs. Object-level authorization was missing:
//   1. Photos were never validated to belong to the caller's tasks — a
//      signed household token was stamped on ANY /api/serve/ URL the
//      client sent (cross-household probing if paths are guessable).
//   2. Arbitrary EXTERNAL URLs passed through untouched — the VLM acted
//      as a server-side fetch relay.
// The new contract takes a taskId only; photos are loaded server-side
// from the caller's OWN task and before/after is derived from the DB's
// uploadedBy field ("vendor:before" | "vendor:after" | "staff:*").
const analyzePhotosSchema = z.object({
  taskId: z.string().min(1),
});

// VLM context cap — matches the previous max(10) photos limit.
const MAX_PHOTOS = 10;

/**
 * AI Wave 2-A (A-7): the vision backend ONLY accepts absolute, publicly
 * reachable https URLs (verified empirically: relative URLs and base64
 * data URLs are rejected with code 1210). Serve-hosted photos are stored
 * as relative "/api/serve/..." paths, so the absolute URL is constructed
 * from the request's forwarded proto/host — correct behind the Railway
 * proxy (x-forwarded-proto: https, x-forwarded-host: <public domain>).
 */
function absoluteUrl(path: string, request: Request): string {
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (request.headers.get("host")?.includes("localhost") ? "http" : "https");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host");
  if (!host) return path;
  return `${proto}://${host}${path}`;
}

export async function POST(request: Request) {
  try {
    // FIX-1a: this route sends task photos to the vision model — it was
    // previously callable unauthenticated. Household session required.
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // AI Wave 2-A (A-5): VLM calls are expensive — 10/min/household cap.
    const rlKey = `analyze-photos:hh:${session.householdId}`;
    if (
      !checkRateLimit(rlKey, RATE_LIMITS.analyzePhotos.limit, RATE_LIMITS.analyzePhotos.windowMs)
    ) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    const body = await request.json();
    const parsed = analyzePhotosSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "taskId is required — photos are resolved from the task record" },
        { status: 400 }
      );
    }

    const { taskId } = parsed.data;

    // A-7: load the task + its photos server-side, ownership-scoped.
    // 404 (not 403) on mismatch — don't confirm other households' tasks exist.
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        category: true,
        instructions: true,
        householdId: true,
        verificationPhotos: {
          orderBy: { createdAt: "asc" },
          select: { fileUrl: true, uploadedBy: true },
        },
      },
    });

    if (!task || task.householdId !== session.householdId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.verificationPhotos.length === 0) {
      return NextResponse.json(
        { error: "No verification photos on this task yet" },
        { status: 400 }
      );
    }

    // Build the photo list from DB records only. Only /api/serve/ URLs are
    // eligible (signed with a short TTL for the vision model); anything
    // else is skipped — external URLs are NEVER fetched (A-7).
    const dbPhotos = task.verificationPhotos.slice(0, MAX_PHOTOS);
    const photos = dbPhotos
      .map((p) => ({
        url: p.fileUrl,
        type: p.uploadedBy?.includes("before") ? ("before" as const) : ("after" as const),
      }))
      .filter((p) => p.url?.startsWith("/api/serve/"));

    if (photos.length === 0) {
      return NextResponse.json(
        { error: "No analysable platform-hosted photos on this task" },
        { status: 400 }
      );
    }

    // Separate before and after photos
    const beforePhotos = photos.filter((p) => p.type === "before");
    const afterPhotos = photos.filter((p) => p.type === "after");

    // Build analysis prompt
    const categoryContext = task.category
      ? `Service category: ${task.category.toLowerCase()}.`
      : "";
    const instructionsContext = task.instructions
      ? `Work instructions: "${task.instructions}".`
      : "";

    const hasBeforeAndAfter = beforePhotos.length > 0 && afterPhotos.length > 0;

    let prompt = "";
    if (hasBeforeAndAfter) {
      prompt = `You are a quality verification AI for a home services platform. Analyze the before and after work photos.

${categoryContext}
${instructionsContext}

Compare the "before" photos with the "after" photos. Assess:

1. **Work Completion**: Was the service completed as described? (completed/partially_completed/not_completed)
2. **Quality Score**: Rate the work quality from 1-10 based on visible results.
3. **Before vs After**: Describe what changed between the before and after photos.
4. **Concerns**: Any visible issues, damage, or incomplete areas?

Respond in JSON format only:
{
  "completionStatus": "completed" | "partially_completed" | "not_completed",
  "qualityScore": number (1-10),
  "summary": "Brief 1-2 sentence assessment",
  "changes": "What was done",
  "concerns": "Any issues found, or 'none'",
  "recommendation": "approve" | "review" | "reject"
}`;
    } else {
      prompt = `You are a quality verification AI for a home services platform. Analyze these work photos.

${categoryContext}
${instructionsContext}

${afterPhotos.length > 0 ? "These are 'after work' photos. Assess the quality and completion." : "These are 'before work' photos. Describe the current state."}

Respond in JSON format only:
{
  "completionStatus": "completed" | "partially_completed" | "not_completed",
  "qualityScore": number (1-10),
  "summary": "Brief 1-2 sentence assessment",
  "changes": "What is visible in the photos",
  "concerns": "Any issues found, or 'none'",
  "recommendation": "approve" | "review" | "reject"
}`;
    }

    // Build image content array
    // FIX-1a: /api/serve now requires auth. The VLM fetches these URLs
    // server-side WITHOUT cookies, so sign short-TTL access tokens onto
    // the /api/serve URLs before handing them to the vision model.
    // (A-7: URLs now originate from the DB, not the client; and are made
    // ABSOLUTE — the vision backend rejects relative URLs outright.)
    const imageContent = photos.map((photo) => ({
      type: "image_url" as const,
      image_url: {
        url: absoluteUrl(signServeUrl(photo.url, 10 * 60) ?? photo.url, request),
      },
    }));

    // Call VLM
    const zai = await getZAI();
    if (!zai) {
      return NextResponse.json(
        { error: "AI vision features are not configured on this server. Set Z_AI_BASE_URL and Z_AI_API_KEY." },
        { status: 503 }
      );
    }

    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...imageContent,
          ],
        },
      ],
      thinking: { type: "disabled" },
    });

    const rawContent = response.choices[0]?.message?.content || "";

    // Parse the JSON response from VLM
    let analysis;
    try {
      // Try to extract JSON from the response (VLM might wrap it in markdown code blocks)
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        analysis = {
          completionStatus: "review",
          qualityScore: 5,
          summary: rawContent,
          changes: "Unable to determine",
          concerns: "AI analysis returned unstructured response",
          recommendation: "review",
        };
      }
    } catch {
      analysis = {
        completionStatus: "review",
        qualityScore: 5,
        summary: "AI analysis could not be parsed",
        changes: "Unable to determine",
        concerns: "Parsing error in AI response",
        recommendation: "review",
      };
    }

    // ── AI Wave 2-A (A-8): VLM analyses are attributable. The analysis is
    // advisory only (household still verifies; escrow release stays human)
    // but the audit row records what the model recommended, on which task.
    try {
      await db.auditLog.create({
        data: {
          userId: null, // OpsUser FK — null for household actors
          userName: `${session.memberName} (household, via photo analysis)`,
          action: "AI_PHOTO_ANALYSIS",
          entityType: "task",
          entityId: task.id,
          metadata: {
            via: "ai-photo-analysis",
            actorHouseholdId: session.householdId,
            actorEmail: session.memberEmail,
            photoCount: photos.length,
            beforeCount: beforePhotos.length,
            afterCount: afterPhotos.length,
            completionStatus: analysis.completionStatus ?? null,
            qualityScore: analysis.qualityScore ?? null,
            recommendation: analysis.recommendation ?? null,
          },
        },
      });
    } catch (err) {
      // Non-fatal — analysis result still returns to the household.
      console.error("[/api/analyze-photos] audit log failed:", err);
    }

    return NextResponse.json({
      analysis,
      photoCount: photos.length,
      beforeCount: beforePhotos.length,
      afterCount: afterPhotos.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("POST /api/analyze-photos error:", error);
    return NextResponse.json(
      { error: "Failed to analyze photos", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
