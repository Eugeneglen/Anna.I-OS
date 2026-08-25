"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { CAMPAIGN_QUERY_KEYS } from "./campaign-styles";

// ============================================================
// Anna.I — Ops Campaign Generate Codes Dialog
// ============================================================
// Triggered from the detail sheet. Two modes via Tabs:
//   1. Single — generate one code (optionally a custom one)
//   2. Bulk  — generate N random codes with a prefix/length
// On success, shows the generated code(s) in a copyable box.
// ============================================================

interface CampaignGenerateCodesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string | null;
  campaignName?: string;
}

export function CampaignGenerateCodesDialog({
  open,
  onOpenChange,
  campaignId,
  campaignName,
}: CampaignGenerateCodesDialogProps) {
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"single" | "bulk">("single");
  // ── Single ──
  const [code, setCode] = useState("");
  const [singleMaxUses, setSingleMaxUses] = useState("");
  const [singleExpiresAt, setSingleExpiresAt] = useState("");
  // ── Bulk ──
  const [quantity, setQuantity] = useState("10");
  const [prefix, setPrefix] = useState("");
  const [codeLength, setCodeLength] = useState("8");
  const [bulkMaxUses, setBulkMaxUses] = useState("");
  const [bulkExpiresAt, setBulkExpiresAt] = useState("");

  // ── Result display ──
  const [resultSingle, setResultSingle] = useState<string | null>(null);
  const [resultBulk, setResultBulk] = useState<{
    codes: string[];
    count: number;
  } | null>(null);

  function resetForm() {
    setMode("single");
    setCode("");
    setSingleMaxUses("");
    setSingleExpiresAt("");
    setQuantity("10");
    setPrefix("");
    setCodeLength("8");
    setBulkMaxUses("");
    setBulkExpiresAt("");
    setResultSingle(null);
    setResultBulk(null);
  }

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!campaignId) throw new Error("No campaign selected");
      const res = await fetch(
        `/api/ops/campaigns/${campaignId}/codes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(JSON.stringify(data.error));
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEYS.list });
      if (campaignId) {
        queryClient.invalidateQueries({
          queryKey: CAMPAIGN_QUERY_KEYS.detail(campaignId),
        });
      }
      if (mode === "single") {
        const c = (data as { code?: { code: string } }).code?.code || "";
        setResultSingle(c);
        setResultBulk(null);
        toast.success(`Code created: ${c}`);
      } else {
        const r = data as { codes: string[]; count: number };
        setResultBulk({ codes: r.codes, count: r.count });
        setResultSingle(null);
        toast.success(`${r.count} codes generated`);
      }
    },
    onError: (error: unknown) => {
      const msg = error instanceof Error ? error.message : "Failed";
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const errors = parsed as Record<string, string[]>;
          const firstKey = Object.keys(errors)[0];
          const firstMsg = errors[firstKey]?.[0];
          toast.error(firstMsg || "Please fix the highlighted fields");
          return;
        }
        if (typeof parsed === "string" && parsed.length > 0) {
          toast.error(parsed);
          return;
        }
      } catch {
        // not JSON
      }
      toast.error("Failed to generate codes");
    },
  });

  function handleSubmit() {
    if (!campaignId) return;
    setResultSingle(null);
    setResultBulk(null);

    if (mode === "single") {
      const payload: Record<string, unknown> = { mode: "single" };
      if (code.trim()) payload.code = code.trim().toUpperCase();
      if (singleMaxUses.trim()) {
        const n = parseInt(singleMaxUses, 10);
        if (!isNaN(n) && n > 0) payload.maxUses = n;
      }
      if (singleExpiresAt)
        payload.expiresAt = new Date(singleExpiresAt).toISOString();
      mutation.mutate(payload);
    } else {
      const q = parseInt(quantity, 10);
      if (isNaN(q) || q < 1 || q > 10000) {
        toast.error("Quantity must be between 1 and 10000");
        return;
      }
      const payload: Record<string, unknown> = {
        mode: "bulk",
        quantity: q,
      };
      if (prefix.trim()) payload.prefix = prefix.trim().toUpperCase();
      const cl = parseInt(codeLength, 10);
      if (!isNaN(cl) && cl >= 4 && cl <= 20) payload.codeLength = cl;
      if (bulkMaxUses.trim()) {
        const n = parseInt(bulkMaxUses, 10);
        if (!isNaN(n) && n > 0) payload.maxUses = n;
      }
      if (bulkExpiresAt)
        payload.expiresAt = new Date(bulkExpiresAt).toISOString();
      mutation.mutate(payload);
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) resetForm();
    onOpenChange(open);
  }

  function copyToClipboard(text: string) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => toast.success("Copied to clipboard"))
        .catch(() => toast.error("Copy failed"));
    } else {
      toast.error("Clipboard unavailable");
    }
  }

  const isBulkValid =
    mode !== "bulk" ||
    (!isNaN(parseInt(quantity, 10)) &&
      parseInt(quantity, 10) >= 1 &&
      parseInt(quantity, 10) <= 10000);
  const isSingleValid = mode !== "single" || true; // custom code is optional
  const isValid = isBulkValid && isSingleValid;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border-[var(--anna-border)] bg-[var(--anna-white)] anna-scroll">
        <DialogHeader>
          <DialogTitle className="text-lg text-[var(--anna-slate)]">
            Generate Codes
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--anna-muted)]">
            {campaignName
              ? `For campaign “${campaignName}”`
              : "Create new discount codes"}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as "single" | "bulk")}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2 h-9 bg-[var(--anna-bg)]">
            <TabsTrigger value="single">Single</TabsTrigger>
            <TabsTrigger value="bulk">Bulk</TabsTrigger>
          </TabsList>

          {/* ── Single mode ── */}
          <TabsContent value="single" className="space-y-3 mt-3">
            <div className="space-y-1">
              <Label className="text-xs">Custom Code (optional)</Label>
              <Input
                placeholder="Leave blank for auto-generated"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="rounded-xl border-[var(--anna-border)] h-9 text-sm font-data uppercase"
              />
              <p className="text-[10px] text-[var(--anna-muted)]">
                Codes are uppercased automatically.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Max Uses</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="blank = unlimited"
                  value={singleMaxUses}
                  onChange={(e) => setSingleMaxUses(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Expires At</Label>
                <Input
                  type="datetime-local"
                  value={singleExpiresAt}
                  onChange={(e) => setSingleExpiresAt(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
            </div>
          </TabsContent>

          {/* ── Bulk mode ── */}
          <TabsContent value="bulk" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quantity *</Label>
                <Input
                  type="number"
                  min="1"
                  max="10000"
                  placeholder="10"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Code Length</Label>
                <Input
                  type="number"
                  min="4"
                  max="20"
                  placeholder="8"
                  value={codeLength}
                  onChange={(e) => setCodeLength(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Prefix</Label>
                <Input
                  placeholder="e.g. ANNA"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm font-data uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Uses (per code)</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="blank = unlimited"
                  value={bulkMaxUses}
                  onChange={(e) => setBulkMaxUses(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Expires At (all codes)</Label>
                <Input
                  type="datetime-local"
                  value={bulkExpiresAt}
                  onChange={(e) => setBulkExpiresAt(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Results ── */}
        {resultSingle && (
          <div className="space-y-2 rounded-xl border border-[var(--anna-sage)]/30 bg-[var(--anna-sage-light)]/40 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)]">
              Generated Code
            </p>
            <div className="flex items-center gap-2">
              <code className="font-data text-sm text-[var(--anna-slate)] flex-1 truncate">
                {resultSingle}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 rounded-lg"
                onClick={() => copyToClipboard(resultSingle)}
              >
                <Copy size={12} className="mr-1" /> Copy
              </Button>
            </div>
          </div>
        )}
        {resultBulk && (
          <div className="space-y-2 rounded-xl border border-[var(--anna-sage)]/30 bg-[var(--anna-sage-light)]/40 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)]">
                {resultBulk.count} Codes Generated
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 rounded-lg"
                onClick={() =>
                  copyToClipboard(resultBulk.codes.join("\n"))
                }
              >
                <Copy size={12} className="mr-1" /> Copy All
              </Button>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto anna-scroll">
              {resultBulk.codes.slice(0, 5).map((c) => (
                <code
                  key={c}
                  className="block font-data text-xs text-[var(--anna-slate)] truncate"
                >
                  {c}
                </code>
              ))}
              {resultBulk.codes.length > 5 && (
                <p className="text-[10px] text-[var(--anna-muted)] pt-1">
                  + {resultBulk.codes.length - 5} more (use Copy All)
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="rounded-xl"
          >
            Close
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || mutation.isPending}
            className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl"
          >
            {mutation.isPending
              ? "Generating..."
              : mode === "single"
                ? "Generate Code"
                : `Generate ${quantity || "N"} Codes`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
