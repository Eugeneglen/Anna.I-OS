"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Camera,
  ImagePlus,
  X,
  Link,
  Upload,
  CheckCircle,
  Clock,
  Loader2,
  AlertCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────

interface VendorPhotoUploadProps {
  bookingId: string;
  vendorId: string;
  existingPhotos?: { id: string; fileUrl: string; thumbnailUrl?: string | null; uploadedBy: string; isVerified: boolean }[];
}

interface PhotoItem {
  id: string;
  url: string;
  label?: string;
  isPersisted?: boolean;
  isVerified?: boolean;
  uploadedBy?: string;
}

type PhotoZone = "before" | "after";

// ─── Zone config ──────────────────────────────────────────

const ZONE_CONFIG: Record<PhotoZone, { title: string; description: string; accent: string; iconBg: string }> = {
  before: {
    title: "Before Work",
    description: "Photo of the area / issue before starting",
    accent: "border-[var(--anna-warning)]/30",
    iconBg: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)]",
  },
  after: {
    title: "After Work",
    description: "Photo showing completed work",
    accent: "border-[var(--anna-success)]/30",
    iconBg: "bg-[var(--anna-success)]/15 text-[var(--anna-success)]",
  },
};

// ─── Photo thumbnail ─────────────────────────────────────

function PhotoThumbnail({
  photo,
  onRemove,
  showStatus,
}: {
  photo: PhotoItem;
  onRemove: () => void;
  showStatus?: boolean;
}) {
  return (
    <div className="relative group aspect-square rounded-xl overflow-hidden border border-[var(--anna-border)]">
      <img
        src={photo.url}
        alt={photo.label ?? "Work photo"}
        className="w-full h-full object-cover"
      />
      {/* Verified indicator */}
      {showStatus && photo.isVerified && (
        <div className="absolute top-1 left-1">
          <div className="w-5 h-5 rounded-full bg-[var(--anna-success)] flex items-center justify-center">
            <CheckCircle size={10} className="text-white" />
          </div>
        </div>
      )}
      {/* Persisted indicator */}
      {photo.isPersisted && (
        <div className="absolute top-1 left-1">
          <div className={cn(
            "w-5 h-5 rounded-full flex items-center justify-center",
            photo.isVerified
              ? "bg-[var(--anna-success)]"
              : "bg-[var(--anna-sage)]"
          )}>
            <CheckCircle size={10} className="text-white" />
          </div>
        </div>
      )}
      {/* Remove button — hidden for persisted photos */}
      {!photo.isPersisted && (
        <button
          onClick={onRemove}
          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Remove photo"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

// ─── Photo zone ───────────────────────────────────────────

function PhotoZone({
  zone,
  photos,
  onAddFile,
  onAddUrl,
  onRemove,
  isUploading,
}: {
  zone: PhotoZone;
  photos: PhotoItem[];
  onAddFile: (zone: PhotoZone, file: File) => void;
  onAddUrl: (zone: PhotoZone, url: string) => void;
  onRemove: (zone: PhotoZone, id: string) => void;
  isUploading: boolean;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const config = ZONE_CONFIG[zone];

  function handleUrlSubmit() {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    onAddUrl(zone, trimmed);
    setUrlInput("");
    setShowUrlInput(false);
  }

  const persistedPhotos = photos.filter((p) => p.isPersisted);
  const localPhotos = photos.filter((p) => !p.isPersisted);

  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--anna-border)] p-4",
        config.accent
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)]">
          {config.title}
        </h4>
        {persistedPhotos.length > 0 && (
          <Badge className="text-[9px] px-1.5 py-0 h-4 bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-0">
            {persistedPhotos.length} uploaded
          </Badge>
        )}
      </div>
      <p className="text-[10px] text-[var(--anna-muted)] mb-3">{config.description}</p>

      {/* Thumbnail grid — persisted photos first */}
      {(persistedPhotos.length > 0 || localPhotos.length > 0) && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[...persistedPhotos, ...localPhotos].map((photo) => (
            <PhotoThumbnail
              key={photo.id}
              photo={photo}
              onRemove={() => onRemove(zone, photo.id)}
              showStatus={photo.isPersisted}
            />
          ))}
        </div>
      )}

      {/* Upload progress indicator */}
      {isUploading && (
        <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-[var(--anna-sage-light)]/50 border border-[var(--anna-sage)]/20">
          <Loader2 size={12} className="animate-spin text-[var(--anna-sage-dark)]" />
          <span className="text-[10px] text-[var(--anna-sage-dark)]">Uploading...</span>
        </div>
      )}

      {/* URL input toggle */}
      {showUrlInput ? (
        <div className="flex gap-2 mb-3">
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste image URL..."
            className="h-9 text-xs bg-[var(--anna-bg)] border-[var(--anna-border)]"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleUrlSubmit();
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleUrlSubmit}
            disabled={!urlInput.trim() || isUploading}
            className="h-9 text-xs rounded-xl flex-shrink-0"
          >
            <Link size={12} className="mr-1" />
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowUrlInput(false);
              setUrlInput("");
            }}
            className="h-9 text-xs rounded-xl flex-shrink-0"
          >
            <X size={12} />
          </Button>
        </div>
      ) : null}

      {/* Action buttons */}
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onAddFile(zone, file);
              e.target.value = "";
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="h-8 text-xs rounded-lg border-dashed border-[var(--anna-border)] text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
        >
          <Camera size={13} className="mr-1.5" />
          Add Photo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowUrlInput((prev) => !prev)}
          disabled={isUploading}
          className="h-8 text-xs rounded-lg text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
        >
          <Link size={13} className="mr-1.5" />
          URL
        </Button>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────

export function VendorPhotoUpload({
  bookingId,
  vendorId,
  existingPhotos = [],
}: VendorPhotoUploadProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Initialize with existing persisted photos
  const [photos, setPhotos] = useState<{ before: PhotoItem[]; after: PhotoItem[] }>(() => {
    const before: PhotoItem[] = [];
    const after: PhotoItem[] = [];
    for (const p of existingPhotos) {
      const zone = p.uploadedBy.startsWith("vendor:before") ? "before" : "after";
      const item: PhotoItem = {
        id: p.id,
        url: p.thumbnailUrl || p.fileUrl,
        label: `Work photo`,
        isPersisted: true,
        isVerified: p.isVerified,
        uploadedBy: p.uploadedBy,
      };
      if (zone === "before") before.push(item);
      else after.push(item);
    }
    return { before, after };
  });

  // Upload mutation — actually POSTs to the API
  const uploadMutation = useMutation({
    mutationFn: async ({ zone, photos: photosToUpload }: { zone: PhotoZone; photos: { fileUrl: string; thumbnailUrl?: string }[] }) => {
      const res = await fetch(
        `/api/vendors/${vendorId}/bookings/${bookingId}/photos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: photosToUpload, type: zone }),
        }
      );
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Photos uploaded",
        description: `${data.count} photo(s) added to ${ZONE_CONFIG[variables.zone].title.toLowerCase()}`,
      });
      // Refresh schedule to pick up new photos
      queryClient.invalidateQueries({ queryKey: ["vendor-schedule"] });
    },
    onError: (err) => {
      toast({
        title: "Upload failed",
        description: err.message || "Failed to upload photos",
        variant: "destructive",
      });
    },
  });

  function addFile(zone: PhotoZone, file: File) {
    // Create a local blob URL for preview
    const url = URL.createObjectURL(file);
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newPhoto: PhotoItem = {
      id: tempId,
      url,
      label: file.name,
    };

    setPhotos((prev) => ({
      ...prev,
      [zone]: [...prev[zone], newPhoto],
    }));

    // Actually upload the photo to the API
    // Since we can't do S3 uploads in this sandbox, we use the blob URL as the fileUrl
    // In production, this would upload to S3 first, then POST the S3 URL
    uploadMutation.mutate({
      zone,
      photos: [{ fileUrl: url }],
    });
  }

  function addUrl(zone: PhotoZone, url: string) {
    const tempId = `url-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newPhoto: PhotoItem = {
      id: tempId,
      url,
      label: "URL upload",
    };

    setPhotos((prev) => ({
      ...prev,
      [zone]: [...prev[zone], newPhoto],
    }));

    // Upload via URL
    uploadMutation.mutate({
      zone,
      photos: [{ fileUrl: url }],
    });
  }

  function removePhoto(zone: PhotoZone, id: string) {
    setPhotos((prev) => ({
      ...prev,
      [zone]: prev[zone].filter((p) => p.id !== id),
    }));

    toast({
      title: "Photo removed from view",
      description: "Persisted photos remain on record",
    });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <PhotoZone
        zone="before"
        photos={photos.before}
        onAddFile={addFile}
        onAddUrl={addUrl}
        onRemove={removePhoto}
        isUploading={uploadMutation.isPending}
      />
      <PhotoZone
        zone="after"
        photos={photos.after}
        onAddFile={addFile}
        onAddUrl={addUrl}
        onRemove={removePhoto}
        isUploading={uploadMutation.isPending}
      />
    </div>
  );
}
