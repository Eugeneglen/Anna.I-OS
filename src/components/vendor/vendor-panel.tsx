"use client";

import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { VendorSchedule, type VendorScheduleItem, type VendorInfo } from "./vendor-schedule";
import { VendorEarnings } from "./vendor-earnings";
import { VendorTaskDetail } from "./vendor-task-detail";
import { useAnnaStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { CalendarDays, Wallet } from "lucide-react";

async function fetchVendors() {
  const res = await fetch("/api/vendors");
  if (!res.ok) return [];
  return res.json();
}

// ─── Main component ──────────────────────────────────────

export function VendorPanel({ className }: { className?: string }) {
  const { selectedVendorId, setSelectedVendorId } = useAnnaStore();
  const [activeTab, setActiveTab] = useState<"schedule" | "earnings">("schedule");
  const [selectedBooking, setSelectedBooking] = useState<VendorScheduleItem | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<VendorInfo | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: vendors } = useQuery({
    queryKey: ["vendors-list"],
    queryFn: fetchVendors,
    staleTime: 60_000,
  });

  const vendorId = selectedVendorId || vendors?.[0]?.id || "";
  const vendor = vendors?.find((v: { id: string }) => v.id === vendorId);

  const handleSelectBooking = useCallback((booking: VendorScheduleItem, vendor: VendorInfo) => {
    setSelectedBooking(booking);
    setSelectedVendor(vendor);
    setDetailOpen(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false);
  }, []);

  const actionMutation = useMutation({
    mutationFn: async ({
      bookingId,
      action,
    }: {
      bookingId: string;
      action: string;
    }) => {
      const res = await fetch(`/api/vendors/${vendorId}/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Action failed");
      return res.json();
    },
    onSuccess: (_, variables) => {
      // Optimistic local update
      const actionToStatus: Record<string, string> = {
        accept: "accepted",
        start: "in_progress",
        complete: "completed",
        reject: "cancelled",
      };
      setSelectedBooking((prev) => {
        if (!prev || prev.id !== variables.bookingId) return prev;
        return {
          ...prev,
          status: actionToStatus[variables.action] ?? prev.status,
        };
      });
      queryClient.invalidateQueries({ queryKey: ["vendor-schedule", vendorId] });
      queryClient.invalidateQueries({ queryKey: ["vendor-earnings", vendorId] });
    },
  });

  const handleAction = useCallback(
    (bookingId: string, action: string) => {
      actionMutation.mutate({ bookingId, action });
    },
    [actionMutation]
  );

  return (
    <div className={cn("pb-20 md:pb-0", className)}>
      {/* Header */}
      <div className="p-4 lg:p-6 pb-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center">
              <CalendarDays size={18} className="text-[var(--anna-sage-dark)]" />
            </div>
            <div>
              <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
                Vendor Portal
              </h1>
              <p className="text-sm text-[var(--anna-muted)] mt-0.5">
                Manage your jobs, track earnings
              </p>
            </div>
          </div>
          {vendors && vendors.length > 0 && (
            <Select
              value={vendorId}
              onValueChange={(id) => { setSelectedVendorId(id); queryClient.invalidateQueries({ queryKey: ["vendor-schedule"] }); }}
            >
              <SelectTrigger size="sm" className="w-auto min-w-[140px] border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm font-medium">
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v: { id: string; name: string; vendorType?: string }) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name} {v.vendorType === "SME" ? "(SME)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {!vendorId ? (
        <div className="text-center py-16 text-[var(--anna-muted)]">
          <p className="text-sm">No vendors available</p>
          <p className="text-xs mt-1">Seed the database to see vendor data</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="px-4 lg:px-6 mt-4">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "schedule" | "earnings")}
          className="w-full"
        >
          <TabsList className="bg-[var(--anna-bg)] rounded-xl p-1 w-full sm:w-auto">
            <TabsTrigger
              value="schedule"
              className="rounded-lg text-xs data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
            >
              <CalendarDays size={14} className="mr-1.5" />
              Schedule
            </TabsTrigger>
            <TabsTrigger
              value="earnings"
              className="rounded-lg text-xs data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
            >
              <Wallet size={14} className="mr-1.5" />
              Earnings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="schedule" className="mt-4">
            <VendorSchedule
              vendorId={vendorId}
              onSelectBooking={handleSelectBooking}
            />
          </TabsContent>

          <TabsContent value="earnings" className="mt-4">
            <VendorEarnings vendorId={vendorId} />
          </TabsContent>
        </Tabs>
      </div>

          {/* Task detail panel */}
          <VendorTaskDetail
            booking={selectedBooking}
            vendor={selectedVendor}
            open={detailOpen}
            onClose={handleCloseDetail}
            onAction={handleAction}
            isActionPending={actionMutation.isPending}
            vendorId={vendorId}
          />
        </>
      )}
    </div>
  );
}