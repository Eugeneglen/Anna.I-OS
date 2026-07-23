"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  FileText,
  ImageIcon,
  Loader2,
  AlertCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────

interface CompleteWorkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  vendorId: string;
  taskCategory: string;
  photoCount: number;
  onSubmit: (bookingId: string, completionNotes: string) => void;
  isSubmitting?: boolean;
}

// ─── Component ──────────────────────────────────────────

export function CompleteWorkDialog({
  open,
  onOpenChange,
  bookingId,
  vendorId,
  taskCategory,
  photoCount,
  onSubmit,
  isSubmitting = false,
}: CompleteWorkDialogProps) {
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const charCount = notes.length;
  const maxChars = 1000;
  const isOverLimit = charCount > maxChars;

  function handleSubmit() {
    if (isOverLimit) {
      toast({
        title: "Notes too long",
        description: `Please keep your notes under ${maxChars} characters (currently ${charCount})`,
        variant: "destructive",
      });
      return;
    }

    onSubmit(bookingId, notes.trim());
    // Reset state after submission
    setNotes("");
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      // Don't reset notes when closing — user might want to come back
      // Notes are reset on successful submit
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl border-[var(--anna-border)] bg-[var(--anna-white)] p-0 overflow-hidden">
        {/* Header with gradient accent */}
        <div className="bg-gradient-to-r from-[var(--anna-sage)]/10 to-[var(--anna-sage-light)]/30 px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[var(--anna-slate)]">
              <div className="w-8 h-8 rounded-xl bg-[var(--anna-sage)] flex items-center justify-center flex-shrink-0">
                <CheckCircle size={16} className="text-white" />
              </div>
              Complete Work
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--anna-muted)] pl-10">
              Summarize the work done and add any recommendations for the household.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="px-6 pb-4 space-y-4">
          {/* Job summary badge */}
          <div className="flex items-center gap-2 text-xs">
            <Badge
              variant="outline"
              className="text-[10px] px-2 py-0.5 font-medium bg-[var(--anna-sage-light)]/50 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20"
            >
              {taskCategory}
            </Badge>
            <span className="text-[var(--anna-muted)]">•</span>
            <div className="flex items-center gap-1 text-[var(--anna-muted)]">
              <ImageIcon size={11} />
              <span>{photoCount} photo{photoCount !== 1 ? "s" : ""} uploaded</span>
            </div>
          </div>

          {/* Completion notes textarea */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--anna-slate)]">
              <FileText size={12} className="text-[var(--anna-muted)]" />
              Work Summary & Recommendations
              <span className="text-[var(--anna-muted)] font-normal">(optional)</span>
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Deep cleaned kitchen and bathrooms. Recommend chemical wash for next service to remove stubborn stains in grout lines."
              className={cn(
                "min-h-[120px] text-sm bg-[var(--anna-bg)] border-[var(--anna-border)] rounded-xl resize-none",
                "placeholder:text-[var(--anna-muted)]/60",
                "focus-visible:ring-[var(--anna-sage)]/30 focus-visible:border-[var(--anna-sage)]/50",
                isOverLimit && "border-[var(--anna-error)]/50 focus-visible:ring-[var(--anna-error)]/30"
              )}
              maxLength={1050}
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-[var(--anna-muted)]">
                Add notes about work completed, issues found, or recommendations for future services.
              </p>
              <span
                className={cn(
                  "text-[10px] font-data tabular-nums",
                  isOverLimit ? "text-[var(--anna-error)]" : "text-[var(--anna-muted)]"
                )}
              >
                {charCount}/{maxChars}
              </span>
            </div>
          </div>

          {/* Over-limit warning */}
          {isOverLimit && (
            <div className="flex items-center gap-2 text-[10px] text-[var(--anna-error)] bg-[var(--anna-error)]/5 rounded-lg px-3 py-2 border border-[var(--anna-error)]/10">
              <AlertCircle size={12} className="flex-shrink-0" />
              <span>Notes exceed the {maxChars} character limit. Please shorten before submitting.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 pb-6 pt-0">
          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="flex-1 rounded-xl border-[var(--anna-border)] text-[var(--anna-slate)] text-sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl text-sm font-semibold h-10"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle size={14} className="mr-2" />
                  Complete & Submit
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
