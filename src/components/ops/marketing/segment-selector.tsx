"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

// ── Segment Selector (used in campaign create dialog) ──

interface SegmentSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function SegmentSelector({ value, onChange }: SegmentSelectorProps) {
  const { data } = useQuery<{ segments: Array<{ id: string; name: string; memberCount: number }> }>({
    queryKey: ["ops-marketing-segments"],
    queryFn: async () => {
      const res = await fetch("/api/ops/marketing/segments");
      if (!res.ok) return { segments: [] };
      return res.json();
    },
    staleTime: 30_000,
  });

  const segments = data?.segments || [];

  return (
    <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
      <SelectTrigger className="w-full rounded-xl border-[var(--anna-border)] h-9 text-sm">
        <SelectValue placeholder="No segment (public campaign)" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No segment (public campaign)</SelectItem>
        {segments.filter((s) => s.memberCount > 0).map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name} ({s.memberCount} member{s.memberCount === 1 ? "" : "s"})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
