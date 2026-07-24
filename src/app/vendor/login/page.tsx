"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Briefcase, Eye, EyeOff, ArrowLeft, Mail, Lock, CheckCircle2 } from "lucide-react";

type ViewMode = "login" | "forgot-password" | "reset-password" | "success";

export default function VendorLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<ViewMode>("login");
  const [loading, setLoading] = useState(false);

  // Login fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password fields
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

  // ── Login Handler ──
  async function handleLogin(e: React.FormEvent) {
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

  // ── Forgot Password Handler ──
  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/vendor/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to generate reset token");
        return;
      }

      if (data.devToken) {
        setResetToken(data.devToken);
        toast.success("Reset token generated (dev mode)");
        setMode("reset-password");
      } else {
        setMode("success");
        toast.success("If an account exists, check your email for a reset link.");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  // ── Reset Password Handler ──
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();

    if (newPassword !== confirmNewPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/vendor/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to reset password");
        return;
      }

      toast.success(data.message || "Password reset successfully");
      setMode("login");
      setEmail(forgotEmail);
      setPassword("");
      setForgotEmail("");
      setResetToken("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  const inputClass = "rounded-xl border-[var(--anna-border)] h-10 pl-9";
  const inputClassEye = "rounded-xl border-[var(--anna-border)] h-10 pl-9 pr-9";
  const labelClass = "text-xs font-medium text-[var(--anna-slate)]";
  const btnPrimaryClass =
    "w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-10 text-sm font-semibold transition-colors";

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

        {/* Auth Card */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6 shadow-sm">
          {/* ── LOGIN MODE ── */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="vendor-email" className={labelClass}>Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                  <Input
                    id="vendor-email"
                    type="email"
                    placeholder="vendor@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="vendor-password" className={labelClass}>Password</Label>
                  <button
                    type="button"
                    onClick={() => setMode("forgot-password")}
                    className="text-[11px] text-[var(--anna-sage-dark)] hover:underline cursor-pointer font-medium"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                  <Input
                    id="vendor-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={inputClassEye}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)] hover:text-[var(--anna-slate)] cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className={btnPrimaryClass} disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </Button>

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
            </form>
          )}

          {/* ── FORGOT PASSWORD MODE ── */}
          {mode === "forgot-password" && (
            <>
              <div className="mb-5">
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="flex items-center gap-1 text-[11px] text-[var(--anna-muted)] hover:text-[var(--anna-slate)] mb-2 cursor-pointer transition-colors"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to Sign In
                </button>
                <h2 className="text-base font-semibold text-[var(--anna-slate)]">
                  Reset your password
                </h2>
                <p className="text-xs text-[var(--anna-muted)] mt-1">
                  Enter the email associated with your vendor account.
                </p>
              </div>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="forgot-email" className={labelClass}>Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                    <Input
                      id="forgot-email"
                      type="email"
                      placeholder="vendor@company.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>
                <Button type="submit" className={btnPrimaryClass} disabled={loading}>
                  {loading ? "Generating token..." : "Generate Reset Token"}
                </Button>
              </form>

              <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-[10px] text-amber-800 font-medium">
                  Dev Mode: The reset token will be displayed after submission. In production, it would be sent via email.
                </p>
              </div>
            </>
          )}

          {/* ── RESET PASSWORD MODE ── */}
          {mode === "reset-password" && (
            <>
              <div className="mb-5">
                <button
                  type="button"
                  onClick={() => setMode("forgot-password")}
                  className="flex items-center gap-1 text-[11px] text-[var(--anna-muted)] hover:text-[var(--anna-slate)] mb-2 cursor-pointer transition-colors"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back
                </button>
                <h2 className="text-base font-semibold text-[var(--anna-slate)]">
                  Set new password
                </h2>
                <p className="text-xs text-[var(--anna-muted)] mt-1">
                  Enter your reset token and choose a new password.
                </p>
              </div>
              <form onSubmit={handleResetPassword} className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-token" className={labelClass}>Reset Token</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                    <Input
                      id="reset-token"
                      type="text"
                      placeholder="Paste your reset token here"
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password" className={labelClass}>New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                    <Input
                      id="new-password"
                      type={showNewPassword ? "text" : "password"}
                      placeholder="Min. 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      className={inputClassEye}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)] hover:text-[var(--anna-slate)] cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-new-password" className={labelClass}>Confirm New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                    <Input
                      id="confirm-new-password"
                      type={showNewPassword ? "text" : "password"}
                      placeholder="Re-enter your new password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      required
                      minLength={8}
                      className={inputClass}
                    />
                  </div>
                </div>
                <Button type="submit" className={btnPrimaryClass} disabled={loading}>
                  {loading ? "Resetting password..." : "Reset Password"}
                </Button>
              </form>
            </>
          )}

          {/* ── SUCCESS MODE ── */}
          {mode === "success" && (
            <div className="flex flex-col items-center py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
              <h2 className="text-base font-semibold text-[var(--anna-slate)] mb-2">
                Check your email
              </h2>
              <p className="text-xs text-[var(--anna-muted)] text-center mb-6">
                If an account with that email exists, we have sent a password reset link. It will expire in 30 minutes.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl h-10 text-sm font-semibold border-[var(--anna-border)] text-[var(--anna-slate)] hover:bg-[var(--anna-bg)]"
                onClick={() => setMode("login")}
              >
                Back to Sign In
              </Button>
            </div>
          )}
        </div>

        {/* Back to household */}
        <button
          type="button"
          onClick={() => router.push("/login")}
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
