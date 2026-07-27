"use client";

import { useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ============================================================
// Anna.I — Ops Create Household Dialog
// ============================================================
// Modal for creating a new household + owner account. Owns its
// own form state; submits an assembled payload via `onSubmit`.
// ============================================================

interface CreateHouseholdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: Record<string, unknown>) => void;
  loading: boolean;
}

export function CreateHouseholdDialog({
  open,
  onOpenChange,
  onSubmit,
  loading,
}: CreateHouseholdDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [tier, setTier] = useState("HOME");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit() {
    onSubmit({
      name,
      email,
      phone: phone || null,
      address,
      postalCode: postalCode || null,
      unitNumber: unitNumber || null,
      tier,
      ownerName,
      ownerEmail,
      ownerPhone: ownerPhone || null,
      password,
    });
  }

  const isValid =
    name && email && address && ownerName && ownerEmail && password && password.length >= 6;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border-[var(--anna-border)]">
        <DialogHeader>
          <DialogTitle className="text-lg text-[var(--anna-slate)]">
            Create New Household
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--anna-muted)]">
            Set up a new household and its owner account. The owner will need to complete onboarding after first login.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Household Info Section */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Household Information
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Household Name *</Label>
                <Input
                  placeholder="e.g. Tan Family"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Household Email *</Label>
                <Input
                  type="email"
                  placeholder="household@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input
                  placeholder="+65 9xxx xxxx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Subscription Tier</Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger className="rounded-xl border-[var(--anna-border)] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOME">Home ($8/mo)</SelectItem>
                    <SelectItem value="CARE">Care ($20/mo)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Address / Estate *</Label>
                <Input
                  placeholder="e.g. Tampines Street 21"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Postal Code</Label>
                <Input
                  placeholder="e.g. 520521"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unit Number</Label>
                <Input
                  placeholder="e.g. #12-345"
                  value={unitNumber}
                  onChange={(e) => setUnitNumber(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--anna-border)]" />

          {/* Owner Info Section */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Owner Account
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Owner Name *</Label>
                <Input
                  placeholder="e.g. Sarah Tan"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Owner Email *</Label>
                <Input
                  type="email"
                  placeholder="owner@example.com"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Owner Phone</Label>
                <Input
                  placeholder="+65 9xxx xxxx"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Initial Password * <span className="text-[var(--anna-muted)]">(min 6 chars)</span></Label>
                <Input
                  type="text"
                  placeholder="Set login password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || loading}
            className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl"
          >
            {loading ? "Creating..." : "Create Household"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
