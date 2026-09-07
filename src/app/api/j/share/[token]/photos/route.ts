import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import crypto from "crypto";
import { db } from "@/lib/db";
import { signServeUrl } from "@/lib/serve-auth";
import { isShareLinkExpired, shareLinkExpiredError } from "@/lib/share-link";

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), "public");
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_PHOTOS = 10;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // ── Authenticate via shareToken ──
    const booking = await db.booking.findUnique({
      where: { shareToken: token },
      select: { id: true, taskId: true, status: true, sharedAt: true },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Invalid or expired share link" },
        { status: 404 }
      );
    }

    // P8 (AUDIT-4): share links expire — see src/lib/share-link.ts
    if (isShareLinkExpired(booking)) {
      return NextResponse.json({ error: shareLinkExpiredError() }, { status: 410 });
    }

    // ── Parse multipart form data ──
    const formData = await request.formData();
    const type = formData.get("type") as string | null;

    if (!type || !["before", "after"].includes(type)) {
      return NextResponse.json(
        { error: "type must be 'before' or 'after'" },
        { status: 400 }
      );
    }

    // Collect all file entries (key starting with "file")
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("file") && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400 }
      );
    }

    if (files.length > MAX_PHOTOS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_PHOTOS} photos per upload` },
        { status: 400 }
      );
    }

    // Validate and save each file
    const savedPhotos: { fileUrl: string; uploadedBy: string }[] = [];
    const uploadDir = join(UPLOAD_DIR, "attachments", "verification");
    await mkdir(uploadDir, { recursive: true });

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          {
            error: `Invalid file type: ${file.name}. Only JPEG, PNG, WebP, GIF allowed.`,
          },
          { status: 400 }
        );
      }

      if (file.size > MAX_SIZE) {
        return NextResponse.json(
          { error: `File too large: ${file.name}. Max 5 MB.` },
          { status: 400 }
        );
      }

      const ext =
        file.type === "image/jpeg"
          ? "jpg"
          : file.type === "image/png"
            ? "png"
            : file.type === "image/webp"
              ? "webp"
              : "gif";

      const filename = `${booking.id}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
      const bytes = await file.arrayBuffer();
      await writeFile(join(uploadDir, filename), Buffer.from(bytes));

      savedPhotos.push({
        fileUrl: `/api/serve/attachments/verification/${filename}`,
        uploadedBy: `staff:${type}`,
      });
    }

    // Create verification photo records
    await db.verificationPhoto.createMany({
      data: savedPhotos.map((photo) => ({
        taskId: booking.taskId,
        bookingId: booking.id,
        fileUrl: photo.fileUrl,
        uploadedBy: photo.uploadedBy,
      })),
    });

    return NextResponse.json({
      count: savedPhotos.length,
      type,
      // FIX-1a: /api/serve requires auth — the share page has no session,
      // so return short-TTL signed URLs for immediate preview. The DB row
      // keeps the unsigned path.
      photos: savedPhotos.map((p) => ({
        fileUrl: signServeUrl(p.fileUrl, 10 * 60),
      })),
    });
  } catch (error) {
    console.error("POST /api/j/share/[token]/photos error:", error);
    return NextResponse.json(
      { error: "Failed to upload photos" },
      { status: 500 }
    );
  }
}
