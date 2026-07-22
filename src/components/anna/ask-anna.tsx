"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Send,
  AlertCircle,
  CheckCircle2,
  CalendarDays,
  Shield,
  Sparkles,
  CircleDot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAnnaStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  pendingConfirmation?: PendingConfirmation;
  actionResult?: {
    success: boolean;
    toolName: string;
    data?: Record<string, unknown>;
  };
}

interface PendingConfirmation {
  toolName: string;
  confirmationMessage: string;
  confirmationAction: Record<string, unknown>;
}

interface AskAnnaResponse {
  response: string;
  dataUsed: string[];
  pendingConfirmation?: PendingConfirmation;
  actionResult?: {
    success: boolean;
    toolName: string;
    data?: Record<string, unknown>;
  };
}

// ─────────────────────────────────────────────────────────────
// Typing indicator
// ─────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-start gap-2.5 px-4">
      <div className="w-7 h-7 rounded-full bg-[var(--anna-sage)] flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-[8px] font-bold text-white tracking-tight">A.I</span>
      </div>
      <div className="bg-[var(--anna-white)] border border-[var(--anna-border)] rounded-2xl rounded-tl-md px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-[var(--anna-muted)] rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-[var(--anna-muted)] rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-[var(--anna-muted)] rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Confirmation Card
// ─────────────────────────────────────────────────────────────

function ConfirmationCard({
  message,
  onConfirm,
  onDismiss,
  isPending,
}: {
  message: string;
  onConfirm: () => void;
  onDismiss: () => void;
  isPending: boolean;
}) {
  return (
    <div className="mx-4 my-1 anna-fade-in">
      <div className="bg-[var(--anna-sage-light)]/50 border border-[var(--anna-sage)]/30 rounded-2xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-lg bg-[var(--anna-sage)]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Shield size={12} className="text-[var(--anna-sage-dark)]" />
          </div>
          <p className="text-xs font-medium text-[var(--anna-slate)] leading-relaxed">
            {message}
          </p>
        </div>
        <div className="flex items-center gap-2 justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            disabled={isPending}
            className="rounded-lg h-8 text-xs text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-lg h-8 text-xs bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white font-semibold"
          >
            {isPending ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Confirming...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={12} />
                Confirm
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Success/Error Result Card
// ─────────────────────────────────────────────────────────────

function ResultCard({
  success,
  toolName,
  data,
}: {
  success: boolean;
  toolName: string;
  data?: Record<string, unknown>;
}) {
  const toolLabels: Record<string, string> = {
    create_task: "Task Created",
    cancel_task: "Task Cancelled",
  };

  return (
    <div className="mx-4 my-1 anna-fade-in">
      <div
        className={cn(
          "rounded-xl p-3 flex items-center gap-2",
          success
            ? "bg-[var(--anna-success)]/10 border border-[var(--anna-success)]/20"
            : "bg-red-50 border border-red-200"
        )}
      >
        {success ? (
          <CheckCircle2 size={14} className="text-[var(--anna-success)] flex-shrink-0" />
        ) : (
          <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
        )}
        <span
          className={cn(
            "text-xs font-medium",
            success ? "text-[var(--anna-success)]" : "text-red-600"
          )}
        >
          {toolLabels[toolName] || toolName}
          {success && data && (
            <span className="text-[var(--anna-muted)] font-normal ml-1.5">
              — {data.scheduledDate || data.taskId || ""}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Quick-suggestion chips (NLU-aware)
// ─────────────────────────────────────────────────────────────

const SUGGESTION_CHIPS = [
  {
    label: "Book a cleaning for tomorrow",
    prompt: "Book a cleaning service for tomorrow at 10am",
    icon: CalendarDays,
  },
  {
    label: "What's my escrow balance?",
    prompt: "What's my current escrow balance?",
    icon: CircleDot,
  },
  {
    label: "Show my upcoming tasks",
    prompt: "What tasks are coming up for my household?",
    icon: CalendarDays,
  },
  {
    label: "Schedule aircon servicing",
    prompt: "I need an aircon servicing for next week",
    icon: Sparkles,
  },
];

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function AskAnna() {
  const { askAnnaOpen, setAskAnnaOpen, selectedHouseholdId } =
    useAnnaStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mutation for sending messages
  const mutation = useMutation({
    mutationFn: async ({
      msg,
      confirmAction,
    }: {
      msg: string;
      confirmAction?: {
        toolName: string;
        action: Record<string, unknown>;
      };
    }): Promise<AskAnnaResponse> => {
      const res = await fetch("/api/ask-anna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          householdId: selectedHouseholdId,
          confirmAction,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to get response");
      }
      return res.json();
    },
    onSuccess: (data, variables) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
          timestamp: Date.now(),
          pendingConfirmation: data.pendingConfirmation || undefined,
          actionResult: data.actionResult || undefined,
        },
      ]);
    },
    onError: (error) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, something went wrong — ${error.message}. Please try again.`,
          timestamp: Date.now(),
        },
      ]);
    },
  });

  // Handle confirmation
  const confirmMutation = useMutation({
    mutationFn: async ({
      originalMessage,
      confirmAction,
    }: {
      originalMessage: string;
      confirmAction: {
        toolName: string;
        action: Record<string, unknown>;
      };
    }) => {
      const res = await fetch("/api/ask-anna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Confirm: ${confirmAction.toolName}`,
          householdId: selectedHouseholdId,
          confirmAction,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Confirmation failed");
      }
      return res.json();
    },
    onSuccess: (data, variables) => {
      // Remove the confirmation from the last assistant message
      setMessages((prev) => {
        const updated = [...prev];
        const lastAssistant = updated.findLastIndex((m) => m.role === "assistant");
        if (lastAssistant >= 0) {
          updated[lastAssistant] = {
            ...updated[lastAssistant],
            pendingConfirmation: undefined,
            actionResult: data.actionResult
              ? {
                  success: data.actionResult.success,
                  toolName: data.actionResult.toolName,
                  data: data.actionResult.data,
                }
              : undefined,
          };
        }
        // Add the follow-up response
        updated.push({
          role: "assistant",
          content: data.response,
          timestamp: Date.now(),
          actionResult: data.actionResult
            ? {
                success: data.actionResult.success,
                toolName: data.actionResult.toolName,
                data: data.actionResult.data,
              }
            : undefined,
        });
        return updated;
      });
    },
    onError: (error) => {
      // Mark confirmation as failed
      setMessages((prev) => {
        const updated = [...prev];
        const lastAssistant = updated.findLastIndex((m) => m.role === "assistant");
        if (lastAssistant >= 0) {
          updated[lastAssistant] = {
            ...updated[lastAssistant],
            pendingConfirmation: undefined,
          };
        }
        updated.push({
          role: "assistant",
          content: `Sorry, the action failed — ${error.message}. Please try again.`,
          timestamp: Date.now(),
        });
        return updated;
      });
    },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, mutation.isPending, confirmMutation.isPending]);

  // Focus input when panel opens
  useEffect(() => {
    if (askAnnaOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [askAnnaOpen]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || mutation.isPending || !selectedHouseholdId) return;

    // Add user message
    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed, timestamp: Date.now() },
    ]);
    setInput("");

    // Send to API
    mutation.mutate({ msg: trimmed });
  }, [input, mutation.isPending, selectedHouseholdId, mutation]);

  const handleConfirm = useCallback(
    (originalMessage: string, confirmAction: PendingConfirmation) => {
      confirmMutation.mutate({
        originalMessage,
        confirmAction: {
          toolName: confirmAction.toolName,
          action: confirmAction.confirmationAction,
        },
      });
    },
    [confirmMutation]
  );

  const handleDismiss = useCallback(() => {
    setMessages((prev) => {
      const updated = [...prev];
      const lastAssistant = updated.findLastIndex((m) => m.role === "assistant");
      if (lastAssistant >= 0) {
        updated[lastAssistant] = {
          ...updated[lastAssistant],
          pendingConfirmation: undefined,
        };
      }
      // Add a dismissal message
      updated.push({
        role: "assistant",
        content: "No problem, I've cancelled that action. Let me know if you need anything else!",
        timestamp: Date.now(),
      });
      return updated;
    });
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* ── Floating Action Button (Speech Bubble) ── */}
      <AnimatePresence>
        {!askAnnaOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={() => setAskAnnaOpen(true)}
            className={cn(
              "fixed z-50 anna-fab-pulse",
              "bottom-20 right-4",
              "md:bottom-8 md:right-6"
            )}
            aria-label="Open Ask Anna"
          >
            <svg
              viewBox="0 0 64 72"
              width="56"
              height="63"
              className="drop-shadow-lg"
            >
              <path
                d="M32 4a28 28 0 0 1 28 28a28 28 0 0 1-28 28c-3.2 0-6.3-.5-9.2-1.5L14 68l2.8-12.3A27.9 27.9 0 0 1 4 32A28 28 0 0 1 32 4z"
                className="fill-[var(--anna-sage)] transition-colors group-hover:fill-[var(--anna-sage-dark)]"
              />
              <text
                x="32"
                y="36"
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-white"
                style={{ fontSize: "16px", fontWeight: 700, fontFamily: "var(--font-manrope), system-ui, sans-serif", letterSpacing: "-0.02em" }}
              >
                A.I
              </text>
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Chat Panel ── */}
      <AnimatePresence>
        {askAnnaOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className={cn(
              "fixed z-50 bg-[var(--anna-white)] shadow-2xl flex flex-col overflow-hidden",
              "md:bottom-8 md:right-6 md:w-[380px] md:h-[520px] md:rounded-2xl md:border md:border-[var(--anna-border)]",
              "inset-0 md:inset-auto rounded-none md:rounded-2xl"
            )}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--anna-border)] bg-[var(--anna-white)] flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[var(--anna-sage)] flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white tracking-tight">A.I</span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--anna-slate)]">
                    Ask Anna
                  </h3>
                  <p className="text-[10px] text-[var(--anna-sage-dark)] font-medium">
                    Your household, understood
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full hover:bg-[var(--anna-sage-light)]"
                onClick={() => setAskAnnaOpen(false)}
                aria-label="Close chat"
              >
                <X size={16} className="text-[var(--anna-slate-light)]" />
              </Button>
            </div>

            {/* ── Messages Area ── */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto anna-scroll px-0"
            >
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mb-4">
                    <svg viewBox="0 0 64 72" width="28" height="32">
                      <path
                        d="M32 4a28 28 0 0 1 28 28a28 28 0 0 1-28 28c-3.2 0-6.3-.5-9.2-1.5L14 68l2.8-12.3A27.9 27.9 0 0 1 4 32A28 28 0 0 1 32 4z"
                        className="fill-[var(--anna-sage-dark)]"
                      />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-[var(--anna-slate)] mb-1">
                    Hi, I&apos;m Anna
                  </p>
                  <p className="text-xs text-[var(--anna-muted)] leading-relaxed max-w-[260px] mb-5">
                    I can help manage your household — book services, check status, track spending, and more.
                  </p>
                  {/* Quick-suggestion chips */}
                  <div className="flex flex-col gap-2 w-full max-w-[280px]">
                    {SUGGESTION_CHIPS.map((chip) => {
                      const Icon = chip.icon;
                      return (
                        <button
                          key={chip.label}
                          onClick={() => {
                            setInput(chip.prompt);
                            setTimeout(() => inputRef.current?.focus(), 50);
                          }}
                          className="text-left px-3.5 py-2.5 rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] hover:bg-[var(--anna-sage-light)] hover:border-[var(--anna-sage)] transition-all duration-150 group flex items-center gap-2.5"
                        >
                          <Icon
                            size={14}
                            className="text-[var(--anna-muted)] group-hover:text-[var(--anna-sage-dark)] flex-shrink-0"
                          />
                          <p className="text-xs font-medium text-[var(--anna-slate)] group-hover:text-[var(--anna-sage-dark)]">
                            {chip.label}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 py-4">
                  {messages.map((msg, i) => (
                    <div key={i}>
                      {/* Message bubble */}
                      <div
                        className={cn(
                          "flex items-start gap-2.5 px-4",
                          msg.role === "user" ? "flex-row-reverse" : ""
                        )}
                      >
                        {/* Avatar */}
                        {msg.role === "assistant" && (
                          <div className="w-7 h-7 rounded-full bg-[var(--anna-sage)] flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-[8px] font-bold text-white tracking-tight">
                              A.I
                            </span>
                          </div>
                        )}

                        {/* Bubble */}
                        <div
                          className={cn(
                            "max-w-[280px] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                            msg.role === "user"
                              ? "bg-[var(--anna-sage)] text-white rounded-2xl rounded-tr-md"
                              : "bg-[var(--anna-bg)] text-[var(--anna-slate)] rounded-2xl rounded-tl-md border border-[var(--anna-border)]"
                          )}
                        >
                          {msg.content}
                        </div>
                      </div>

                      {/* Confirmation card (below this assistant message) */}
                      {msg.pendingConfirmation && (
                        <ConfirmationCard
                          message={msg.pendingConfirmation.confirmationMessage}
                          onConfirm={() => {
                            // Find the user message that preceded this assistant message
                            const userMsg = messages
                              .slice(0, i)
                              .reverse()
                              .find((m) => m.role === "user");
                            handleConfirm(
                              userMsg?.content || "",
                              msg.pendingConfirmation
                            );
                          }}
                          onDismiss={handleDismiss}
                          isPending={confirmMutation.isPending}
                        />
                      )}

                      {/* Action result card */}
                      {msg.actionResult && !msg.pendingConfirmation && (
                        <ResultCard
                          success={msg.actionResult.success}
                          toolName={msg.actionResult.toolName}
                          data={msg.actionResult.data}
                        />
                      )}
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {(mutation.isPending || confirmMutation.isPending) && (
                    <TypingIndicator />
                  )}

                  {/* Error state inline */}
                  {(mutation.isError || confirmMutation.isError) &&
                    messages[messages.length - 1]?.role !== "assistant" && (
                      <div className="flex items-start gap-2.5 px-4">
                        <div className="w-7 h-7 rounded-full bg-[var(--anna-error)]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertCircle
                            size={14}
                            className="text-[var(--anna-error)]"
                          />
                        </div>
                        <div className="bg-[var(--anna-error)]/5 border border-[var(--anna-error)]/20 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm text-[var(--anna-error)]">
                          Something went wrong. Please try again.
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* ── Input Bar ── */}
            <div className="flex-shrink-0 border-t border-[var(--anna-border)] px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-[var(--anna-white)]">
              {!selectedHouseholdId ? (
                <p className="text-xs text-[var(--anna-muted)] text-center py-1.5">
                  Select a household first
                </p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                  }}
                  className="flex items-center gap-2"
                >
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Book a service, ask about tasks..."
                    disabled={mutation.isPending || confirmMutation.isPending}
                    className="flex-1 h-9 text-sm border-[var(--anna-border)] bg-[var(--anna-bg)] rounded-xl px-3 focus-visible:ring-[var(--anna-sage)] focus-visible:ring-offset-0 placeholder:text-[var(--anna-muted)]"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={
                      !input.trim() ||
                      mutation.isPending ||
                      confirmMutation.isPending
                    }
                    className="h-9 w-9 rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white disabled:opacity-40 flex-shrink-0"
                    aria-label="Send message"
                  >
                    <Send size={16} />
                  </Button>
                </form>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
