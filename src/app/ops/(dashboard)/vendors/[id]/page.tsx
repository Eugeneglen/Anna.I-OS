"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Save, Plus, Trash2 } from "lucide-react";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";
import { CATEGORIES } from "@/lib/constants";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  SUSPENDED: "bg-orange-100 text-orange-700",
  OFFBOARDED: "bg-red-100 text-red-700",
};

function parseJsonField(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return []; }
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
      staff: { action: "add", data: { name: newStaffName, contact: newStaffContact } },
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
  const zonesStr = Array.isArray(form.zones) ? (form.zones as string[]).join(", ") : "";

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/ops/vendors")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{data.name}</h2>
          <p className="text-sm text-muted-foreground">{data.email}</p>
        </div>
        {isAdmin && (
          <Select value={form.status as string} onValueChange={(v) => updateField("status", v)}>
            <SelectTrigger className="w-36">
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Vendor Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={(form.name as string) || ""} onChange={(e) => updateField("name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input value={(form.email as string) || ""} onChange={(e) => updateField("email", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input value={(form.phone as string) || ""} onChange={(e) => updateField("phone", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={(form.vendorType as string) || "MICRO"} onValueChange={(v) => updateField("vendorType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MICRO">Micro</SelectItem>
                  <SelectItem value="SME">SME</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Staff Count</Label>
              <Input type="number" min={1} value={(form.staffCount as number) || 1} onChange={(e) => updateField("staffCount", parseInt(e.target.value) || 1)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Daily Capacity</Label>
              <Input type="number" min={1} value={(form.dailyCapacity as number) || 6} onChange={(e) => updateField("dailyCapacity", parseInt(e.target.value) || 6)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Zones (comma-separated)</Label>
            <Input value={zonesStr} onChange={(e) => updateField("zones", e.target.value.split(",").map((z) => z.trim()).filter(Boolean))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Service Categories</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {CATEGORIES.map((cat) => (
                <label key={cat} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox
                    checked={((form.categories as string[]) || []).includes(cat)}
                    onCheckedChange={() => toggleCategory(cat)}
                  />
                  {cat.replace(/_/g, " ")}
                </label>
              ))}
            </div>
          </div>
          {dirty && (
            <Button onClick={handleSave} disabled={updateMutation.isPending} style={{ backgroundColor: "#10b981" }} className="text-white">
              <Save className="h-4 w-4 mr-1" />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Staff Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Staff Roster ({staff.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Name</Label>
              <Input placeholder="Staff name" value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)} />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Contact</Label>
              <Input placeholder="Phone or email" value={newStaffContact} onChange={(e) => setNewStaffContact(e.target.value)} />
            </div>
            <Button variant="outline" onClick={addStaff} disabled={!newStaffName || !newStaffContact || staffMutation.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          <Separator />
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No staff members</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {staff.map((s: Record<string, unknown>) => (
                <div key={s.id as string} className="flex items-center gap-3 py-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.name as string}</p>
                    <p className="text-xs text-muted-foreground">{s.contact as string}</p>
                  </div>
                  <Switch checked={s.isActive as boolean} onCheckedChange={(v) => toggleStaff(s.id as string, v)} />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeStaff(s.id as string)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Verification Data Card */}
      {data.verificationData && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Verification Data</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-gray-50 rounded p-3 overflow-x-auto max-h-48 overflow-y-auto">
              {JSON.stringify(data.verificationData, null, 2)}
            </pre>
          </CardContent>
        </Card>
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
    return <div className="space-y-3"><Skeleton className="h-10 w-48" /><Skeleton className="h-60 w-full" /></div>;
  }

  if (!data) {
    return <p className="text-muted-foreground">Vendor not found.</p>;
  }

  // Key on id to reset inner component state when vendor changes
  return <VendorDetailInner key={id} data={data} />;
}