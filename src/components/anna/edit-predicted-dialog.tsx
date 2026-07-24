"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CalendarClock, Sparkles, FileText, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { formatSgd } from "@/lib/types";

interface EditPredictedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  category: string;
  currentScheduledStart?: string | null;
  currentInstructions?: string | null;
  currentAmountCents?: number;
  lockAt?: string | null;
  onSuccess?: () => void;
}

export function EditPredictedDialog({
  open,
  onOpenChange,
  taskId,
  category,
  currentScheduledStart,
  currentInstructions,
  currentAmountCents,
  lockAt,
  onSuccess,
}: EditPredictedDialogProps) {
  const queryClient = useQueryClient();

  // Form state
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("10:00");
  const [instructions, setInstructions] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check if past lock deadline
  const isPastLock = lockAt ? new Date() > new Date(lockAt) : false;

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (currentScheduledStart) {
        const d = new Date(currentScheduledStart);
        setScheduledDate(d.toISOString().split("T")[0]);
        setScheduledTime(
          `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
        );
      } else {
        setScheduledDate("");
        setScheduledTime("10:00");
      }
      setInstructions(currentInstructions || "");
      setAmountStr(currentAmountCents ? String(currentAmountCents / 100) : "");
    }
  }, [open, currentScheduledStart, currentInstructions, currentAmountCents]);

  const handleSubmit = async () => {
    if (!scheduledDate) {
      toast({ title: "Please select a date", variant: "destructive" });
      return;
    }

    const scheduledStart = new Date(`${scheduledDate}T${scheduledTime}:00`);
    if (isNaN(scheduledStart.getTime())) {
      toast({ title: "Invalid date/time", variant: "destructive" });
      return;
    }

    const updates: Record<string, unknown> = {
      scheduledStart: scheduledStart.toISOString(),
    };

    if (instructions !== (currentInstructions || "")) {
      updates.instructions = instructions;
    }

    const newAmountCents = parseFloat(amountStr);
    if (!isNaN(newAmountCents) && newAmountCents > 0 && newAmountCents !== (currentAmountCents || 0) / 100) {
      updates.amountCents = Math.round(newAmountCents * 100);
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/edit-predictive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to edit prediction");
      }

      toast({ title: "Prediction updated", description: "Your booking has been rescheduled." });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["household"] });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Failed to update",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[var(--anna-slate)]">
            <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center">
              <Sparkles size={16} className="text-purple-700" />
            </div>
            Edit AI Prediction
          </DialogTitle>
          <DialogDescription className="text-[var(--anna-muted)]">
            Modify the predicted {category.replace(/_/g, " ").toLowerCase()} booking. Changes will update the lock deadline automatically.
          </DialogDescription>
        </DialogHeader>

        {isPastLock && (
          <div className="bg-red-50 text-red-700 rounded-xl px-3 py-2 text-xs">
            ⚠ Lock deadline has passed. This prediction can no longer be edited.
          </div>
        )}

        <div className="space-y-4">
          {/* Date picker */}
          <div>
            <label className="text-xs font-medium text-[var(--anna-muted)] mb-1.5 flex items-center gap-1">
              <CalendarClock size={12} />
              Scheduled Date & Time
            </label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                disabled={isPastLock}
                className="flex-1 rounded-xl"
              />
              <Input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                disabled={isPastLock}
                className="w-28 rounded-xl"
              />
            </div>
          </div>

          {/* Instructions */}
          <div>
            <label className="text-xs font-medium text-[var(--anna-muted)] mb-1.5 flex items-center gap-1">
              <FileText size={12} />
              Instructions
            </label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Add any special instructions..."
              rows={3}
              disabled={isPastLock}
              className="rounded-xl resize-none"
              maxLength={500}
            />
            <p className="text-[10px] text-[var(--anna-muted)] mt-1 text-right">
              {instructions.length}/500
            </p>
          </div>

          {/* Amount */}
          <div>
            <label className="text-xs font-medium text-[var(--anna-muted)] mb-1.5 flex items-center gap-1">
              <DollarSign size={12} />
              Amount (SGD)
            </label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.00"
              disabled={isPastLock}
              className="rounded-xl"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || isPastLock || !scheduledDate}
            className="rounded-xl bg-[var(--anna-sage)] text-white hover:bg-[var(--anna-sage-dark)]"
          >
            {isSubmitting && <Loader2 size={14} className="animate-spin mr-1" />}
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
