"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/http";
import { loadWorkspace } from "@/lib/storage";
import type { WorkspaceData } from "@/lib/model";
export function useLiveWorkspace({
  orgId,
  data,
  enabled,
  busy,
  onSnapshot,
  onFailure,
}: {
  orgId: string;
  data: WorkspaceData | null;
  enabled: boolean;
  busy: boolean;
  onSnapshot: (data: WorkspaceData) => void;
  onFailure: (message: string) => void;
}) {
  const latest = useRef({ data, onSnapshot, onFailure });
  latest.current = { data, onSnapshot, onFailure };
  const [status, setStatus] = useState("Connecting…");
  useEffect(() => {
    if (!enabled || !orgId || busy) return;
    let closed = false,
      socket: WebSocket | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      attempts = 0,
      fetching = false,
      dirty = false;
    async function refresh() {
      dirty = true;
      if (fetching) return;
      fetching = true;
      try {
        while (dirty && !closed) {
          dirty = false;
          const next = await loadWorkspace();
          if (!closed) latest.current.onSnapshot(next);
        }
      } catch (e) {
        if (!closed)
          latest.current.onFailure(
            e instanceof Error
              ? e.message
              : "Live changes could not be loaded. Reload the workspace.",
          );
      } finally {
        fetching = false;
      }
    }
    function reconnect() {
      if (closed) return;
      setStatus("Reconnecting…");
      timer = setTimeout(
        connect,
        Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) +
          Math.random() * 300,
      );
    }
    async function connect() {
      try {
        const { ticket } = await request<{ ticket: string }>(
          `/api/organizations/${orgId}/realtime-ticket`,
          {},
        );
        if (closed) return;
        const sameOrigin = new URL("/ws", window.location.origin);
        sameOrigin.protocol =
          window.location.protocol === "https:" ? "wss:" : "ws:";
        const endpoint =
          process.env.NEXT_PUBLIC_REALTIME_URL ??
          (process.env.NODE_ENV === "production"
            ? sameOrigin.href
            : "ws://127.0.0.1:4001/ws");
        socket = new WebSocket(endpoint);
        const timeout = setTimeout(() => socket?.close(), 10000);
        socket.onopen = () =>
          socket?.send(
            JSON.stringify({
              ticket,
              afterRevision:
                latest.current.data?.access.find((a) => a.orgId === orgId)
                  ?.revision ?? 0,
            }),
          );
        socket.onmessage = (event) => {
          if (closed) return;
          clearTimeout(timeout);
          try {
            const message = JSON.parse(event.data);
            if (message.type === "changes") {
              attempts = 0;
              setStatus("Live workspace");
              void refresh();
            } else if (message.type === "denied") {
              void refresh();
              socket?.close();
            } else socket?.close();
          } catch {
            socket?.close();
          }
        };
        socket.onclose = () => {
          clearTimeout(timeout);
          reconnect();
        };
        socket.onerror = () => socket?.close();
      } catch {
        if (!closed) {
          void refresh();
          reconnect();
        }
      }
    }
    void connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [orgId, enabled, busy]);
  return status;
}
