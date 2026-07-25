import { readFile, stat } from "fs/promises";
import { join, extname } from "path";
import { NextResponse } from "next/server";

// ── Config ──────────────────────────────────────────────────────
// UPLOAD_DIR points to the root directory where uploads are stored.
// - Local dev: defaults to "public" (backward compatible — Next.js also serves these as static files)
// - Railway / production: set UPLOAD_DIR env var to a writable persistent directory (e.g. /data/uploads)
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), "public");

// Allowed extensions and their MIME types
const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

// Cache duration for uploaded files (1 hour — allows images to update after re-upload)
const CACHE_SECONDS = 3600;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const relativePath = path.join("/");

    // Security: prevent path traversal
    if (
      relativePath.includes("..") ||
      relativePath.startsWith("/") ||
      relativePath.includes("\\")
    ) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const filePath = join(UPLOAD_DIR, relativePath);

    // Check file exists and read it
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const buffer = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
        // Prevent hotlinking from external sites
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("GET /api/serve error:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 }
    );
  }
}
