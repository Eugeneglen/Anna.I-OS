"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

// ============================================================
// Anna.I — Household Download Button
// ============================================================
// Dropdown with CSV + JSON export options for a single household.
// Triggers a file download via the auth-gated ops export API.
// ============================================================

interface DownloadButtonProps {
  householdId: string;
}

export function DownloadButton({ householdId }: DownloadButtonProps) {
  const [downloading, setDownloading] = useState<string | null>(null);

  async function handleDownload(format: "csv" | "json") {
    setDownloading(format);
    try {
      const res = await fetch(`/api/ops/households/${householdId}/export?format=${format}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `household-${householdId.slice(-8)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch {
      toast.error("Failed to export");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl border-[var(--anna-border)]"
          disabled={!!downloading}
        >
          {downloading ? (
            <Loader2 size={14} className="mr-1 animate-spin" />
          ) : (
            <Download size={14} className="mr-1" />
          )}
          {downloading ? "Exporting..." : "Download"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => handleDownload("csv")}>
          <Download size={14} className="mr-2" />
          CSV (spreadsheet)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleDownload("json")}>
          <Download size={14} className="mr-2" />
          JSON (full data)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
