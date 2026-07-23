"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";

export default function HouseholdLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/household/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Login failed");
        return;
      }

      toast.success(`Welcome, ${data.member.name}`);
      router.push("/");
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--anna-bg)] px-4">
      <div className="w-full max-w-sm anna-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-[var(--anna-sage)] mx-auto flex items-center justify-center mb-3">
            <Image src="/brain-icon.png" alt="Anna.I" width={28} height={28} className="brightness-0 invert" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--anna-sage-dark)]">
            Anna.I
          </h1>
          <p className="text-[10px] font-medium text-[var(--anna-muted)] mt-1">
            The Operating System for the Modern Household
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6 shadow-sm">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-[var(--anna-slate)]">
              Sign in to your household
            </h2>
            <p className="text-xs text-[var(--anna-muted)] mt-1">
              Manage tasks, bookings, and home services
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="hh-email"
                className="text-xs font-medium text-[var(--anna-slate)]"
              >
                Email
              </Label>
              <Input
                id="hh-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="rounded-xl border-[var(--anna-border)] h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="hh-password"
                className="text-xs font-medium text-[var(--anna-slate)]"
              >
                Password
              </Label>
              <Input
                id="hh-password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="rounded-xl border-[var(--anna-border)] h-10"
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-10 text-sm font-semibold"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          {/* Dev credentials hint */}
          <div className="mt-5 p-3 rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
              Demo Credentials
            </p>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--anna-slate-light)]">Tan Family</span>
                <code className="font-data text-[var(--anna-sage-dark)]">
                  sarah.tan@example.com / household123
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* Links */}
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => router.push("/ops/login")}
            className="text-xs text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] underline underline-offset-2 transition-colors cursor-pointer"
          >
            &larr; Ops Portal
          </button>
          <span className="text-[var(--anna-border)]">|</span>
          <button
            type="button"
            onClick={() => router.push("/vendor/login")}
            className="text-xs text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] underline underline-offset-2 transition-colors cursor-pointer"
          >
            Vendor Portal &rarr;
          </button>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-[10px] text-[var(--anna-muted)]">
          Anna.I.sg
        </p>
      </div>
    </div>
  );
}
