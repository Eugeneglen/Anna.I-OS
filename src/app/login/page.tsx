"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { Eye, EyeOff, ArrowLeft, Mail, Lock, User, Home, CheckCircle2 } from "lucide-react";

type AuthMode = "login" | "register" | "forgot-password" | "reset-password" | "success";

export default function HouseholdLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register fields
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regHouseholdName, setRegHouseholdName] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);

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
      const res = await fetch("/api/household/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Login failed");
        return;
      }

      toast.success(`Welcome back, ${data.member.name}`);
      router.push("/");
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  // ── Register Handler ──
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();

    if (regPassword !== regConfirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/household/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: regName,
          email: regEmail,
          password: regPassword,
          householdName: regHouseholdName,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Registration failed");
        return;
      }

      toast.success(`Welcome to Anna.I, ${data.member.name}!`);
      router.push("/");
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
      const res = await fetch("/api/household/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to generate reset token");
        return;
      }

      // In dev mode, the token is returned directly
      if (data.devToken) {
        setResetToken(data.devToken);
        toast.success("Reset token generated (dev mode)");
        setMode("reset-password");
      } else {
        // In production, an email would be sent
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
      const res = await fetch("/api/household/reset-password", {
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
      setLoginEmail(forgotEmail);
      setLoginPassword("");
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

  // ── Shared Styles ──
  const inputClass = "rounded-xl border-[var(--anna-border)] h-10 pl-9";
  const labelClass = "text-xs font-medium text-[var(--anna-slate)]";
  const btnPrimaryClass =
    "w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-10 text-sm font-semibold transition-colors";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ background: "#B8C4BE" }}>
      <div className="w-full max-w-sm anna-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <Image src="/brain-icon.png" alt="Anna.I" width={80} height={80} className="mx-auto mb-1" />
          <h1 className="text-2xl font-bold tracking-tight text-white">Anna.I</h1>
          <p className="text-[10px] font-medium text-white/80 mt-1">
            The Operating System for the Modern Household
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-6 shadow-sm">
          {/* ── LOGIN MODE ── */}
          {mode === "login" && (
            <>
              <div className="mb-5">
                <h2 className="text-base font-semibold text-[var(--anna-slate)]">
                  Sign in to your household
                </h2>
                <p className="text-xs text-[var(--anna-muted)] mt-1">
                  Manage tasks, bookings, and home services
                </p>
              </div>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="hh-email" className={labelClass}>Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                    <Input
                      id="hh-email"
                      type="email"
                      placeholder="you@example.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="hh-password" className={labelClass}>Password</Label>
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
                      id="hh-password"
                      type={showLoginPassword ? "text" : "password"}
                      placeholder="Enter password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      className={inputClass + " pr-9"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)] hover:text-[var(--anna-slate)] cursor-pointer"
                    >
                      {showLoginPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className={btnPrimaryClass} disabled={loading}>
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </form>

              {/* Divider */}
              <div className="mt-5 flex items-center gap-3">
                <div className="flex-1 h-px bg-[var(--anna-border)]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--anna-muted)]">
                  New to Anna.I?
                </span>
                <div className="flex-1 h-px bg-[var(--anna-border)]" />
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full mt-4 rounded-xl h-10 text-sm font-semibold border-[var(--anna-border)] text-[var(--anna-slate)] hover:bg-[var(--anna-bg)]"
                onClick={() => setMode("register")}
              >
                Create a New Household
              </Button>
            </>
          )}

          {/* ── REGISTER MODE ── */}
          {mode === "register" && (
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
                  Create your household
                </h2>
                <p className="text-xs text-[var(--anna-muted)] mt-1">
                  Set up your Anna.I account in seconds
                </p>
              </div>
              <form onSubmit={handleRegister} className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-name" className={labelClass}>Your Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                    <Input
                      id="reg-name"
                      type="text"
                      placeholder="e.g. Sarah Tan"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-household" className={labelClass}>Household Name</Label>
                  <div className="relative">
                    <Home className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                    <Input
                      id="reg-household"
                      type="text"
                      placeholder="e.g. Tan Family"
                      value={regHouseholdName}
                      onChange={(e) => setRegHouseholdName(e.target.value)}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-email" className={labelClass}>Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder="you@example.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-password" className={labelClass}>Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                    <Input
                      id="reg-password"
                      type={showRegPassword ? "text" : "password"}
                      placeholder="Min. 8 characters"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      required
                      minLength={8}
                      className={inputClass + " pr-9"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPassword(!showRegPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)] hover:text-[var(--anna-slate)] cursor-pointer"
                    >
                      {showRegPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-confirm" className={labelClass}>Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--anna-muted)]" />
                    <Input
                      id="reg-confirm"
                      type={showRegPassword ? "text" : "password"}
                      placeholder="Re-enter your password"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      required
                      minLength={8}
                      className={inputClass}
                    />
                  </div>
                </div>
                <Button type="submit" className={btnPrimaryClass} disabled={loading}>
                  {loading ? "Creating account..." : "Create Account"}
                </Button>
              </form>

              <p className="mt-3 text-center text-[10px] text-[var(--anna-muted)]">
                By creating an account, you agree to our Terms of Service and Privacy Policy.
              </p>
            </>
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
                  Enter the email associated with your account and we will generate a reset token.
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
                      placeholder="you@example.com"
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
                      className={inputClass + " pr-9"}
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

          {/* Demo Credentials - only show on login mode */}
          {mode === "login" && (
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
          )}
        </div>

        {/* Portal Links */}
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => router.push("/ops/login")}
            className="text-xs text-white/70 hover:text-white underline underline-offset-2 transition-colors cursor-pointer"
          >
            &larr; Ops Portal
          </button>
          <span className="text-white/40">|</span>
          <button
            type="button"
            onClick={() => router.push("/vendor/login")}
            className="text-xs text-white/70 hover:text-white underline underline-offset-2 transition-colors cursor-pointer"
          >
            Vendor Portal &rarr;
          </button>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-[10px] text-white/70">
          Anna.I.sg
        </p>
      </div>
    </div>
  );
}
