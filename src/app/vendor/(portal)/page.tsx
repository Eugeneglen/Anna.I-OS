"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function VendorDashboardIndex() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/vendor/schedule");
  }, [router]);

  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--anna-sage-dark)]" />
    </div>
  );
}
