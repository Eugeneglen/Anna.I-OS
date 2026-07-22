"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Briefcase } from "lucide-react";

export default function VendorLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/vendor/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Login failed");
        return;
      }

      toast.success(`Welcome, ${data.vendor.name}`);
      router.push("/vendor/schedule");
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
            <Briefcase size={22} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--anna-sage-dark)]">
            Anna.I
          </h1>
          <p className="text-xs font-data uppercase tracking-widest text-[var(--anna-muted)] mt-1">
            Vendor Portal
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="vendor-email"
                className="text-xs font-medium text-[var(--anna-slate)]"
              >
                Email
              </Label>
              <Input
                id="vendor-email"
                type="email"
                placeholder="vendor@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="rounded-xl border-[var(--anna-border)] h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="vendor-password"
                className="text-xs font-medium text-[var(--anna-slate)]"
              >
                Password
              </Label>
              <Input
                id="vendor-password"
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
                <span className="text-[var(--anna-slate-light)]">MICRO</span>
                <code className="font-data text-[var(--anna-sage-dark)]">
                  ops@sparkclean.sg / vendor123
                </code>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--anna-slate-light)]">SME</span>
                <code className="font-data text-[var(--anna-sage-dark)]">
                  hello@freshwash.sg / vendor123
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* Back to household */}
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-6 mx-auto block text-xs text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] underline underline-offset-2 transition-colors cursor-pointer"
        >
          &larr; Back to Household Portal
        </button>

        {/* Footer */}
        <p className="mt-6 text-center text-[10px] text-[var(--anna-muted)]">
          Anna.I — The Operating System for the Modern Household
        </p>
      </div>
    </div>
  );
}
