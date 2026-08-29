"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Users, Plus, Trash2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface StaffMember {
  id: string;
  name: string;
  contact: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

const inputCls = "rounded-xl border-[var(--anna-border)] text-sm";

function StaffRosterSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48 rounded-xl bg-[var(--anna-border)]" />
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="p-5 space-y-4">
          <div className="flex items-end gap-2">
            <Skeleton className="h-9 flex-1 rounded-xl bg-[var(--anna-border)]" />
            <Skeleton className="h-9 flex-1 rounded-xl bg-[var(--anna-border)]" />
            <Skeleton className="h-9 w-20 rounded-xl bg-[var(--anna-border)]" />
          </div>
          <Separator />
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="h-4 w-24 rounded bg-[var(--anna-border)]" />
              <div className="flex-1" />
              <Skeleton className="h-5 w-9 rounded-full bg-[var(--anna-border)]" />
              <Skeleton className="h-7 w-7 rounded bg-[var(--anna-border)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function StaffRosterPage() {
  const queryClient = useQueryClient();

  // ── Fetch staff ──
  const { data, isLoading } = useQuery<{ staff: StaffMember[] }>({
    queryKey: ["vendor-staff"],
    queryFn: async () => {
      const res = await fetch("/api/vendor/staff");
      if (!res.ok) throw new Error("Failed to fetch staff");
      return res.json();
    },
  });

  const staff = data?.staff || [];

  // ── Form state ──
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffContact, setNewStaffContact] = useState("");

  // ── Add staff mutation ──
  const addMutation = useMutation({
    mutationFn: async (body: { name: string; contact: string }) => {
      const res = await fetch("/api/vendor/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || "Failed to add staff");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-staff"] });
      setNewStaffName("");
      setNewStaffContact("");
      toast.success("Staff member added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Toggle staff mutation ──
  const toggleMutation = useMutation({
    mutationFn: async (body: { id: string; isActive: boolean }) => {
      const res = await fetch("/api/vendor/staff", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-staff"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Remove staff mutation ──
  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/vendor/staff", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || "Failed to remove");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-staff"] });
      toast.success("Staff member removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleAdd() {
    if (!newStaffName.trim() || !newStaffContact.trim()) return;
    addMutation.mutate({
      name: newStaffName.trim(),
      contact: newStaffContact.trim(),
    });
  }

  if (isLoading) return <StaffRosterSkeleton />;

  return (
    <div className="pb-20 md:pb-0">
      {/* Page Header */}
      <div className="mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center">
            <Users className="h-5 w-5 text-[var(--anna-sage-dark)]" />
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
              Staff Roster
            </h1>
            <p className="text-sm text-[var(--anna-muted)] mt-0.5">
              Manage your team members and their availability
            </p>
          </div>
        </div>
      </div>

      {/* Staff Card */}
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Team Members
            </h3>
            <span className="font-data text-[10px] text-[var(--anna-muted)] bg-[var(--anna-sage-light)] px-1.5 py-0.5 rounded-md">
              {staff.length}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-[var(--anna-muted)]">
            <Info size={11} />
            <span>{staff.filter((s) => s.isActive).length} active</span>
          </div>
        </div>
        <div className="p-5 space-y-4">
          {/* Add new staff form */}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Name
              </Label>
              <Input
                placeholder="Staff name"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                className={inputCls}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Contact
              </Label>
              <Input
                placeholder="Phone or email"
                value={newStaffContact}
                onChange={(e) => setNewStaffContact(e.target.value)}
                className={inputCls}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
              />
            </div>
            <Button
              variant="outline"
              onClick={handleAdd}
              disabled={
                !newStaffName.trim() ||
                !newStaffContact.trim() ||
                addMutation.isPending
              }
              className="rounded-xl border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>

          <Separator className="bg-[var(--anna-border)]" />

          {/* Staff list */}
          {staff.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-[var(--anna-bg)] flex items-center justify-center mx-auto mb-3">
                <Users className="h-6 w-6 text-[var(--anna-muted)]" />
              </div>
              <p className="text-sm text-[var(--anna-muted)]">
                No staff members yet
              </p>
              <p className="text-xs text-[var(--anna-muted)] mt-1">
                Add your team members above to get started
              </p>
            </div>
          ) : (
            <div className="space-y-1 max-h-[60vh] overflow-y-auto anna-scroll">
              {staff.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors",
                    s.isActive
                      ? "hover:bg-[var(--anna-sage-light)]/30"
                      : "opacity-50 hover:bg-[var(--anna-bg)]"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
                      {s.name}
                    </p>
                    <p className="text-xs text-[var(--anna-muted)]">
                      {s.contact}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] px-1.5 py-0 font-medium shrink-0",
                      s.isActive
                        ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20"
                        : "bg-gray-100 text-gray-500 border-gray-200"
                    )}
                  >
                    {s.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <Switch
                    checked={s.isActive}
                    onCheckedChange={(v) =>
                      toggleMutation.mutate({ id: s.id, isActive: v })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-[var(--anna-error)] hover:bg-red-50"
                    onClick={() => removeMutation.mutate(s.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Info footer */}
      <div className="mt-3 flex items-start gap-2 px-1">
        <Info size={13} className="text-[var(--anna-muted)] shrink-0 mt-0.5" />
        <p className="text-[10px] text-[var(--anna-muted)] leading-relaxed">
          Staff members can be assigned to tasks by ops coordinators. Toggle
          availability to control who receives task assignments.
        </p>
      </div>
    </div>
  );
}
