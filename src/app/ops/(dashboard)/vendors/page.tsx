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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search } from "lucide-react";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";
import { CATEGORIES } from "@/lib/constants";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  SUSPENDED: "bg-orange-100 text-orange-700",
  OFFBOARDED: "bg-red-100 text-red-700",
};

function formatCategories(catsJson: string) {
  try {
    const cats: string[] = JSON.parse(catsJson);
    return cats.slice(0, 3).map((c) => (
      <Badge key={c} variant="secondary" className="text-[10px] px-1.5 py-0">
        {c.replace(/_/g, " ")}
      </Badge>
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
      const params = search ? `?search=${encodeURIComponent(search)}` : "";
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Vendors</h2>
          <p className="text-sm text-muted-foreground">{vendors.length} vendors</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-64"
            />
          </div>
          {isAdmin && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button style={{ backgroundColor: "#10b981" }} className="text-white">
                  <Plus className="h-4 w-4 mr-1" /> Add Vendor
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add Vendor</DialogTitle>
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
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : vendors.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">No vendors found</p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium">Categories</th>
                  <th className="text-left px-4 py-2.5 font-medium">Staff</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v: Record<string, unknown>) => (
                  <tr
                    key={v.id as string}
                    onClick={() => router.push(`/ops/vendors/${v.id}`)}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">{v.name as string}</td>
                    <td className="px-4 py-3 text-muted-foreground">{v.email as string}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">
                        {v.vendorType as string}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 flex gap-1 flex-wrap">
                      {formatCategories(v.categories as string)}
                    </td>
                    <td className="px-4 py-3">
                      {(v._count as Record<string, number>)?.staff ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className={STATUS_STYLES[v.status as string] || ""}>
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
                className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{v.name as string}</p>
                    <p className="text-xs text-muted-foreground">{v.email as string}</p>
                  </div>
                  <Badge variant="secondary" className={STATUS_STYLES[v.status as string] || ""}>
                    {v.status as string}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">{v.vendorType as string}</Badge>
                  <span>{(v._count as Record<string, number>)?.staff ?? 0} staff</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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
      zones: form.zones.split(",").map((z) => z.trim()).filter(Boolean),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Name</Label>
        <Input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
      </div>
      <div className="space-y-2">
        <Label>Email</Label>
        <Input
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          required
        />
      </div>
      <div className="space-y-2">
        <Label>Phone</Label>
        <Input
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select
            value={form.vendorType}
            onValueChange={(v) => setForm((f) => ({ ...f, vendorType: v }))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MICRO">Micro</SelectItem>
              <SelectItem value="SME">SME</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Staff Count</Label>
          <Input
            type="number"
            min={1}
            value={form.staffCount}
            onChange={(e) => setForm((f) => ({ ...f, staffCount: parseInt(e.target.value) || 1 }))}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Daily Capacity</Label>
        <Input
          type="number"
          min={1}
          value={form.dailyCapacity}
          onChange={(e) => setForm((f) => ({ ...f, dailyCapacity: parseInt(e.target.value) || 6 }))}
        />
      </div>
      <div className="space-y-2">
        <Label>Categories</Label>
        <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
          {CATEGORIES.map((cat) => (
            <label key={cat} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox
                checked={form.categories.includes(cat)}
                onCheckedChange={() => toggleCategory(cat)}
              />
              {cat.replace(/_/g, " ")}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label>Zones (comma-separated)</Label>
        <Input
          placeholder="e.g. East, North-East"
          value={form.zones}
          onChange={(e) => setForm((f) => ({ ...f, zones: e.target.value }))}
        />
      </div>
      <Button type="submit" style={{ backgroundColor: "#10b981" }} className="w-full text-white" disabled={loading}>
        {loading ? "Creating..." : "Create Vendor"}
      </Button>
    </form>
  );
}