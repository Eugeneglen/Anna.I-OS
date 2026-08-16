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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Save } from "lucide-react";
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

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  HDB: "HDB",
  CONDOMINIUM: "Condo",
  LANDED: "Landed",
  OFFICE: "Office",
  OTHER: "Other",
};

interface Address {
  id: string;
  label: string | null;
  propertyType: string;
  fullAddress: string;
  isDefault: boolean;
  postalCode: string;
  blockNumber: string | null;
  streetName: string | null;
  buildingName: string | null;
  level: string | null;
  unitNumber: string | null;
}

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

const inputCls = "rounded-xl border-[var(--anna-border)] text-sm";
const labelCls = "text-xs font-medium text-[var(--anna-slate)]";

function VendorDetailInner({ data }: { data: Record<string, unknown> }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useOpsUser();
  const qc = useQueryClient();
  const isAdmin = user?.role === "ADMIN";

  const [form, setForm] = useState<Record<string, unknown>>(() => ({
    companyName: data.companyName || "",
    companyRegNo: data.companyRegNo || "",
    registeredAddress: data.registeredAddress || "",
    contactPerson: data.contactPerson || "",
    contactEmail1: data.contactEmail1 || "",
    contactPhone1: data.contactPhone1 || "",
    contactPerson2: data.contactPerson2 || "",
    contactEmail2: data.contactEmail2 || "",
    contactPhone2: data.contactPhone2 || "",
    vendorType: data.vendorType,
    staffCount: data.staffCount,
    dailyCapacity: data.dailyCapacity,
    categories: parseJsonField(data.categories),
    zones: parseJsonField(data.zones),
    status: data.status,
  }));
  const [dirty, setDirty] = useState(false);

  const addresses: Address[] = Array.isArray(data.addresses)
    ? (data.addresses as Address[])
    : [];

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
      contactPerson: form.contactPerson || null,
      contactEmail1: form.contactEmail1 || null,
      contactPhone1: form.contactPhone1 || null,
      contactPerson2: form.contactPerson2 || null,
      contactEmail2: form.contactEmail2 || null,
      contactPhone2: form.contactPhone2 || null,
      companyName: form.companyName || null,
      companyRegNo: form.companyRegNo || null,
      registeredAddress: form.registeredAddress || null,
      vendorType: form.vendorType,
      categories: form.categories,
      staffCount: form.staffCount,
      dailyCapacity: form.dailyCapacity,
      zones: form.zones,
      status: form.status,
    });
  }

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
              {data.companyName || data.name}
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

      {/* ── Section A: Company Information ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)]">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Company Information
          </h3>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label className={labelCls}>
              Company Name <span className="text-[var(--anna-error)]">*</span>
            </Label>
            <Input
              placeholder="e.g. FreshWash Pte Ltd"
              value={(form.companyName as string) || ""}
              onChange={(e) => updateField("companyName", e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <Label className={labelCls}>Company Reg No.</Label>
            <Input
              placeholder="e.g. 2024XXXXXX"
              value={(form.companyRegNo as string) || ""}
              onChange={(e) => updateField("companyRegNo", e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className={labelCls}>Type</Label>
              <Select
                value={(form.vendorType as string) || "MICRO"}
                onValueChange={(v) => updateField("vendorType", v)}
              >
                <SelectTrigger className={inputCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MICRO">Micro</SelectItem>
                  <SelectItem value="SME">SME</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className={labelCls}>Staff Count</Label>
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
                className={cn(inputCls, "font-data")}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className={labelCls}>Daily Capacity</Label>
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
              className={cn(inputCls, "font-data")}
            />
          </div>
          <div className="space-y-2">
            <Label className={labelCls}>Service Categories</Label>
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
          <div className="space-y-1.5">
            <Label className={labelCls}>Zones (comma-separated)</Label>
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
              className={inputCls}
            />
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

      {/* ── Section B: Contact Person 1 ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)]">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Contact Persons
          </h3>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-3 rounded-xl border border-[var(--anna-border)] p-3 bg-[var(--anna-bg)]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)]">
              Contact Person 1
            </p>
            <div className="space-y-1.5">
              <Label className={labelCls}>Name</Label>
              <Input
                placeholder="e.g. John Lim"
                value={(form.contactPerson as string) || ""}
                onChange={(e) => updateField("contactPerson", e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className={labelCls}>Email</Label>
                <Input
                  type="email"
                  placeholder="john@example.com"
                  value={(form.contactEmail1 as string) || ""}
                  onChange={(e) =>
                    updateField("contactEmail1", e.target.value)
                  }
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>Phone</Label>
                <Input
                  placeholder="+65 8XXX XXXX"
                  value={(form.contactPhone1 as string) || ""}
                  onChange={(e) =>
                    updateField("contactPhone1", e.target.value)
                  }
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* ── Section C: Contact Person 2 (Optional) ── */}
          <div className="space-y-3 rounded-xl border border-dashed border-[var(--anna-border)] p-3 bg-[var(--anna-bg)]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Contact Person 2 (Optional)
            </p>
            <div className="space-y-1.5">
              <Label className={labelCls}>Name</Label>
              <Input
                placeholder="e.g. Sarah Tan"
                value={(form.contactPerson2 as string) || ""}
                onChange={(e) =>
                  updateField("contactPerson2", e.target.value)
                }
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className={labelCls}>Email</Label>
                <Input
                  type="email"
                  placeholder="sarah@example.com"
                  value={(form.contactEmail2 as string) || ""}
                  onChange={(e) =>
                    updateField("contactEmail2", e.target.value)
                  }
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>Phone</Label>
                <Input
                  placeholder="+65 9XXX XXXX"
                  value={(form.contactPhone2 as string) || ""}
                  onChange={(e) =>
                    updateField("contactPhone2", e.target.value)
                  }
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Registered Address ── */}
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)]">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Registered Address
          </h3>
        </div>
        <div className="p-5">
          <div className="space-y-1.5">
            <Label className={labelCls}>Registered Address</Label>
            <Input
              placeholder="e.g. 123 Orchard Road, #10-01, Singapore 238888"
              value={(form.registeredAddress as string) || ""}
              onChange={(e) =>
                updateField("registeredAddress", e.target.value)
              }
              className={inputCls}
            />
          </div>
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