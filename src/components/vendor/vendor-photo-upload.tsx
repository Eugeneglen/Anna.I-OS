"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Camera,
  ImagePlus,
  X,
  Link,
  Upload,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────

interface VendorPhotoUploadProps {
  bookingId: string;
  vendorId: string;
  uploadedPhotos: { before: any[]; after: any[] };
}

interface PhotoItem {
  id: string;
  url: string;
  label?: string;
}

type PhotoZone = "before" | "after";

// ─── Zone config ──────────────────────────────────────────

const ZONE_CONFIG: Record<PhotoZone, { title: string; description: string; accent: string }> = {
  before: {
    title: "Before Work",
    description: "Photo of the area / issue before starting",
    accent: "border-[var(--anna-warning)]/30",
  },
  after: {
    title: "After Work",
    description: "Photo showing completed work",
    accent: "border-[var(--anna-success)]/30",
  },
};

// ─── Photo thumbnail ─────────────────────────────────────

function PhotoThumbnail({
  photo,
  onRemove,
}: {
  photo: PhotoItem;
  onRemove: () => void;
}) {
  return (
    <div className="relative group aspect-square rounded-xl overflow-hidden border border-[var(--anna-border)]">
      <img
        src={photo.url}
        alt={photo.label ?? "Uploaded photo"}
        className="w-full h-full object-cover"
      />
      <button
        onClick={onRemove}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Remove photo"
      >
        <X size={10} />
      </button>
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
}: {
  zone: PhotoZone;
  photos: PhotoItem[];
  onAddFile: (zone: PhotoZone, file: File) => void;
  onAddUrl: (zone: PhotoZone, url: string) => void;
  onRemove: (zone: PhotoZone, id: string) => void;
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

  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--anna-border)] p-4",
        config.accent
      )}
    >
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)] mb-1">
        {config.title}
      </h4>
      <p className="text-[10px] text-[var(--anna-muted)] mb-3">{config.description}</p>

      {/* Thumbnail grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {photos.map((photo) => (
            <PhotoThumbnail
              key={photo.id}
              photo={photo}
              onRemove={() => onRemove(zone, photo.id)}
            />
          ))}
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
            disabled={!urlInput.trim()}
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
          className="h-8 text-xs rounded-lg border-dashed border-[var(--anna-border)] text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
        >
          <Camera size={13} className="mr-1.5" />
          Add Photo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowUrlInput((prev) => !prev)}
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
  uploadedPhotos,
}: VendorPhotoUploadProps) {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<{ before: PhotoItem[]; after: PhotoItem[] }>({
    before: (uploadedPhotos.before ?? []) as PhotoItem[],
    after: (uploadedPhotos.after ?? []) as PhotoItem[],
  });

  function addFile(zone: PhotoZone, file: File) {
    // Create a local blob URL for preview
    const url = URL.createObjectURL(file);
    const newPhoto: PhotoItem = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      label: file.name,
    };

    setPhotos((prev) => ({
      ...prev,
      [zone]: [...prev[zone], newPhoto],
    }));

    // Simulate upload — in production this would POST to S3 / API
    toast({
      title: "Photo added",
      description: `"${file.name}" added to ${ZONE_CONFIG[zone].title.toLowerCase()}`,
    });
  }

  function addUrl(zone: PhotoZone, url: string) {
    const newPhoto: PhotoItem = {
      id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      label: "URL upload",
    };

    setPhotos((prev) => ({
      ...prev,
      [zone]: [...prev[zone], newPhoto],
    }));

    toast({
      title: "Photo added via URL",
      description: `Added to ${ZONE_CONFIG[zone].title.toLowerCase()}`,
    });
  }

  function removePhoto(zone: PhotoZone, id: string) {
    setPhotos((prev) => ({
      ...prev,
      [zone]: prev[zone].filter((p) => p.id !== id),
    }));

    toast({
      title: "Photo removed",
      variant: "destructive",
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
      />
      <PhotoZone
        zone="after"
        photos={photos.after}
        onAddFile={addFile}
        onAddUrl={addUrl}
        onRemove={removePhoto}
      />
    </div>
  );
}