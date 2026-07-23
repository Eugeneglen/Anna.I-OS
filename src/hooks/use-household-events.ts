// ============================================================
// Anna.I — useHouseholdEvents React Hook
// Connects to the ops-events WebSocket service for real-time
// event streaming in the Household portal.
// Joins a room scoped to the selected household, so events
// are only delivered to the relevant household's browsers.
// ============================================================

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface HouseholdEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface UseHouseholdEventsOptions {
  /** Called when any household event arrives */
  onEvent?: (event: HouseholdEvent) => void;
  /** Called for specific event types */
  handlers?: Record<string, (event: HouseholdEvent) => void>;
  /** Enable/disable connection (default: true) */
  enabled?: boolean;
}

interface UseHouseholdEventsReturn {
  /** Whether the socket is connected */
  isConnected: boolean;
  /** Recent events received since connection */
  recentEvents: HouseholdEvent[];
  /** Manually reconnect */
  reconnect: () => void;
}

// ─────────────────────────────────────────────────────────────
// Event type → display category mapping
// ─────────────────────────────────────────────────────────────

export type HouseholdEventCategory =
  | "escrow"
  | "dispute"
  | "task"
  | "booking"
  | "autonomy"
  | "photos"
  | "vendor"
  | "info";

export function getEventCategory(type: string): HouseholdEventCategory {
  if (type.startsWith("escrow")) return "escrow";
  if (type.startsWith("dispute")) return "dispute";
  if (type.startsWith("task") || type.startsWith("booking")) return "task";
  if (type.startsWith("work") || type.startsWith("photos")) return "vendor";
  if (type.startsWith("autonomy")) return "autonomy";
  return "info";
}

/** Map event types to human-readable action labels */
export function getEventLabel(type: string): string {
  const labels: Record<string, string> = {
    "escrow:state_changed": "Escrow Updated",
    "dispute:raised": "Dispute Raised",
    "dispute:resolved": "Dispute Resolved",
    "task:status_changed": "Task Updated",
    "booking:status_changed": "Booking Updated",
    "autonomy:promoted": "Autonomy Level Up",
    "work:completed": "Work Completed",
    "photos:uploaded": "New Photos Uploaded",
    "notification:created": "New Notification",
  };
  return labels[type] || "New Update";
}

/** Map event types to toast color theme */
export function getEventToastVariant(type: string): "success" | "warning" | "error" | "info" {
  const variants: Record<string, "success" | "warning" | "error" | "info"> = {
    "escrow:state_changed": "info",
    "dispute:raised": "error",
    "dispute:resolved": "success",
    "task:status_changed": "info",
    "booking:status_changed": "info",
    "autonomy:promoted": "success",
    "work:completed": "success",
    "photos:uploaded": "info",
    "notification:created": "info",
  };
  return variants[type] || "info";
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useHouseholdEvents(
  householdId: string | null | undefined,
  options: UseHouseholdEventsOptions = {}
): UseHouseholdEventsReturn {
  const { onEvent, handlers = {}, enabled = true } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [recentEvents, setRecentEvents] = useState<HouseholdEvent[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  const onEventRef = useRef(onEvent);
  const householdIdRef = useRef(householdId);

  // Keep refs up to date without triggering reconnects
  useEffect(() => {
    handlersRef.current = handlers;
    onEventRef.current = onEvent;
  }, [handlers, onEvent]);

  useEffect(() => {
    householdIdRef.current = householdId;
  }, [householdId]);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    try {
      const socket = io("/?XTransformPort=3004", {
        transports: ["websocket", "polling"],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
        timeout: 30000,
        auth: {
          type: "household",
          householdId: householdIdRef.current || undefined,
        },
      });
      console.log("[useHouseholdEvents] Socket created, connecting...");

      socket.on("connect", () => {
        console.log("[useHouseholdEvents] Connected!");
        setIsConnected(true);

        // Join household room on connect
        if (householdIdRef.current) {
          socket.emit("join:household", { householdId: householdIdRef.current });
        }
      });

      socket.on("disconnect", () => {
        console.log("[useHouseholdEvents] Disconnected");
        setIsConnected(false);
      });

      socket.on("connect_error", (err) => {
        console.warn("[useHouseholdEvents] Connect error:", err.message);
      });

      // Confirm room join
      socket.on("household:joined", (data: { householdId: string }) => {
        console.log(`[useHouseholdEvents] Joined household room: ${data.householdId}`);
      });

      // ── Household-specific event channel ──
      socket.on("household:event", (event: HouseholdEvent) => {
        setRecentEvents((prev) => [...prev, event].slice(-50));

        // Call generic handler via ref
        if (onEventRef.current) {
          onEventRef.current(event);
        }

        // Call type-specific handler via ref
        const currentHandlers = handlersRef.current;
        const typedHandler = currentHandlers[event.type];
        if (typedHandler) {
          typedHandler(event);
        }
      });

      // ── Type-specific household event handlers ──
      const registeredTypes = Object.keys(handlersRef.current);
      for (const type of registeredTypes) {
        socket.on(`household:event:${type}`, (event: HouseholdEvent) => {
          const currentHandlers = handlersRef.current;
          const typedHandler = currentHandlers[type];
          if (typedHandler) {
            typedHandler(event);
          }
        });
      }

      socketRef.current = socket;
    } catch (err) {
      console.error("[useHouseholdEvents] Failed to create socket:", err);
    }
  }, [householdIdRef]);

  // ── Handle household ID changes (join/leave rooms) ──
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    if (householdId) {
      socket.emit("join:household", { householdId });
    } else {
      socket.emit("leave:household");
    }
  }, [householdId]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setRecentEvents([]);
    }
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(connect, 500);
  }, [connect, disconnect]);

  // Connect on mount if enabled
  useEffect(() => {
    if (enabled) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    isConnected,
    recentEvents,
    reconnect,
  };
}
