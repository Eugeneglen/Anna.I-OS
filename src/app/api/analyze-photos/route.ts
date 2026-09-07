import { NextResponse } from "next/server";
import { z } from "zod";
import { getZAI } from "@/lib/zai";
import { getHouseholdSession } from "@/lib/household-auth";
import { signServeUrl } from "@/lib/serve-auth";

const analyzePhotosSchema = z.object({
  photos: z.array(
    z.object({
      url: z.string().min(1),
      type: z.enum(["before", "after"]),
    })
  ).min(1).max(10),
  category: z.string().optional(),
  instructions: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    // FIX-1a: this route sends task photos to the vision model — it was
    // previously callable unauthenticated. Household session required.
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = analyzePhotosSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { photos, category, instructions } = parsed.data;

    // Separate before and after photos
    const beforePhotos = photos.filter((p) => p.type === "before");
    const afterPhotos = photos.filter((p) => p.type === "after");

    // Build analysis prompt
    const categoryContext = category
      ? `Service category: ${category.toLowerCase()}.`
      : "";
    const instructionsContext = instructions
      ? `Work instructions: "${instructions}".`
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
    // any /api/serve URL before handing it to the vision model.
    const imageContent = photos.map((photo) => ({
      type: "image_url" as const,
      image_url: { url: signServeUrl(photo.url, 10 * 60) ?? photo.url },
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
