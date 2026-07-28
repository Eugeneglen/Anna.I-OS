"use client";

import React, { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label for debugging (e.g. "TaskDetailPanel") */
  name?: string;
  /** Fallback UI shown inside the card / section (not a full-page takeover) */
  variant?: "inline" | "page";
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary that catches uncaught rendering errors in child components.
 *
 * WHY: In Next.js dev mode (`next dev`), errors are shown in the development
 * overlay and the page stays interactive. In production (`next build` + `next start`),
 * WITHOUT an error boundary, any uncaught error crashes the ENTIRE page with
 * "Application error: a client-side exception has occurred".
 *
 * This component catches those errors and shows a user-friendly fallback instead
 * of the white screen of death.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ""}]`,
      error,
      errorInfo.componentStack
    );
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { variant = "inline" } = this.props;

    // ── Inline variant: shown within a card/section ──
    if (variant === "inline") {
      return (
        <div className="rounded-2xl border border-[var(--anna-error)]/20 bg-red-50 dark:bg-red-950/20 p-6 text-center">
          <div className="w-10 h-10 rounded-xl bg-[var(--anna-error)]/10 flex items-center justify-center mx-auto mb-3">
            <AlertTriangle size={20} className="text-[var(--anna-error)]" />
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)]">
            Something went wrong
          </p>
          <p className="text-xs text-[var(--anna-muted)] mt-1 max-w-[280px] mx-auto">
            {this.props.name
              ? `An error occurred in ${this.props.name}.`
              : "This section encountered an error."}{" "}
            Try refreshing the page.
          </p>
          <div className="flex items-center justify-center gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={this.handleReset}
              className="rounded-xl text-xs"
            >
              Retry
            </Button>
            <Button
              size="sm"
              onClick={this.handleReload}
              className="rounded-xl text-xs bg-[var(--anna-error)] hover:bg-red-600 text-white"
            >
              <RefreshCw size={12} className="mr-1" />
              Reload
            </Button>
          </div>
        </div>
      );
    }

    // ── Page variant: full-page fallback ──
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--anna-bg)] p-4">
        <div className="max-w-md w-full rounded-2xl border border-[var(--anna-border)] bg-[var(--anna-white)] p-8 text-center shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-[var(--anna-error)]/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} className="text-[var(--anna-error)]" />
          </div>
          <h2 className="text-lg font-bold text-[var(--anna-slate)]">
            Something went wrong
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-2">
            An unexpected error occurred. This has been logged for review.
            Please try refreshing the page.
          </p>
          {this.state.error && (
            <details className="mt-4 text-left">
              <summary className="text-xs text-[var(--anna-muted)] cursor-pointer hover:text-[var(--anna-slate)]">
                Error details
              </summary>
              <pre className="mt-2 text-[11px] bg-[var(--anna-bg)] rounded-xl p-3 overflow-x-auto text-[var(--anna-slate)] font-mono whitespace-pre-wrap">
                {this.state.error.message}
              </pre>
            </details>
          )}
          <Button
            onClick={this.handleReload}
            className="mt-4 bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl"
          >
            <RefreshCw size={14} className="mr-2" />
            Reload Page
          </Button>
        </div>
      </div>
    );
  }
}

/**
 * Hook version for functional components — wraps a component tree in an ErrorBoundary.
 * Usage:
 *   <WithErrorBoundary name="TaskDetail">
 *     <TaskDetailPanel />
 *   </WithErrorBoundary>
 */
export function WithErrorBoundary({
  children,
  name,
  variant = "inline",
}: {
  children: ReactNode;
  name?: string;
  variant?: "inline" | "page";
}) {
  return (
    <ErrorBoundary name={name} variant={variant}>
      {children}
    </ErrorBoundary>
  );
}
