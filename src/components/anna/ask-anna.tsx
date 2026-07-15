"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, AlertCircle } from "lucide-react";
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
}

interface AskAnnaResponse {
  response: string;
  dataUsed: string[];
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
// Quick-suggestion chips (context-aware prompts for empty state)
// ─────────────────────────────────────────────────────────────

const SUGGESTION_CHIPS = [
  {
    label: "What's my escrow balance?",
    prompt: "What's my current escrow balance?",
  },
  {
    label: "Who cleaned last week?",
    prompt: "Who was the vendor for my last cleaning task?",
  },
  {
    label: "Am I close to the next autonomy level?",
    prompt: "How close am I to leveling up autonomy in each category?",
  },
  {
    label: "Upcoming tasks this week",
    prompt: "What tasks are coming up this week for my household?",
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
    mutationFn: async (msg: string): Promise<AskAnnaResponse> => {
      const res = await fetch("/api/ask-anna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          householdId: selectedHouseholdId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to get response");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
          timestamp: Date.now(),
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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, mutation.isPending]);

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
    mutation.mutate(trimmed);
  }, [input, mutation.isPending, selectedHouseholdId, mutation]);

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
              // Desktop: positioned card
              "md:bottom-8 md:right-6 md:w-[380px] md:h-[520px] md:rounded-2xl md:border md:border-[var(--anna-border)]",
              // Mobile: full-viewport overlay (no cropping possible)
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
                    Ask me about your household — tasks, spending, vendor history, or autonomy progress.
                  </p>
                  {/* Quick-suggestion chips */}
                  <div className="flex flex-col gap-2 w-full max-w-[280px]">
                    {SUGGESTION_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        onClick={() => {
                          setInput(chip.prompt);
                          setTimeout(() => inputRef.current?.focus(), 50);
                        }}
                        className="text-left px-3.5 py-2.5 rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] hover:bg-[var(--anna-sage-light)] hover:border-[var(--anna-sage)] transition-all duration-150 group"
                      >
                        <p className="text-xs font-medium text-[var(--anna-slate)] group-hover:text-[var(--anna-sage-dark)]">
                          {chip.label}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 py-4">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
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
                  ))}

                  {/* Typing indicator */}
                  {mutation.isPending && <TypingIndicator />}

                  {/* Error state inline */}
                  {mutation.isError && messages[messages.length - 1]?.role !== "assistant" && (
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
                    placeholder="Ask about your household..."
                    disabled={mutation.isPending}
                    className="flex-1 h-9 text-sm border-[var(--anna-border)] bg-[var(--anna-bg)] rounded-xl px-3 focus-visible:ring-[var(--anna-sage)] focus-visible:ring-offset-0 placeholder:text-[var(--anna-muted)]"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!input.trim() || mutation.isPending}
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