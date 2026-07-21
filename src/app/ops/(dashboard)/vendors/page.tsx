"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, ChevronRight, Building2, Users } from "lucide-react";
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

function formatCategories(catsJson: string) {
  try {
    const cats: string[] = JSON.parse(catsJson);
    return cats.slice(0, 3).map((c) => (
      <span
        key={c}
        className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
      >
        {c.replace(/_/g, " ")}
      </span>
    ));
  } catch {
    return null;
  }
}

export default function VendorsPage() {
  const user = useOpsUser();
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["ops-vendors", search],
    queryFn: async () => {
      const params = search
        ? `?search=${encodeURIComponent(search)}`
        : "";
      const res = await fetch(`/api/ops/vendors${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const vendors = data?.vendors || [];

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ops/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-vendors"] });
      setDialogOpen(false);
      toast.success("Vendor created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isAdmin = user?.role === "ADMIN";

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Vendors
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            <span className="font-data">{vendors.length}</span> vendors
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]"
            />
            <Input
              placeholder="Search name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-64 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
            />
          </div>
          {isAdmin && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add Vendor
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border-[var(--anna-border)] bg-[var(--anna-white)]">
                <DialogHeader>
                  <DialogTitle className="text-[var(--anna-slate)]">
                    Add Vendor
                  </DialogTitle>
                </DialogHeader>
                <AddVendorForm
                  onSubmit={(data) => createMutation.mutate(data)}
                  loading={createMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-20 w-full rounded-2xl bg-[var(--anna-border)]"
            />
          ))}
        </div>
      ) : vendors.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-4">
            <Building2
              size={24}
              className="text-[var(--anna-sage-dark)]"
            />
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)]">
            No vendors found
          </p>
          <p className="text-xs text-[var(--anna-muted)] mt-1">
            {search
              ? "Try a different search term"
              : "Add your first vendor to get started"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Email
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Categories
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Staff
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v: Record<string, unknown>) => (
                  <tr
                    key={v.id as string}
                    onClick={() => router.push(`/ops/vendors/${v.id}`)}
                    className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[var(--anna-slate)]">
                          {v.name as string}
                        </span>
                        <ChevronRight
                          size={14}
                          className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--anna-muted)] text-xs">
                      {v.email as string}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className="text-[10px] font-data border-[var(--anna-border)] text-[var(--anna-slate-light)]"
                      >
                        {v.vendorType as string}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 flex gap-1 flex-wrap">
                      {formatCategories(v.categories as string)}
                    </td>
                    <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate-light)]">
                      {(v._count as Record<string, number>)?.staff ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-medium",
                          STATUS_STYLES[v.status as string] || ""
                        )}
                      >
                        {v.status as string}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {vendors.map((v: Record<string, unknown>) => (
              <div
                key={v.id as string}
                onClick={() => router.push(`/ops/vendors/${v.id}`)}
                className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-[var(--anna-slate)]">
                        {v.name as string}
                      </p>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-medium shrink-0",
                          STATUS_STYLES[v.status as string] || ""
                        )}
                      >
                        {v.status as string}
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--anna-muted)] mt-0.5">
                      {v.email as string}
                    </p>
                  </div>
                  <ChevronRight
                    size={16}
                    className="text-[var(--anna-muted)] shrink-0 mt-0.5"
                  />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className="text-[10px] font-data border-[var(--anna-border)] text-[var(--anna-slate-light)]"
                  >
                    {v.vendorType as string}
                  </Badge>
                  <span className="flex items-center gap-1 text-[10px] text-[var(--anna-muted)]">
                    <Users size={10} />
                    {(v._count as Record<string, number>)?.staff ?? 0} staff
                  </span>
                </div>
                {formatCategories(v.categories as string) && (
                  <div className="mt-2 flex gap-1 flex-wrap">
                    {formatCategories(v.categories as string)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Add Vendor Form ──────────────────────────────────────── */

function AddVendorForm({
  onSubmit,
  loading,
}: {
  onSubmit: (data: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    vendorType: "MICRO",
    categories: [] as string[],
    staffCount: 1,
    dailyCapacity: 6,
    zones: "",
  });

  function toggleCategory(cat: string) {
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(cat)
        ? f.categories.filter((c) => c !== cat)
        : [...f.categories, cat],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      ...form,
      zones: form.zones
        .split(",")
        .map((z) => z.trim())
        .filter(Boolean),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs font-medium text-[var(--anna-slate)]">
          Name
        </Label>
        <Input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          className="rounded-xl border-[var(--anna-border)]"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium text-[var(--anna-slate)]">
          Email
        </Label>
        <Input
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          required
          className="rounded-xl border-[var(--anna-border)]"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium text-[var(--anna-slate)]">
          Phone
        </Label>
        <Input
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          required
          className="rounded-xl border-[var(--anna-border)]"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs font-medium text-[var(--anna-slate)]">
            Type
          </Label>
          <Select
            value={form.vendorType}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, vendorType: v }))
            }
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
        <div className="space-y-2">
          <Label className="text-xs font-medium text-[var(--anna-slate)]">
            Staff Count
          </Label>
          <Input
            type="number"
            min={1}
            value={form.staffCount}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                staffCount: parseInt(e.target.value) || 1,
              }))
            }
            className="rounded-xl border-[var(--anna-border)]"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium text-[var(--anna-slate)]">
          Daily Capacity
        </Label>
        <Input
          type="number"
          min={1}
          value={form.dailyCapacity}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              dailyCapacity: parseInt(e.target.value) || 6,
            }))
          }
          className="rounded-xl border-[var(--anna-border)]"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium text-[var(--anna-slate)]">
          Categories
        </Label>
        <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto anna-scroll p-1 rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)]">
          {CATEGORIES.map((cat) => (
            <label
              key={cat}
              className="flex items-center gap-1.5 text-xs cursor-pointer px-2 py-1.5 rounded-lg hover:bg-[var(--anna-sage-light)]/50 transition-colors"
            >
              <Checkbox
                checked={form.categories.includes(cat)}
                onCheckedChange={() => toggleCategory(cat)}
              />
              <span className="text-[var(--anna-slate-light)]">
                {cat.replace(/_/g, " ")}
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium text-[var(--anna-slate)]">
          Zones (comma-separated)
        </Label>
        <Input
          placeholder="e.g. East, North-East"
          value={form.zones}
          onChange={(e) =>
            setForm((f) => ({ ...f, zones: e.target.value }))
          }
          className="rounded-xl border-[var(--anna-border)]"
        />
      </div>
      <Button
        type="submit"
        className="w-full bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl h-10 text-sm font-semibold"
        disabled={loading}
      >
        {loading ? "Creating..." : "Create Vendor"}
      </Button>
    </form>
  );
}