// ============================================================
// Anna.I — useOpsEvents React Hook (Phase 2)
// Connects to the ops-events WebSocket service for real-time
// event streaming in the Ops Control Centre.
// ============================================================

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { isAuthRejection, fetchEventToken } from "@/hooks/socket-auth";

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
  // FIX-1b: auth fallback / log-once state (see socket-auth.ts)
  const authFallbackArmedRef = useRef(true);
  const connectErrorLoggedRef = useRef(false);
  const fallbackLoggedRef = useRef(false);
  // Latest connect callback, so the auth-fallback path can re-enter connect
  // without a self-referencing closure.
  const connectRef = useRef<((eventToken?: string) => void) | null>(null);

  // Keep refs up to date without triggering reconnects
  useEffect(() => {
    handlersRef.current = handlers;
    onEventRef.current = onEvent;
  }, [handlers, onEvent]);

  const connect = useCallback((eventToken?: string) => {
    if (socketRef.current?.connected) return;

    try {
      // NOTE: transports must include "polling" as a fallback. WebSocket-only
      // connections fail through the Caddy gateway (port 81) when the WS upgrade
      // handshake is delayed or dropped — polling falls back gracefully and
      // then upgrades to websocket once the channel is established.
      const socket = io("/?XTransformPort=3004", {
        transports: ["polling", "websocket"],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
        timeout: 30000,
        auth: {
          type: "ops",
          // FIX-1b: the service verifies the ops session cookie on the
          // handshake (same-origin, forwarded by the gateway) and joins the
          // socket into the ops broadcast room. eventToken is the short-lived
          // fallback from /api/events/token, used only when the cookie was
          // unavailable.
          ...(eventToken ? { token: eventToken } : {}),
        },
      });
      console.log("[useOpsEvents] Socket created, connecting...");

    socket.on("connect", () => {
      console.log("[useOpsEvents] Connected!");
      setIsConnected(true);
      // Re-arm the one-shot auth fallback + log-once flags for the NEXT
      // connection lifecycle (e.g. a token expiring after 5 minutes).
      authFallbackArmedRef.current = true;
      connectErrorLoggedRef.current = false;
    });

    socket.on("disconnect", () => {
      console.log("[useOpsEvents] Disconnected");
      setIsConnected(false);
    });

    socket.on("connect_error", (err) => {
      // FIX-1b: the service rejects unauthenticated handshakes with an
      // "unauthorized..." error. Socket.io does NOT auto-reconnect after
      // a middleware rejection, so there is no reconnect spam — we get
      // exactly one shot at a token fallback per connection lifecycle.
      if (authFallbackArmedRef.current && isAuthRejection(err)) {
        authFallbackArmedRef.current = false;
        socket.disconnect();
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        fetchEventToken().then((token) => {
          if (token) {
            connectRef.current?.(token);
          } else if (!fallbackLoggedRef.current) {
            fallbackLoggedRef.current = true;
            console.warn(
              "[useOpsEvents] Auth fallback failed — realtime updates disabled for this session"
            );
          }
        });
        return;
      }
      // Other errors (network, service down): socket.io retries with
      // backoff on its own — log once per lifecycle to avoid spam.
      if (!connectErrorLoggedRef.current) {
        connectErrorLoggedRef.current = true;
        console.warn("[useOpsEvents] Connect error:", err.message);
      }
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

  // Keep the latest connect callback reachable from the fallback path
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

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
    setTimeout(() => connect(), 500);
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
