"use client";

import { useVendorUser } from "@/app/vendor/(portal)/layout";
import { VendorEarnings } from "@/components/vendor/vendor-earnings";

export default function VendorEarningsPage() {
  const user = useVendorUser();
  const vendorId = user?.id ?? "";

  if (!vendorId) return null;

  return (
    <div className="pb-20 md:pb-0">
      <div className="mb-4">
        <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
          Earnings
        </h1>
        <p className="text-sm text-[var(--anna-muted)] mt-0.5">
          Track your payouts and revenue
        </p>
      </div>
      <VendorEarnings vendorId={vendorId} />
    </div>
  );
}
