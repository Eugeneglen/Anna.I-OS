"use client";

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { VendorSchedule, type VendorScheduleItem, type VendorInfo } from "./vendor-schedule";
import { VendorEarnings } from "./vendor-earnings";
import { VendorTaskDetail } from "./vendor-task-detail";
import { cn } from "@/lib/utils";
import { CalendarDays, Wallet } from "lucide-react";

// ─── Props ───────────────────────────────────────────────

interface VendorPanelProps {
  vendorId: string;
  className?: string;
}

// ─── Main component ──────────────────────────────────────

export function VendorPanel({ vendorId, className }: VendorPanelProps) {
  const [activeTab, setActiveTab] = useState<"schedule" | "earnings">("schedule");
  const [selectedBooking, setSelectedBooking] = useState<VendorScheduleItem | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<VendorInfo | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const queryClient = useQueryClient();

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
      </div>

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
    </div>
  );
}