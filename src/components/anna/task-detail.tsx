"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { useIsMobile } from "@/hooks/use-mobile";
import { CategoryIcon, getCategoryLabel } from "./category-icon";
import { StatusTimeline } from "./status-timeline";
import { EscrowBadge } from "./escrow-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  formatSgd,
  formatDate,
  formatTime,
  STATUS_LABELS,
  type Task,
  type TaskStatus,
  type VendorSuggestion,
} from "@/lib/types";
import { Star, Clock, User, ShieldCheck, Send, Play, CheckCircle, ThumbsUp, ThumbsDown, RefreshCw, AlertTriangle, ArrowRight, Zap, Trophy, ImageIcon, Film, RotateCcw, X, Sparkles, Brain, Eye, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

async function fetchTask(taskId: string): Promise<Task> {
  const res = await fetch(`/api/tasks/${taskId}`);
  if (!res.ok) throw new Error("Failed to fetch task");
  const data = await res.json();
  return data.task;
}

async function fetchVendorSuggestions(taskId: string): Promise<VendorSuggestion[]> {
  const res = await fetch(`/api/tasks/${taskId}/suggest-vendors`);
  if (!res.ok) throw new Error("Failed to fetch vendor suggestions");
  const data = await res.json();
  return data.suggestions || [];
}

const actionButtons: Record<
  TaskStatus,
  { label: string; icon: React.ElementType; variant: "default" | "outline" | "destructive"; action: string }[]
> = {
  PREDICTED: [{ label: "Cancel Prediction", icon: X, variant: "destructive", action: "cancel-predicted" }],
  CREATED: [{ label: "Dispatch to Vendor", icon: Send, variant: "default", action: "dispatch" }],
  DISPATCHED: [{ label: "Mark In Progress", icon: Play, variant: "outline", action: "in-progress" }],
  IN_PROGRESS: [{ label: "Mark Complete", icon: CheckCircle, variant: "outline", action: "complete" }],
  COMPLETED: [
    { label: "Verify Photo", icon: ThumbsUp, variant: "default", action: "verify" },
    { label: "Reject & Dispute", icon: ThumbsDown, variant: "destructive", action: "dispute" },
  ],
  VERIFIED: [{ label: "Release Escrow", icon: ShieldCheck, variant: "default", action: "release" }],
  ESCROW_RELEASED: [{ label: "Rebook", icon: RefreshCw, variant: "outline", action: "rebook" }],
  DISPUTED: [{ label: "Resolve Dispute", icon: RotateCcw, variant: "outline", action: "resolve" }],
};

const statusBadgeStyles: Record<TaskStatus, string> = {
  PREDICTED: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  CREATED: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
  DISPATCHED: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  IN_PROGRESS: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  COMPLETED: "bg-[var(--anna-slate-light)]/15 text-[var(--anna-slate-light)] border-[var(--anna-slate-light)]/20",
  VERIFIED: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
  ESCROW_RELEASED: "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
  DISPUTED: "bg-[var(--anna-error)]/15 text-[var(--anna-error)] border-[var(--anna-error)]/20",
};

function TaskDetailContent({ taskId }: { taskId: string }) {
  const { selectedHouseholdId, closeTaskDetail, setActiveTab } = useAnnaStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: task, isLoading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTask(taskId),
    enabled: !!taskId,
  });

  const { data: suggestions, isLoading: suggestionsLoading } = useQuery({
    queryKey: ["vendor-suggestions", taskId],
    queryFn: () => fetchVendorSuggestions(taskId),
    enabled: !!task && task.status === "CREATED",
  });

  // Mutations
  const dispatchMutation = useMutation({
    mutationFn: async (vendorId?: string) => {
      const body: Record<string, string> = {};
      if (vendorId) body.vendorId = vendorId;
      const res = await fetch(`/api/tasks/${taskId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Dispatch failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task dispatched successfully" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["household"] });
    },
    onError: () => {
      toast({ title: "Failed to dispatch task", variant: "destructive" });
    },
  });

  const updateBookingMutation = useMutation({
    mutationFn: async (body: { status: string; rating?: number; ratingComment?: string }) => {
      const bookingId = task?.bookings?.[0]?.id;
      if (!bookingId) throw new Error("No booking found");
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task updated" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const bookingId = task?.bookings?.[0]?.id;
      if (!bookingId) throw new Error("No booking found");
      const res = await fetch(`/api/tasks/${taskId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      if (!res.ok) throw new Error("Verification failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task verified — autonomy updated" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["autonomy"] });
    },
  });

  const escrowMutation = useMutation({
    mutationFn: async (body: { action: "release" | "dispute"; reason?: string }) => {
      const res = await fetch(`/api/tasks/${taskId}/escrow`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Escrow action failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Escrow updated" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });

  const rebookMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tasks/${taskId}/rebook`, { method: "POST" });
      if (!res.ok) throw new Error("Rebook failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task rebooked" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      closeTaskDetail();
    },
  });

  // H-4 FIX: Implement resolve dispute action
  const resolveDisputeMutation = useMutation({
    mutationFn: async () => {
      // Resolve dispute by resetting task back to COMPLETED (allowing re-verification)
      const bookingId = task?.bookings?.[0]?.id;
      if (!bookingId) throw new Error("No booking found");
      const res = await fetch(`/api/tasks/${taskId}/resolve-dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      if (!res.ok) throw new Error("Failed to resolve dispute");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Dispute resolved — task returned to Pending Verification" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["anomalies"] });
    },
    onError: () => {
      toast({ title: "Failed to resolve dispute", variant: "destructive" });
    },
  });

  // AI Photo Analysis
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);

  const analyzePhotosMutation = useMutation({
    mutationFn: async () => {
      if (!task?.verificationPhotos || task.verificationPhotos.length === 0) {
        throw new Error("No photos to analyze");
      }
      const photos = task.verificationPhotos.map((p) => ({
        url: p.fileUrl,
        type: p.uploadedBy?.includes("before") ? "before" : "after",
      }));
      const res = await fetch("/api/analyze-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos,
          category: task.category,
          instructions: task.instructions,
        }),
      });
      if (!res.ok) throw new Error("AI analysis failed");
      return res.json();
    },
    onSuccess: (data) => {
      setAiAnalysis(data.analysis);
      toast({ title: "AI Analysis Complete", description: "Photo quality assessment ready" });
    },
    onError: (err) => {
      toast({
        title: "AI Analysis Failed",
        description: err.message || "Could not analyze photos",
        variant: "destructive",
      });
    },
  });

  // Phase 4: Cancel predicted task mutation
  const cancelPredictedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tasks/${taskId}/cancel-predictive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cancelled by household" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to cancel prediction");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Prediction cancelled" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["household"] });
      closeTaskDetail();
    },
    onError: (err) => {
      toast({ title: err.message || "Failed to cancel", variant: "destructive" });
    },
  });

  function handleAction(action: string, payload?: string) {
    switch (action) {
      case "dispatch":
        dispatchMutation.mutate(payload); // undefined = auto-select
        break;
      case "dispatch-vendor":
        dispatchMutation.mutate(payload);
        break;
      case "in-progress":
        updateBookingMutation.mutate({ status: "in_progress" });
        break;
      case "complete":
        updateBookingMutation.mutate({ status: "completed" });
        break;
      case "verify":
        verifyMutation.mutate();
        break;
      case "dispute":
        escrowMutation.mutate({ action: "dispute", reason: "Work quality issue" });
        break;
      case "release":
        escrowMutation.mutate({ action: "release" });
        break;
      case "rebook":
        rebookMutation.mutate();
        break;
      case "resolve":
        // H-4 FIX: Now actually calls the resolve mutation
        resolveDisputeMutation.mutate();
        break;
      case "cancel-predicted":
        cancelPredictedMutation.mutate();
        break;
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-40 rounded-lg bg-[var(--anna-border)]" />
        <Skeleton className="h-4 w-64 rounded-lg bg-[var(--anna-border)]" />
        <Skeleton className="h-20 w-full rounded-xl bg-[var(--anna-border)]" />
        <Skeleton className="h-40 w-full rounded-xl bg-[var(--anna-border)]" />
      </div>
    );
  }

  if (!task) return null;

  const booking = task.bookings?.[0];
  const escrow = task.escrowEntries?.[0];
  const actions = actionButtons[task.status] || [];

  return (
    <div className="p-6 space-y-6 anna-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <CategoryIcon category={task.category} size={20} />
          <div>
            <h2 className="text-lg font-bold text-[var(--anna-slate)]">
              {task.jobType
                ? `${getCategoryLabel(task.category)} — ${task.jobType.name}`
                : getCategoryLabel(task.category)}
            </h2>
            <p className="text-xs text-[var(--anna-muted)]">
              Created {formatDate(task.createdAt)}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={statusBadgeStyles[task.status]}
        >
          {STATUS_LABELS[task.status]}
        </Badge>
      </div>

      {/* Phase 4: Predicted Task Info */}
      {task.status === "PREDICTED" && (
        <div className="rounded-2xl border-2 border-[var(--anna-sage)]/30 bg-gradient-to-br from-[var(--anna-sage-light)]/40 to-[var(--anna-white)] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[var(--anna-sage)] flex items-center justify-center">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--anna-sage-dark)]">AI Predicted Booking</p>
              <p className="text-[10px] text-[var(--anna-sage-dark)]/60">
                Based on your household's booking patterns
              </p>
            </div>
          </div>

          {task.scheduledStart && (
            <div className="flex items-center gap-2 text-xs text-[var(--anna-slate)]">
              <Clock size={12} className="text-[var(--anna-muted)]" />
              <span>Scheduled: {formatDate(task.scheduledStart)} at {formatTime(task.scheduledStart)}</span>
            </div>
          )}

          {task.lockAt && (
            <div className={cn(
              "flex items-center gap-2 text-xs rounded-xl px-3 py-2",
              new Date() > new Date(task.lockAt)
                ? "bg-[var(--anna-error)]/10 text-[var(--anna-error)]"
                : "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
            )}>
              <Clock size={12} />
              <span className="font-medium">
                {new Date() > new Date(task.lockAt)
                  ? "Lock deadline passed — cannot cancel"
                  : `Editable until ${new Date(task.lockAt).toLocaleDateString("en-SG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Amount */}
      <div className="bg-[var(--anna-sage-light)] rounded-2xl p-4 flex items-center justify-between">
        <span className="text-sm text-[var(--anna-slate-light)]">Task Amount</span>
        <span className="font-data text-xl font-bold text-[var(--anna-slate)]">
          {formatSgd(task.amountCents)}
        </span>
      </div>

      {/* Instructions */}
      {task.instructions && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            Instructions
          </h4>
          <p className="text-sm text-[var(--anna-slate)] leading-relaxed bg-[var(--anna-bg)] rounded-xl p-4">
            {task.instructions}
          </p>
        </div>
      )}

      {/* Attachments (Photos & Videos) */}
      {task.attachments && task.attachments.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            Attachments
          </h4>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {task.attachments.map((att) =>
              att.fileType === "PHOTO" ? (
                <div
                  key={att.id}
                  className="aspect-square rounded-xl overflow-hidden border border-[var(--anna-border)]"
                >
                  <img
                    src={att.fileUrl}
                    alt={att.fileName}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div
                  key={att.id}
                  className="aspect-square rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] flex flex-col items-center justify-center gap-1 p-2"
                >
                  <Film size={20} className="text-[var(--anna-muted)]" />
                  <span className="text-[9px] text-[var(--anna-muted)] text-center line-clamp-2">
                    {att.fileName}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Status Timeline */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
          Progress
        </h4>
        <div className="bg-[var(--anna-bg)] rounded-2xl p-4">
          <StatusTimeline status={task.status} />
        </div>
      </div>

      {/* Booking Info */}
      {booking && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            Booking Details
          </h4>
          <div className="bg-[var(--anna-bg)] rounded-2xl p-4 space-y-3">
            {booking.vendor && (
              <div className="flex items-center gap-2">
                <User size={14} className="text-[var(--anna-muted)]" />
                <span className="text-sm font-medium">{booking.vendor.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-[var(--anna-muted)]">
              <Clock size={12} />
              <span>
                Scheduled: {formatDate(booking.scheduledStart)}{" "}
                {formatTime(booking.scheduledStart)}
              </span>
            </div>
            {booking.actualStart && (
              <div className="flex items-center gap-2 text-xs text-[var(--anna-muted)]">
                <Clock size={12} />
                <span>
                  Actual: {formatDate(booking.actualStart)}{" "}
                  {formatTime(booking.actualStart)}
                </span>
              </div>
            )}
            {booking.rating && (
              <div className="flex items-center gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    size={14}
                    className={
                      i < booking.rating!
                        ? "text-[var(--anna-warning)]"
                        : "text-[var(--anna-border)]"
                    }
                    fill={i < booking.rating! ? "currentColor" : "none"}
                  />
                ))}
                {booking.ratingComment && (
                  <span className="text-xs text-[var(--anna-muted)] ml-2">
                    &ldquo;{booking.ratingComment}&rdquo;
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Verification Photos */}
      {task.verificationPhotos && task.verificationPhotos.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Verification Photos
            </h4>
            {/* AI Analysis trigger — only for COMPLETED tasks with photos */}
            {task.status === "COMPLETED" && (
              <button
                type="button"
                onClick={() => {
                  setAiAnalysis(null);
                  analyzePhotosMutation.mutate();
                }}
                disabled={analyzePhotosMutation.isPending}
                className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--anna-sage-dark)] hover:text-[var(--anna-sage)] transition-colors"
              >
                {analyzePhotosMutation.isPending ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Brain size={11} />
                )}
                {analyzePhotosMutation.isPending ? "Analyzing..." : "AI Analysis"}
              </button>
            )}
          </div>

          {/* Before/After labeled photo grid */}
          <div className="grid grid-cols-3 gap-2">
            {task.verificationPhotos.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-square rounded-xl overflow-hidden border border-[var(--anna-border)]"
              >
                <img
                  src={photo.thumbnailUrl || photo.fileUrl}
                  alt="Verification"
                  className="w-full h-full object-cover"
                />
                {/* Top-left: Before/After label */}
                <div className="absolute top-1 left-1">
                  {photo.uploadedBy?.includes("before") ? (
                    <Badge className="text-[8px] px-1 py-0 h-4 bg-[var(--anna-warning)] text-white border-0">
                      Before
                    </Badge>
                  ) : (
                    <Badge className="text-[8px] px-1 py-0 h-4 bg-[var(--anna-sage)] text-white border-0">
                      After
                    </Badge>
                  )}
                </div>
                {/* Top-right: Verification status */}
                <div className="absolute top-1 right-1">
                  {photo.isVerified ? (
                    <Badge className="bg-[var(--anna-success)] text-white text-[9px] px-1.5 py-0 h-5">
                      <CheckCircle size={10} className="mr-0.5" />
                      Verified
                    </Badge>
                  ) : photo.rejectionReason ? (
                    <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-5">
                      Rejected
                    </Badge>
                  ) : (
                    <Badge className="bg-[var(--anna-warning)] text-white text-[9px] px-1.5 py-0 h-5">
                      <Clock size={10} className="mr-0.5" />
                      Pending
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Photo Analysis Results */}
      {aiAnalysis && (
        <div className="rounded-2xl border-2 border-[var(--anna-sage)]/30 overflow-hidden bg-gradient-to-br from-[var(--anna-sage-light)]/40 to-[var(--anna-white)] anna-fade-in">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--anna-sage)]/20">
            <div className="w-6 h-6 rounded-lg bg-[var(--anna-sage)] flex items-center justify-center">
              <Brain size={12} className="text-white" />
            </div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)]">
              AI Verification
            </h4>
            <button
              type="button"
              onClick={() => setAiAnalysis(null)}
              className="ml-auto text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
            >
              <X size={12} />
            </button>
          </div>

          {/* Analysis content */}
          <div className="p-4 space-y-3">
            {/* Quality score bar */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--anna-muted)]">Quality</span>
              <div className="flex-1 h-2 rounded-full bg-[var(--anna-bg)] overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    aiAnalysis.qualityScore >= 7
                      ? "bg-[var(--anna-success)]"
                      : aiAnalysis.qualityScore >= 4
                        ? "bg-[var(--anna-warning)]"
                        : "bg-[var(--anna-error)]"
                  )}
                  style={{ width: `${Math.min(aiAnalysis.qualityScore * 10, 100)}%` }}
                />
              </div>
              <span className={cn(
                "font-data text-sm font-bold",
                aiAnalysis.qualityScore >= 7
                  ? "text-[var(--anna-success)]"
                  : aiAnalysis.qualityScore >= 4
                    ? "text-[var(--anna-warning)]"
                    : "text-[var(--anna-error)]"
              )}>
                {aiAnalysis.qualityScore}/10
              </span>
            </div>

            {/* Recommendation badge */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--anna-muted)]">AI Verdict:</span>
              <Badge className={cn(
                "text-[10px] px-2 py-0.5 font-semibold border-0",
                aiAnalysis.recommendation === "approve"
                  ? "bg-[var(--anna-success)]/15 text-[var(--anna-success)]"
                  : aiAnalysis.recommendation === "review"
                    ? "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)]"
                    : "bg-[var(--anna-error)]/15 text-[var(--anna-error)]"
              )}>
                {aiAnalysis.recommendation === "approve" ? (
                  <><CheckCircle2 size={10} className="mr-1" /> Approve</>
                ) : aiAnalysis.recommendation === "review" ? (
                  <><Eye size={10} className="mr-1" /> Review Manually</>
                ) : (
                  <><AlertTriangle size={10} className="mr-1" /> Reject</>
                )}
              </Badge>
            </div>

            {/* Summary */}
            {aiAnalysis.summary && (
              <p className="text-xs text-[var(--anna-slate)] leading-relaxed">
                {aiAnalysis.summary}
              </p>
            )}

            {/* Changes */}
            {aiAnalysis.changes && aiAnalysis.changes !== "Unable to determine" && (
              <div>
                <p className="text-[10px] font-semibold text-[var(--anna-muted)] uppercase tracking-wider mb-1">Work Done</p>
                <p className="text-xs text-[var(--anna-slate)]">{aiAnalysis.changes}</p>
              </div>
            )}

            {/* Concerns */}
            {aiAnalysis.concerns && aiAnalysis.concerns !== "none" && aiAnalysis.concerns !== "Unable to determine" && (
              <div className="rounded-xl bg-[var(--anna-warning)]/10 border border-[var(--anna-warning)]/20 p-3">
                <p className="text-[10px] font-semibold text-[var(--anna-warning)] uppercase tracking-wider mb-1">Concerns</p>
                <p className="text-xs text-[var(--anna-slate)]">{aiAnalysis.concerns}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-[var(--anna-sage)]/20">
            <p className="text-[9px] text-[var(--anna-sage-dark)]/60 text-center">
              AI-assisted verification. Final approval is always decided by the household.
            </p>
          </div>
        </div>
      )}

      {/* Escrow */}
      {escrow && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            Escrow
          </h4>
          <div className="bg-[var(--anna-bg)] rounded-2xl p-4">
            <EscrowBadge
              state={escrow.state}
              amountCents={escrow.amountCents}
              commissionCents={escrow.commissionCents}
              vendorPayoutCents={escrow.vendorPayoutCents}
              showBreakdown
            />
          </div>
        </div>
      )}

      <Separator className="bg-[var(--anna-border)]" />

      {/* Vendor Suggestions (CREATED status only) */}
      {task.status === "CREATED" && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
            <Zap size={12} className="inline mr-1" />
            Routing Suggestions
          </h4>
          {suggestionsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-xl bg-[var(--anna-border)]" />
              <Skeleton className="h-16 w-full rounded-xl bg-[var(--anna-border)]" />
            </div>
          ) : suggestions && suggestions.length > 0 ? (
            <div className="space-y-2">
              <Button
                onClick={() => handleAction("dispatch")}
                disabled={dispatchMutation.isPending}
                className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-11 text-sm font-semibold"
              >
                <Zap size={16} className="mr-2" />
                {dispatchMutation.isPending
                  ? "Auto-Dispatching..."
                  : `Auto-Dispatch to ${suggestions[0].vendor.name}`}
                <Trophy size={14} className="ml-auto text-white/60" />
              </Button>

              <p className="text-[10px] text-[var(--anna-muted)] text-center font-data">
                Score {suggestions[0].score} — {suggestions[0].reason}
              </p>


            </div>
          ) : (
            <div className="bg-[var(--anna-bg)] rounded-xl p-4 text-center">
              <p className="text-sm text-[var(--anna-muted)]">No eligible vendors available for this category</p>
            </div>
          )}
        </div>
      )}

      <Separator className="bg-[var(--anna-border)]" />

      {/* Action Buttons */}
      {actions.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2">
          {actions
            .filter((a) => task.status !== "CREATED" || a.action !== "dispatch")
            .map((a) => {
              const Icon = a.icon;
              return (
                <Button
                  key={a.action}
                  variant={a.variant === "destructive" ? "destructive" : a.variant === "outline" ? "outline" : "default"}
                  onClick={() => handleAction(a.action)}
                  disabled={
                    dispatchMutation.isPending ||
                    updateBookingMutation.isPending ||
                    verifyMutation.isPending ||
                    escrowMutation.isPending ||
                    rebookMutation.isPending ||
                    resolveDisputeMutation.isPending ||
                    cancelPredictedMutation.isPending
                  }
                  className={
                    a.variant === "default"
                      ? "bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl"
                      : "rounded-xl"
                  }
                >
                  <Icon size={14} className="mr-2" />
                  {a.label}
                </Button>
              );
            })}
        </div>
      )}
    </div>
  );
}

export function TaskDetailPanel() {
  const { selectedTaskId, taskDetailOpen, closeTaskDetail } = useAnnaStore();
  const isMobile = useIsMobile();

  return (
    <>
      {/* Desktop: inline panel below task list */}
      {selectedTaskId && !isMobile && (
        <div className="border-t border-[var(--anna-border)] bg-[var(--anna-white)]">
          <TaskDetailContent taskId={selectedTaskId} />
        </div>
      )}

      {/* Mobile: Sheet overlay */}
      {isMobile && (
        <Sheet open={taskDetailOpen} onOpenChange={(open) => !open && closeTaskDetail()}>
          <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl anna-scroll">
            <SheetHeader className="sr-only">
              <SheetTitle>Task Detail</SheetTitle>
              <SheetDescription>View and manage this task</SheetDescription>
            </SheetHeader>
            {selectedTaskId && <TaskDetailContent taskId={selectedTaskId} />}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}