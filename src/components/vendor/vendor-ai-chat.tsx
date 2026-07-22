"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Send,
  AlertCircle,
  Briefcase,
  CalendarDays,
  Wallet,
  Star,
  Clock,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface VendorAiResponse {
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
        <Briefcase size={12} className="text-white" />
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
// Quick-suggestion chips (vendor-scoped)
// ─────────────────────────────────────────────────────────────

const SUGGESTION_CHIPS = [
  {
    label: "What jobs do I have today?",
    prompt: "What jobs do I have scheduled for today?",
    icon: CalendarDays,
  },
  {
    label: "Check my earnings",
    prompt: "How much have I earned and what's pending payout?",
    icon: Wallet,
  },
  {
    label: "What's my rating?",
    prompt: "What's my current rating and performance overview?",
    icon: Star,
  },
  {
    label: "This week's schedule",
    prompt: "Show me my schedule for this week",
    icon: Clock,
  },
];

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function VendorAiChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mutation for sending messages
  const mutation = useMutation({
    mutationFn: async (msg: string): Promise<VendorAiResponse> => {
      const res = await fetch("/api/vendor/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
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
          content: `Something went wrong — ${error.message}. Please try again.`,
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
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || mutation.isPending) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed, timestamp: Date.now() },
    ]);
    setInput("");

    mutation.mutate(trimmed);
  }, [input, mutation.isPending, mutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* ── Floating Action Button ── */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={() => setOpen(true)}
            className="fixed z-50 bottom-20 right-4 md:bottom-8 md:right-6 w-14 h-14 rounded-full bg-[var(--anna-sage)] text-white shadow-lg hover:bg-[var(--anna-sage-dark)] transition-colors flex items-center justify-center"
            aria-label="Open Vendor AI Assistant"
          >
            <Briefcase size={22} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Chat Panel ── */}
      <AnimatePresence>
        {open && (
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
                  <Briefcase size={14} className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--anna-slate)]">
                    Vendor Assistant
                  </h3>
                  <p className="text-[10px] text-[var(--anna-sage-dark)] font-medium">
                    Jobs, earnings & guidance
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full hover:bg-[var(--anna-sage-light)]"
                onClick={() => setOpen(false)}
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
                    <MessageSquare size={22} className="text-[var(--anna-sage-dark)]" />
                  </div>
                  <p className="text-sm font-semibold text-[var(--anna-slate)] mb-1">
                    Hi there!
                  </p>
                  <p className="text-xs text-[var(--anna-muted)] leading-relaxed max-w-[260px] mb-5">
                    I can help you check your schedule, earnings, job details, and performance. Ask me anything about your work on Anna.I.
                  </p>
                  {/* Quick-suggestion chips */}
                  <div className="flex flex-col gap-2 w-full max-w-[280px]">
                    {SUGGESTION_CHIPS.map((chip) => {
                      const Icon = chip.icon;
                      return (
                        <button
                          key={chip.label}
                          onClick={() => {
                            setMessages((prev) => [
                              ...prev,
                              { role: "user", content: chip.prompt, timestamp: Date.now() },
                            ]);
                            mutation.mutate(chip.prompt);
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
                            <Briefcase size={10} className="text-white" />
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
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {mutation.isPending && <TypingIndicator />}

                  {/* Error state */}
                  {mutation.isError &&
                    messages[messages.length - 1]?.role !== "assistant" && (
                      <div className="flex items-start gap-2.5 px-4">
                        <div className="w-7 h-7 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertCircle size={14} className="text-red-500" />
                        </div>
                        <div className="bg-red-50 border border-red-200 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm text-red-600">
                          Something went wrong. Please try again.
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* ── Input Bar ── */}
            <div className="flex-shrink-0 border-t border-[var(--anna-border)] px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-[var(--anna-white)]">
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
                  placeholder="Ask about jobs, earnings..."
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
