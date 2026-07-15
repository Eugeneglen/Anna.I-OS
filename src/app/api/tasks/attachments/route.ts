import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import crypto from "crypto";

const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_PHOTO_COUNT = 5;
const MAX_VIDEO_COUNT = 2;

const ALLOWED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/webm",
];

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const fileType = formData.get("fileType") as string | null; // "PHOTO" | "VIDEO"
    const existingCount = parseInt(
      (formData.get("existingCount") as string) || "0",
      10
    );

    if (!file || !fileType) {
      return NextResponse.json(
        { error: "file and fileType are required" },
        { status: 400 }
      );
    }

    const isPhoto = fileType === "PHOTO";
    const allowedTypes = isPhoto ? ALLOWED_PHOTO_TYPES : ALLOWED_VIDEO_TYPES;
    const maxSize = isPhoto ? MAX_PHOTO_SIZE : MAX_VIDEO_SIZE;
    const maxCount = isPhoto ? MAX_PHOTO_COUNT : MAX_VIDEO_COUNT;

    // Validate type
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        {
          error: isPhoto
            ? "Only JPEG, PNG, WebP, GIF, HEIC images are allowed"
            : "Only MP4, MOV, and WebM videos are allowed",
        },
        { status: 400 }
      );
    }

    // Validate size
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: isPhoto
            ? "Photo must be under 5 MB"
            : "Video must be under 50 MB",
        },
        { status: 400 }
      );
    }

    // Validate count
    if (existingCount >= maxCount) {
      return NextResponse.json(
        {
          error: `Maximum ${maxCount} ${isPhoto ? "photo" : "video"}${
            maxCount > 1 ? "s" : ""
          } allowed`,
        },
        { status: 400 }
      );
    }

    // Determine extension
    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/heic": "heic",
      "image/heif": "heif",
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
    };
    const ext = extMap[file.type] || "bin";
    const subdir = isPhoto ? "photos" : "videos";
    const filename = `${crypto.randomBytes(12).toString("hex")}.${ext}`;
    const dirPath = join(process.cwd(), "public", "attachments", subdir);
    await mkdir(dirPath, { recursive: true });

    const bytes = await file.arrayBuffer();
    await writeFile(join(dirPath, filename), Buffer.from(bytes));

    const fileUrl = `/attachments/${subdir}/${filename}`;

    return NextResponse.json({
      fileUrl,
      fileType,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });
  } catch (error) {
    console.error("POST /api/tasks/attachments error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    );
  }
}