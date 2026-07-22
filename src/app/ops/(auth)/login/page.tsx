"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function OpsLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/ops/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Login failed");
        // Auto-attempt database repair if credentials look correct
        if (data.error === "Invalid credentials") {
          try {
            const repairRes = await fetch("/api/ops/ensure-users", { method: "POST" });
            const repairData = await repairRes.json();
            if (repairData.created) {
              toast.success("Database repaired — please try logging in again");
            }
          } catch {
            // silent fail — the repair link is available as fallback
          }
        }
        return;
      }

      toast.success(`Welcome back, ${data.user.name}`);
      router.push("/ops/vendors");
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
          <h1 className="text-2xl font-bold tracking-tight text-[var(--anna-sage-dark)]">
            Anna.I
          </h1>
          <p className="text-xs font-data uppercase tracking-widest text-[var(--anna-muted)] mt-1">
            Ops Control Centre
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="email"
                className="text-xs font-medium text-[var(--anna-slate)]"
              >
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="eugene@annai.sg"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="rounded-xl border-[var(--anna-border)] h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="password"
                className="text-xs font-medium text-[var(--anna-slate)]"
              >
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="anna1234"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="rounded-xl border-[var(--anna-border)] h-10"
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl h-10 text-sm font-semibold"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          {/* Dev credentials hint */}
          <div className="mt-5 p-3 rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
              Dev Credentials
            </p>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--anna-slate-light)]">
                  ADMIN
                </span>
                <code className="font-data text-[var(--anna-sage-dark)]">
                  eugene@annai.sg / anna1234
                </code>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--anna-slate-light)]">
                  COORD
                </span>
                <code className="font-data text-[var(--anna-sage-dark)]">
                  ops@annai.sg / anna1234
                </code>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--anna-slate-light)]">
                  ANALYST
                </span>
                <code className="font-data text-[var(--anna-sage-dark)]">
                  analyst@annai.sg / anna1234
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* Database repair link (hidden unless needed) */}
        <button
          type="button"
          onClick={async () => {
            try {
              const res = await fetch("/api/ops/ensure-users", { method: "POST" });
              const data = await res.json();
              if (data.success) {
                toast.success(data.message);
              } else {
                toast.error(data.error || "Repair failed");
              }
            } catch {
              toast.error("Network error during repair");
            }
          }}
          className="mt-4 mx-auto block text-[10px] text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] underline underline-offset-2 transition-colors cursor-pointer"
        >
          Repair database / re-seed users
        </button>

        {/* Footer */}
        <p className="mt-6 text-center text-[10px] text-[var(--anna-muted)]">
          Anna.I — The Operating System for the Modern Household
        </p>
      </div>
    </div>
  );
}