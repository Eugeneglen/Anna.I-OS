"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ImagePlus,
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

        // Create preview URL for images
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

      {/* Video indicator */}
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
// Add button
// ─────────────────────────────────────────────────────────────

function AddButton({
  isVideo,
  disabled,
  onClick,
  uploading,
}: {
  isVideo: boolean;
  disabled: boolean;
  onClick: () => void;
  uploading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || uploading}
      className={cn(
        "aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition-all",
        disabled || uploading
          ? "border-[var(--anna-border)] opacity-40 cursor-not-allowed"
          : "border-[var(--anna-sage)]/50 bg-[var(--anna-sage-light)]/30 hover:bg-[var(--anna-sage-light)]/50 hover:border-[var(--anna-sage)] cursor-pointer"
      )}
    >
      {uploading ? (
        <Loader2 size={18} className="text-[var(--anna-sage)] animate-spin" />
      ) : isVideo ? (
        <PlusCircle size={18} className="text-[var(--anna-sage-dark)]" />
      ) : (
        <ImagePlus size={18} className="text-[var(--anna-sage-dark)]" />
      )}
      <span className="text-[10px] text-[var(--anna-muted)] font-medium">
        {uploading ? "Uploading..." : "Add"}
      </span>
    </button>
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
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = ""; // reset so same file can be re-selected

      for (const file of files) {
        if (photos.length >= maxPhotos) break;
        try {
          const uploaded = await upload(file, "PHOTO", photos.length);
          onPhotosChange([...photos, uploaded]);
        } catch (err) {
          console.error("Photo upload failed:", err);
        }
      }
    },
    [photos, maxPhotos, upload, onPhotosChange]
  );

  const handleVideoSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";

      for (const file of files) {
        if (videos.length >= maxVideos) break;
        try {
          const uploaded = await upload(file, "VIDEO", videos.length);
          onVideosChange([...videos, uploaded]);
        } catch (err) {
          console.error("Video upload failed:", err);
        }
      }
    },
    [videos, maxVideos, upload, onVideosChange]
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

  return (
    <div className="space-y-4">
      {/* Photos */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
            <ImageIcon size={12} />
            Photos
          </Label>
          <span className="text-[10px] text-[var(--anna-muted)]">
            {photos.length}/{maxPhotos}
          </span>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
          {photos.map((photo, i) => (
            <Thumbnail
              key={photo.fileUrl}
              file={photo}
              isVideo={false}
              onRemove={() => removePhoto(i)}
            />
          ))}
          {photos.length < maxPhotos && (
            <AddButton
              isVideo={false}
              disabled={uploading}
              onClick={() => photoInputRef.current?.click()}
              uploading={false}
            />
          )}
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic"
          multiple
          className="hidden"
          onChange={handlePhotoSelect}
        />
      </div>

      {/* Videos */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
            <Film size={12} />
            Videos
          </Label>
          <span className="text-[10px] text-[var(--anna-muted)]">
            {videos.length}/{maxVideos}
          </span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {videos.map((video, i) => (
            <Thumbnail
              key={video.fileUrl}
              file={video}
              isVideo={true}
              onRemove={() => removeVideo(i)}
            />
          ))}
          {videos.length < maxVideos && (
            <AddButton
              isVideo={true}
              disabled={uploading}
              onClick={() => videoInputRef.current?.click()}
              uploading={uploading}
            />
          )}
        </div>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          multiple
          className="hidden"
          onChange={handleVideoSelect}
        />
      </div>
    </div>
  );
}