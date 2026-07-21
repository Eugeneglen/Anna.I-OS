"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Save, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";
import { CATEGORIES } from "@/lib/constants";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:
    "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  SUSPENDED: "bg-orange-50 text-orange-700 border-orange-200",
  OFFBOARDED: "bg-red-50 text-red-700 border-red-200",
};

function parseJsonField(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return [];
    }
  }
  return [];
}

function VendorDetailInner({ data }: { data: Record<string, unknown> }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useOpsUser();
  const qc = useQueryClient();
  const isAdmin = user?.role === "ADMIN";

  const [form, setForm] = useState<Record<string, unknown>>(() => ({
    name: data.name,
    email: data.email,
    phone: data.phone,
    vendorType: data.vendorType,
    categories: parseJsonField(data.categories),
    staffCount: data.staffCount,
    dailyCapacity: data.dailyCapacity,
    zones: parseJsonField(data.zones),
    status: data.status,
  }));
  const [dirty, setDirty] = useState(false);
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffContact, setNewStaffContact] = useState("");

  function updateField(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function toggleCategory(cat: string) {
    const cats = (form.categories as string[]) || [];
    updateField(
      "categories",
      cats.includes(cat) ? cats.filter((c) => c !== cat) : [...cats, cat]
    );
  }

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ops/vendors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed");
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-vendor", id] });
      toast.success("Vendor updated");
      setDirty(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleSave() {
    updateMutation.mutate({
      name: form.name,
      email: form.email,
      phone: form.phone,
      vendorType: form.vendorType,
      categories: form.categories,
      staffCount: form.staffCount,
      dailyCapacity: form.dailyCapacity,
      zones: form.zones,
      status: form.status,
    });
  }

  const staffMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ops/vendors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed");
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-vendor", id] });
      setNewStaffName("");
      setNewStaffContact("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function addStaff() {
    if (!newStaffName || !newStaffContact) return;
    staffMutation.mutate({
      staff: {
        action: "add",
        data: { name: newStaffName, contact: newStaffContact },
      },
    });
  }

  function removeStaff(staffId: string) {
    staffMutation.mutate({
      staff: { action: "remove", data: { id: staffId } },
    });
  }

  function toggleStaff(staffId: string, isActive: boolean) {
    staffMutation.mutate({
      staff: { action: "toggle", data: { id: staffId, isActive } },
    });
  }

  const staff = (data?.staff as Record<string, unknown>[]) || [];
  const zonesStr = Array.isArray(form.zones)
    ? (form.zones as string[]).join(", ")
    : "";

  return (
    <div className="space-y-4 max-w-3xl pb-20 md:pb-0 anna-fade-in">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="hover:bg-[var(--anna-sage-light)] text-[var(--anna-slate-light)]"
          onClick={() => router.push("/ops/vendors")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-[var(--anna-slate)] truncate">
              {data.name}
            </h2>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-medium shrink-0",
                STATUS_STYLES[form.status as string] || ""
              )}
            >
              {form.status as string}
            </Badge>
          </div>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            {data.email}
          </p>
        </div>
        {isAdmin && (
          <Select
            value={form.status as string}
            onValueChange={(v) => updateField("status", v)}
          >
            <SelectTrigger className="w-36 rounded-xl border-[var(--anna-border)] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="SUSPENDED">Suspended</SelectItem>
              <SelectItem value="OFFBOARDED">Offboarded</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Details Card */}
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)]">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Vendor Details
          </h3>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Name
              </Label>
              <Input
                value={(form.name as string) || ""}
                onChange={(e) => updateField("name", e.target.value)}
                className="rounded-xl border-[var(--anna-border)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Email
              </Label>
              <Input
                value={(form.email as string) || ""}
                onChange={(e) => updateField("email", e.target.value)}
                className="rounded-xl border-[var(--anna-border)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Phone
              </Label>
              <Input
                value={(form.phone as string) || ""}
                onChange={(e) => updateField("phone", e.target.value)}
                className="rounded-xl border-[var(--anna-border)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Type
              </Label>
              <Select
                value={(form.vendorType as string) || "MICRO"}
                onValueChange={(v) => updateField("vendorType", v)}
              >
                <SelectTrigger className="rounded-xl border-[var(--anna-border)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MICRO">Micro</SelectItem>
                  <SelectItem value="SME">SME</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Staff Count
              </Label>
              <Input
                type="number"
                min={1}
                value={(form.staffCount as number) || 1}
                onChange={(e) =>
                  updateField(
                    "staffCount",
                    parseInt(e.target.value) || 1
                  )
                }
                className="rounded-xl border-[var(--anna-border)] font-data"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Daily Capacity
              </Label>
              <Input
                type="number"
                min={1}
                value={(form.dailyCapacity as number) || 6}
                onChange={(e) =>
                  updateField(
                    "dailyCapacity",
                    parseInt(e.target.value) || 6
                  )
                }
                className="rounded-xl border-[var(--anna-border)] font-data"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[var(--anna-slate)]">
              Zones (comma-separated)
            </Label>
            <Input
              value={zonesStr}
              onChange={(e) =>
                updateField(
                  "zones",
                  e.target.value
                    .split(",")
                    .map((z) => z.trim())
                    .filter(Boolean)
                )
              }
              className="rounded-xl border-[var(--anna-border)]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium text-[var(--anna-slate)]">
              Service Categories
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-2 rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)]">
              {CATEGORIES.map((cat) => (
                <label
                  key={cat}
                  className="flex items-center gap-1.5 text-xs cursor-pointer px-2 py-1.5 rounded-lg hover:bg-[var(--anna-sage-light)]/50 transition-colors"
                >
                  <Checkbox
                    checked={((form.categories as string[]) || []).includes(
                      cat
                    )}
                    onCheckedChange={() => toggleCategory(cat)}
                  />
                  <span className="text-[var(--anna-slate-light)]">
                    {cat.replace(/_/g, " ")}
                  </span>
                </label>
              ))}
            </div>
          </div>
          {dirty && (
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl h-10 text-sm font-semibold"
            >
              <Save className="h-4 w-4 mr-1.5" />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </div>
      </div>

      {/* Staff Card */}
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Staff Roster
          </h3>
          <span className="font-data text-[10px] text-[var(--anna-muted)] bg-[var(--anna-sage-light)] px-1.5 py-0.5 rounded-md">
            {staff.length}
          </span>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs font-medium text-[var(--anna-slate)]">
                Name
              </Label>
              <Input
                placeholder="Staff name"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                className="rounded-xl border-[var(--anna-border)]"
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
                className="rounded-xl border-[var(--anna-border)]"
              />
            </div>
            <Button
              variant="outline"
              onClick={addStaff}
              disabled={
                !newStaffName ||
                !newStaffContact ||
                staffMutation.isPending
              }
              className="rounded-xl border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
          <Separator className="bg-[var(--anna-border)]" />
          {staff.length === 0 ? (
            <p className="text-sm text-[var(--anna-muted)] text-center py-6">
              No staff members yet
            </p>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto anna-scroll">
              {staff.map((s: Record<string, unknown>) => (
                <div
                  key={s.id as string}
                  className="flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-[var(--anna-sage-light)]/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
                      {s.name as string}
                    </p>
                    <p className="text-xs text-[var(--anna-muted)]">
                      {s.contact as string}
                    </p>
                  </div>
                  <Switch
                    checked={s.isActive as boolean}
                    onCheckedChange={(v) =>
                      toggleStaff(s.id as string, v)
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-[var(--anna-error)] hover:bg-red-50"
                    onClick={() => removeStaff(s.id as string)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Verification Data Card */}
      {data.verificationData && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--anna-border)]">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Verification Data
            </h3>
          </div>
          <div className="p-5">
            <pre className="text-xs bg-[var(--anna-bg)] rounded-xl p-4 overflow-x-auto max-h-48 overflow-y-auto anna-scroll text-[var(--anna-slate-light)] font-mono leading-relaxed">
              {JSON.stringify(data.verificationData, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["ops-vendor", id],
    queryFn: async () => {
      const res = await fetch(`/api/ops/vendors/${id}`);
      if (!res.ok) throw new Error("Not found");
      const result = await res.json();
      return result.vendor;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48 rounded-xl bg-[var(--anna-border)]" />
        <Skeleton className="h-60 w-full rounded-2xl bg-[var(--anna-border)]" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-[var(--anna-muted)]">Vendor not found.</p>
    );
  }

  return <VendorDetailInner key={id} data={data} />;
}