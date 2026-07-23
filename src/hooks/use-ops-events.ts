// ============================================================
// Anna.I — useOpsEvents React Hook (Phase 2)
// Connects to the ops-events WebSocket service for real-time
// event streaming in the Ops Control Centre.
// ============================================================

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface OpsEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface UseOpsEventsOptions {
  /** Called when any event arrives */
  onEvent?: (event: OpsEvent) => void;
  /** Called for specific event types */
  handlers?: Record<string, (event: OpsEvent) => void>;
  /** Enable/disable connection (default: true) */
  enabled?: boolean;
}

interface UseOpsEventsReturn {
  /** Whether the socket is connected */
  isConnected: boolean;
  /** Number of ops staff online */
  onlineCount: number;
  /** Recent events received since connection */
  recentEvents: OpsEvent[];
  /** Manually reconnect */
  reconnect: () => void;
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useOpsEvents(options: UseOpsEventsOptions = {}): UseOpsEventsReturn {
  const { onEvent, handlers = {}, enabled = true } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [recentEvents, setRecentEvents] = useState<OpsEvent[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  const onEventRef = useRef(onEvent);

  // Keep refs up to date without triggering reconnects
  useEffect(() => {
    handlersRef.current = handlers;
    onEventRef.current = onEvent;
  }, [handlers, onEvent]);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    try {
      const socket = io("/?XTransformPort=3004", {
        transports: ["websocket"],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
        timeout: 30000,
      });
      console.log("[useOpsEvents] Socket created, connecting...");

    socket.on("connect", () => {
      console.log("[useOpsEvents] Connected!");
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("[useOpsEvents] Disconnected");
      setIsConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.warn("[useOpsEvents] Connect error:", err.message);
    });

    // Online count
    socket.on("ops:online", (data: { count: number }) => {
      setOnlineCount(data.count);
    });

    // Recent events (catch-up on connect)
    socket.on("events:recent", (events: OpsEvent[]) => {
      if (events.length > 0) {
        setRecentEvents((prev) => {
          // Deduplicate by timestamp + type
          const existing = new Set(prev.map((e) => `${e.type}:${e.timestamp}`));
          const newEvents = events.filter(
            (e) => !existing.has(`${e.type}:${e.timestamp}`)
          );
          return [...newEvents, ...prev].slice(-100);
        });
      }
    });

    // Generic event handler
    socket.on("event", (event: OpsEvent) => {
      setRecentEvents((prev) => [...prev, event].slice(-100));

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

    // Type-specific event handlers registered via ref
    const registeredTypes = Object.keys(handlersRef.current);
    for (const type of registeredTypes) {
      socket.on(`event:${type}`, (event: OpsEvent) => {
        const currentHandlers = handlersRef.current;
        const typedHandler = currentHandlers[type];
        if (typedHandler) {
          typedHandler(event);
        }
      });
    }

    socketRef.current = socket;
    } catch (err) {
      console.error("[useOpsEvents] Failed to create socket:", err);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setOnlineCount(0);
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
    onlineCount,
    recentEvents,
    reconnect,
  };
}
