"use client";

import { useState, useRef, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  X,
  Film,
  ImageIcon,
  Loader2,
  PlusCircle,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface UploadedFile {
  fileUrl: string;
  fileType: "PHOTO" | "VIDEO";
  fileName: string;
  fileSize: number;
  mimeType: string;
  previewUrl?: string;
}

interface MediaUploaderProps {
  photos: UploadedFile[];
  videos: UploadedFile[];
  onPhotosChange: (files: UploadedFile[]) => void;
  onVideosChange: (files: UploadedFile[]) => void;
  maxPhotos?: number;
  maxVideos?: number;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_MIME_PREFIX = "image/";
const VIDEO_MIME_PREFIX = "video/";

function classifyFile(file: File): "PHOTO" | "VIDEO" | null {
  if (file.type.startsWith(IMAGE_MIME_PREFIX)) return "PHOTO";
  if (file.type.startsWith(VIDEO_MIME_PREFIX)) return "VIDEO";
  return null;
}

// ─────────────────────────────────────────────────────────────
// Upload hook
// ─────────────────────────────────────────────────────────────

function useFileUpload() {
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (file: File, fileType: "PHOTO" | "VIDEO", existingCount: number) => {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("fileType", fileType);
        fd.append("existingCount", String(existingCount));

        const res = await fetch("/api/tasks/attachments", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Upload failed");
        }
        const data = await res.json();

        const previewUrl =
          fileType === "PHOTO" ? data.fileUrl : undefined;

        return {
          fileUrl: data.fileUrl,
          fileType: data.fileType as "PHOTO" | "VIDEO",
          fileName: data.fileName,
          fileSize: data.fileSize,
          mimeType: data.mimeType,
          previewUrl,
        } as UploadedFile;
      } finally {
        setUploading(false);
      }
    },
    []
  );

  return { upload, uploading };
}

// ─────────────────────────────────────────────────────────────
// Thumbnail component
// ─────────────────────────────────────────────────────────────

function Thumbnail({
  file,
  onRemove,
  isVideo,
}: {
  file: UploadedFile;
  onRemove: () => void;
  isVideo: boolean;
}) {
  return (
    <div className="relative group/thumb rounded-xl overflow-hidden border border-[var(--anna-border)] bg-[var(--anna-bg)] aspect-square">
      {isVideo ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2">
          <Film size={20} className="text-[var(--anna-muted)]" />
          <span className="text-[10px] text-[var(--anna-muted)] text-center leading-tight line-clamp-2">
            {file.fileName}
          </span>
          <span className="text-[9px] text-[var(--anna-muted)]">
            {formatFileSize(file.fileSize)}
          </span>
        </div>
      ) : (
        <img
          src={file.previewUrl || file.fileUrl}
          alt={file.fileName}
          className="w-full h-full object-cover"
        />
      )}

      {/* Remove button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-black/80"
        aria-label={`Remove ${file.fileName}`}
      >
        <X size={12} />
      </button>

      {/* Video indicator badge */}
      {isVideo && (
        <div className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded-md">
          <Film size={8} />
          {formatFileSize(file.fileSize)}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function MediaUploader({
  photos,
  videos,
  onPhotosChange,
  onVideosChange,
  maxPhotos = 5,
  maxVideos = 2,
}: MediaUploaderProps) {
  const { upload, uploading } = useFileUpload();
  const inputRef = useRef<HTMLInputElement>(null);

  const canAddMore = photos.length < maxPhotos || videos.length < maxVideos;

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";

      const photosToUpload: File[] = [];
      const videosToUpload: File[] = [];

      // Classify each file
      for (const file of files) {
        const type = classifyFile(file);
        if (!type) continue; // skip unsupported types

        if (type === "PHOTO" && photosToUpload.length + photos.length < maxPhotos) {
          photosToUpload.push(file);
        } else if (type === "VIDEO" && videosToUpload.length + videos.length < maxVideos) {
          videosToUpload.push(file);
        }
      }

      // Upload photos
      let updatedPhotos = [...photos];
      for (const file of photosToUpload) {
        try {
          const uploaded = await upload(file, "PHOTO", updatedPhotos.length);
          updatedPhotos = [...updatedPhotos, uploaded];
          onPhotosChange(updatedPhotos);
        } catch (err) {
          console.error("Photo upload failed:", err);
        }
      }

      // Upload videos
      let updatedVideos = [...videos];
      for (const file of videosToUpload) {
        try {
          const uploaded = await upload(file, "VIDEO", updatedVideos.length);
          updatedVideos = [...updatedVideos, uploaded];
          onVideosChange(updatedVideos);
        } catch (err) {
          console.error("Video upload failed:", err);
        }
      }
    },
    [photos, videos, maxPhotos, maxVideos, upload, onPhotosChange, onVideosChange]
  );

  const removePhoto = useCallback(
    (index: number) => {
      onPhotosChange(photos.filter((_, i) => i !== index));
    },
    [photos, onPhotosChange]
  );

  const removeVideo = useCallback(
    (index: number) => {
      onVideosChange(videos.filter((_, i) => i !== index));
    },
    [videos, onVideosChange]
  );

  const totalCount = photos.length + videos.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
          <ImageIcon size={12} />
          Photos & Videos
        </Label>
        <span className="text-[10px] text-[var(--anna-muted)]">
          {photos.length}/{maxPhotos} photos · {videos.length}/{maxVideos} videos
        </span>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
        {/* Photo thumbnails */}
        {photos.map((photo, i) => (
          <Thumbnail
            key={photo.fileUrl}
            file={photo}
            isVideo={false}
            onRemove={() => removePhoto(i)}
          />
        ))}

        {/* Video thumbnails */}
        {videos.map((video, i) => (
          <Thumbnail
            key={video.fileUrl}
            file={video}
            isVideo={true}
            onRemove={() => removeVideo(i)}
          />
        ))}

        {/* Single unified add button */}
        {canAddMore && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={cn(
              "aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition-all",
              uploading
                ? "border-[var(--anna-border)] opacity-40 cursor-not-allowed"
                : "border-[var(--anna-sage)]/50 bg-[var(--anna-sage-light)]/30 hover:bg-[var(--anna-sage-light)]/50 hover:border-[var(--anna-sage)] cursor-pointer"
            )}
          >
            {uploading ? (
              <Loader2 size={18} className="text-[var(--anna-sage)] animate-spin" />
            ) : (
              <PlusCircle size={18} className="text-[var(--anna-sage-dark)]" />
            )}
            <span className="text-[10px] text-[var(--anna-muted)] font-medium">
              {uploading ? "Uploading..." : "Add"}
            </span>
          </button>
        )}
      </div>

      {/* Single combined file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,video/mp4,video/quicktime,video/webm"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}