"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  formatSgd,
  type Household,
  type FamilyMember,
  type Subscription,
} from "@/lib/types";
import { useTheme } from "next-themes";
import {
  Mail,
  MapPin,
  Phone,
  Crown,
  Users,
  Pencil,
  Plus,
  Trash2,
  Check,
  X,
  Camera,
  Moon,
  ArrowUpCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

// ─────────────────────────────────────────────────────────────
// Data fetching
// ─────────────────────────────────────────────────────────────

async function fetchHouseholdDetail(id: string) {
  const res = await fetch(`/api/households/${id}`);
  if (!res.ok) throw new Error("Failed to fetch household");
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// Member avatar with upload
// ─────────────────────────────────────────────────────────────

function MemberAvatar({
  member,
  onUploaded,
}: {
  member: FamilyMember;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("memberId", member.id);

      const res = await fetch("/api/upload-avatar", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      toast.success("Photo updated");
      onUploaded();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      // Reset so same file can be re-selected
      e.target.value = "";
    }
  };

  const initials = member.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  return (
    <div className="relative group/avatar flex-shrink-0">
      {member.avatarUrl ? (
        <img
          src={member.avatarUrl}
          alt={member.name}
          className="w-10 h-10 rounded-full object-cover"
        />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[var(--anna-sage-light)] flex items-center justify-center text-sm font-semibold text-[var(--anna-sage-dark)]">
          {initials}
        </div>
      )}
      {/* Camera overlay on hover */}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity disabled:opacity-0"
        aria-label="Change photo"
      >
        {uploading ? (
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <Camera size={14} className="text-white" />
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Editable field row
// ─────────────────────────────────────────────────────────────

function EditableField({
  label,
  value,
  icon: Icon,
  fieldKey,
  householdId,
  isMutating,
  mutate,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  fieldKey: string;
  householdId: string;
  isMutating: boolean;
  mutate: ReturnType<typeof useMutation>["mutate"];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = useCallback(() => {
    if (!draft.trim() || draft === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    mutate(
      { [fieldKey]: draft },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(`${label} updated`);
        },
        onError: () => {
          setDraft(value);
          setEditing(false);
          toast.error(`Failed to update ${label.toLowerCase()}`);
        },
      }
    );
  }, [draft, value, fieldKey, label, mutate]);

  const handleCancel = useCallback(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  return (
    <div className="flex items-center gap-3">
      <Icon size={14} className="text-[var(--anna-muted)] flex-shrink-0" />
      {editing ? (
        <div className="flex items-center gap-2 flex-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            className="h-8 text-sm border-[var(--anna-border)] bg-[var(--anna-bg)] rounded-lg px-2.5"
            autoFocus
            disabled={isMutating}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-[var(--anna-success)] hover:bg-[var(--anna-success)]/10 flex-shrink-0"
            onClick={handleSave}
            disabled={isMutating}
          >
            <Check size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-[var(--anna-muted)] hover:bg-[var(--anna-bg)] flex-shrink-0"
            onClick={handleCancel}
            disabled={isMutating}
          >
            <X size={14} />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm text-[var(--anna-slate-light)] truncate">
            {value || "—"}
          </span>
          <button
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            className="p-1 rounded-md hover:bg-[var(--anna-sage-light)] text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label={`Edit ${label}`}
          >
            <Pencil size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Switch
      checked={isDark}
      onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
      aria-label="Toggle night mode"
    />
  );
}

export function SettingsPanel() {
  const { selectedHouseholdId, setHouseholdNames, householdNames } =
    useAnnaStore();
  const queryClient = useQueryClient();

  // ── Queries ──

  const { data, isLoading } = useQuery({
    queryKey: ["household", selectedHouseholdId],
    queryFn: () => fetchHouseholdDetail(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  // ── Mutations ──

  const updateHousehold = useMutation({
    mutationFn: async (patch: Record<string, string>) => {
      const res = await fetch(`/api/households/${selectedHouseholdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Update failed");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
      queryClient.invalidateQueries({ queryKey: ["households"] });
      if (variables.name) {
        setHouseholdNames({
          ...householdNames,
          [selectedHouseholdId]: variables.name,
        });
      }
    },
  });

  const addMember = useMutation({
    mutationFn: async (body: {
      name: string;
      email: string;
      phone?: string;
    }) => {
      const res = await fetch(`/api/households/${selectedHouseholdId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add member");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
      toast.success("Member added");
      setAddDialogOpen(false);
      setNewMember({ name: "", email: "", phone: "" });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMember = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await fetch(
        `/api/households/${selectedHouseholdId}/members/${memberId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to remove member");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
      toast.success("Member removed");
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err.message),
  });

  // ── State ──

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newMember, setNewMember] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [deleteTarget, setDeleteTarget] = useState<FamilyMember | null>(null);
  const [cancelSubDialog, setCancelSubDialog] = useState(false);

  // ── Subscription mutation (cancel) ──
  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!sub) throw new Error("No subscription");
      // Household-initiated cancellation sends a request to ops
      const res = await fetch(`/api/households/${householdId}/subscription`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_cancel" }),
      });
      if (!res.ok) throw new Error("Failed to request cancellation");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Cancellation request submitted. Ops will process it shortly.");
      setCancelSubDialog(false);
      queryClient.invalidateQueries({ queryKey: ["household-detail", householdId] });
    },
    onError: () => {
      toast.error("Failed to submit cancellation request");
    },
  });

  // ── Derived ──

  const household: Household | undefined = data?.household;
  const members: FamilyMember[] = data?.members || [];
  const subscriptions: Subscription[] = data?.subscriptions || [];
  const sub = subscriptions[0];

  // ── Render ──

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-8 w-48 rounded-xl bg-[var(--anna-border)]" />
        <Skeleton className="h-56 w-full rounded-2xl bg-[var(--anna-border)]" />
        <Skeleton className="h-40 w-full rounded-2xl bg-[var(--anna-border)]" />
        <Skeleton className="h-48 w-full rounded-2xl bg-[var(--anna-border)]" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 pb-20 md:pb-0 anna-fade-in">
      <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)] mb-1">
        Settings
      </h1>
      <p className="text-sm text-[var(--anna-muted)] mb-6">
        Household configuration and subscription
      </p>

      {/* ── Household Info ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] mb-4 group">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-4">
          Household
        </h3>
        <div className="space-y-3.5">
          {/* Name (uses a dedicated inline row, not EditableField) */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-[var(--anna-sage-dark)]">
                {household?.name?.charAt(0) || "?"}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div>
                <p className="text-sm font-semibold text-[var(--anna-slate)]">
                  {household?.name}
                </p>
                <p className="text-xs text-[var(--anna-muted)]">Owner</p>
              </div>
            </div>
          </div>

          <EditableField
            label="Email"
            value={household?.email || ""}
            icon={Mail}
            fieldKey="email"
            householdId={selectedHouseholdId}
            isMutating={updateHousehold.isPending}
            mutate={updateHousehold.mutate}
          />

          <EditableField
            label="Phone"
            value={household?.phone || ""}
            icon={Phone}
            fieldKey="phone"
            householdId={selectedHouseholdId}
            isMutating={updateHousehold.isPending}
            mutate={updateHousehold.mutate}
          />

          <EditableField
            label="Address"
            value={household?.address || ""}
            icon={MapPin}
            fieldKey="address"
            householdId={selectedHouseholdId}
            isMutating={updateHousehold.isPending}
            mutate={updateHousehold.mutate}
          />

          <div className="flex items-center gap-3">
            <MapPin size={14} className="text-[var(--anna-muted)] flex-shrink-0" />
            <span className="text-sm text-[var(--anna-slate-light)]">
              {household?.unitNumber || "—"} &middot;{" "}
              {household?.postalCode || "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Appearance ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
          Appearance
        </h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--anna-bg)] flex items-center justify-center">
              <Moon size={16} className="text-[var(--anna-slate-light)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--anna-slate)]">Night mode</p>
              <p className="text-xs text-[var(--anna-muted)]">Switch to dark theme</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {/* ── Subscription ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
          Subscription
        </h3>
        {sub ? (
          <div className="space-y-3">
            {/* Status and tier */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown size={16} className="text-[var(--anna-warning)]" />
                <span className="text-sm font-semibold text-[var(--anna-slate)]">
                  {sub.tier === "HOME" ? "Home" : "Care"} Tier
                </span>
              </div>
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${
                  sub.status === "ACTIVE"
                    ? "bg-[var(--anna-success)]/15 text-[var(--anna-success)]"
                    : sub.status === "PAST_DUE"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-[var(--anna-error)]/15 text-[var(--anna-error)]"
                }`}
              >
                {sub.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--anna-muted)]">Price</span>
              <span className="font-data font-semibold text-[var(--anna-slate)]">
                {formatSgd(sub.priceCents)}
                <span className="text-[var(--anna-muted)] font-sans font-normal">
                  /mo
                </span>
              </span>
            </div>
            {sub.nextBillingDate && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--anna-muted)]">Next billing</span>
                <span className="font-data text-[var(--anna-slate-light)]">
                  {new Date(sub.nextBillingDate).toLocaleDateString("en-SG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            )}

            {/* Upgrade prompt for HOME tier */}
            {sub.tier === "HOME" && sub.status === "ACTIVE" && (
              <div className="bg-gradient-to-r from-purple-50 to-[var(--anna-sage-light)] rounded-xl p-3 mt-2">
                <div className="flex items-start gap-2">
                  <ArrowUpCircle size={18} className="text-purple-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-purple-700">Upgrade to Anna.I Care</p>
                    <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                      Premium eldercare companion bundles, priority support, and dedicated coordinator access.
                    </p>
                    <p className="text-xs font-data font-semibold text-purple-700 mt-1">
                      SGD $68/mo
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-[var(--anna-muted)] mt-2 flex items-center gap-1">
                  <Info size={10} />
                  Contact Ops to upgrade your plan
                </p>
              </div>
            )}

            {/* CARE tier badge */}
            {sub.tier === "CARE" && sub.status === "ACTIVE" && (
              <div className="bg-purple-50 rounded-xl p-3 mt-2">
                <div className="flex items-center gap-2">
                  <Crown size={16} className="text-purple-600" />
                  <div>
                    <p className="text-xs font-semibold text-purple-700">Care Tier Active</p>
                    <p className="text-[10px] text-[var(--anna-muted)]">
                      Eldercare companion bundles + priority support
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* CANCELLED / PAST_DUE states */}
            {sub.status === "CANCELLED" && (
              <div className="bg-red-50 rounded-xl p-3 mt-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-red-500" />
                  <div>
                    <p className="text-xs font-semibold text-red-700">Subscription Cancelled</p>
                    <p className="text-[10px] text-[var(--anna-muted)]">
                      Your subscription has been cancelled. Contact Ops to reactivate.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {sub.status === "PAST_DUE" && (
              <div className="bg-amber-50 rounded-xl p-3 mt-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-600" />
                  <div>
                    <p className="text-xs font-semibold text-amber-700">Payment Overdue</p>
                    <p className="text-[10px] text-[var(--anna-muted)]">
                      Please update your payment method to continue using Anna.I services.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Cancel button for ACTIVE */}
            {sub.status === "ACTIVE" && (
              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs rounded-lg border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                  onClick={() => setCancelSubDialog(true)}
                >
                  Cancel Subscription
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--anna-muted)]">
            No subscription found
          </p>
        )}
      </div>

      {/* Cancel Subscription Confirmation */}
      <AlertDialog open={cancelSubDialog} onOpenChange={setCancelSubDialog}>
        <AlertDialogContent className="rounded-2xl border-[var(--anna-border)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--anna-slate)] flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-500" />
              Cancel Subscription
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--anna-muted)]">
              Are you sure you want to cancel your Anna.I {sub?.tier === "HOME" ? "Home" : "Care"} subscription?
              Your service will remain active until the end of the current billing period. You can reactivate at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Keep Subscription</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="rounded-xl bg-red-600 hover:bg-red-700"
            >
              {cancelMutation.isPending ? "Submitting..." : "Yes, Cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Members ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
            <Users size={14} />
            Members ({members.length})
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-[var(--anna-border)] text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)] hover:border-[var(--anna-sage)]"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus size={12} className="mr-1" />
            Add
          </Button>
        </div>
        <div className="space-y-1">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between py-2 group/row"
            >
              <div className="flex items-center gap-3 min-w-0">
                <MemberAvatar
                  member={member}
                  onUploaded={() =>
                    queryClient.invalidateQueries({
                      queryKey: ["household", selectedHouseholdId],
                    })
                  }
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
                    {member.name}
                  </p>
                  <p className="text-[11px] text-[var(--anna-muted)] truncate">
                    {member.email}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${
                    member.role === "OWNER"
                      ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                      : "bg-[var(--anna-bg)] text-[var(--anna-muted)]"
                  }`}
                >
                  {member.role}
                </span>
                {member.role !== "OWNER" && (
                  <button
                    onClick={() => setDeleteTarget(member)}
                    className="p-1.5 rounded-md text-[var(--anna-muted)] hover:text-[var(--anna-error)] hover:bg-[var(--anna-error)]/10 transition-colors opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                    aria-label={`Remove ${member.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Add Member Dialog ── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>
              Add a new member to your household.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="member-name" className="text-xs">
                Name <span className="text-[var(--anna-error)]">*</span>
              </Label>
              <Input
                id="member-name"
                value={newMember.name}
                onChange={(e) =>
                  setNewMember((m) => ({ ...m, name: e.target.value }))
                }
                placeholder="Full name"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-email" className="text-xs">
                Email <span className="text-[var(--anna-error)]">*</span>
              </Label>
              <Input
                id="member-email"
                type="email"
                value={newMember.email}
                onChange={(e) =>
                  setNewMember((m) => ({ ...m, email: e.target.value }))
                }
                placeholder="email@example.com"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-phone" className="text-xs">
                Phone
              </Label>
              <Input
                id="member-phone"
                value={newMember.phone}
                onChange={(e) =>
                  setNewMember((m) => ({ ...m, phone: e.target.value }))
                }
                placeholder="+65 9XXX XXXX"
                className="h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-[var(--anna-border)]"
              onClick={() => setAddDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => addMember.mutate(newMember)}
              disabled={
                !newMember.name.trim() ||
                !newMember.email.trim() ||
                addMember.isPending
              }
              className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white"
            >
              {addMember.isPending ? "Adding..." : "Add Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Member Confirmation ── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {deleteTarget?.name} from the household. They
              won't have access to household tasks or data anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[var(--anna-border)]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMember.mutate(deleteTarget.id)}
              disabled={deleteMember.isPending}
              className="bg-[var(--anna-error)] hover:bg-[var(--anna-error)]/90 text-white"
            >
              {deleteMember.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}