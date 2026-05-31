import { io, Socket } from "socket.io-client";
import { loadConfig } from "../config.ts";
import { getAccessToken } from "../api/client.ts";

// ── Types ──

export type DaemonState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "error"
  | "offline";

export interface RpcSpawnSessionParams {
  sessionId: string;
  workspaceId: string;
  userId: string;
  config?: Record<string, unknown>;
}

export interface RpcKillSessionParams {
  sessionId: string;
  reason?: string;
}

export interface RpcRequestShutdownParams {
  reason?: string;
  delayMs?: number;
}

export type RpcMethod =
  | "spawnSession"
  | "killSession"
  | "requestShutdown";

export interface RpcRequest {
  method: RpcMethod;
  params: RpcSpawnSessionParams | RpcKillSessionParams | RpcRequestShutdownParams;
  requestId?: string;
}

export interface HeartbeatCallbacks {
  onSpawnSession: (params: RpcSpawnSessionParams) => Promise<void>;
  onKillSession: (params: RpcKillSessionParams) => Promise<void>;
  onRequestShutdown: (params: RpcRequestShutdownParams) => Promise<void>;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onError?: (error: Error) => void;
}

export interface HeartbeatState {
  connected: boolean;
  daemonState: DaemonState;
  lastHeartbeat: number | null;
  reconnectAttempts: number;
}

// ── Socket.IO Connection Manager ──

const HAPPY_SERVER_URL = "http://localhost:3005";
const HEARTBEAT_INTERVAL_MS = 60_000;
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;

let socket: Socket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let callbacks: HeartbeatCallbacks | null = null;

/**
 * Current heartbeat state, observable externally.
 */
export const state: HeartbeatState = {
  connected: false,
  daemonState: "offline",
  lastHeartbeat: null,
  reconnectAttempts: 0,
};

/**
 * Connect to the happy-server via Socket.IO.
 * Uses bearer token from the API client for authentication.
 */
export function connect(cbs: HeartbeatCallbacks): Socket {
  callbacks = cbs;

  const token = getAccessToken();
  if (!token) {
    throw new Error(
      "Cannot connect to happy-server: no auth token available. Authenticate first.",
    );
  }

  if (socket?.connected) {
    console.log("[heartbeat] Already connected, disconnecting first");
    disconnect();
  }

  const serverUrl = loadConfig().serverUrl ?? HAPPY_SERVER_URL;

  socket = io(serverUrl, {
    path: "/ws/socket.io",
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectionDelay: RECONNECT_DELAY_MS,
    timeout: 10_000,
    forceNew: true,
  });

  // ── Connection Events ──

  socket.on("connect", () => {
    console.log("[heartbeat] Connected to happy-server");
    state.connected = true;
    state.reconnectAttempts = 0;
    state.daemonState = "idle";
    startHeartbeat();
    callbacks?.onConnected?.();
  });

  socket.on("disconnect", (reason: string) => {
    console.log(`[heartbeat] Disconnected: ${reason}`);
    state.connected = false;
    state.daemonState = "offline";
    stopHeartbeat();
    callbacks?.onDisconnected?.(reason);
  });

  socket.on("connect_error", (err: Error) => {
    console.error("[heartbeat] Connection error:", err.message);
    state.reconnectAttempts++;
    callbacks?.onError?.(err);
  });

  socket.on("error", (err: Error) => {
    console.error("[heartbeat] Socket error:", err.message);
    callbacks?.onError?.(err);
  });

  // ── RPC Commands ──

  socket.on("rpc-request", async (data: RpcRequest) => {
    console.log(`[heartbeat] Received RPC: ${data.method}`, data.params);

    try {
      switch (data.method) {
        case "spawnSession":
          state.daemonState = "starting";
          await callbacks?.onSpawnSession(
            data.params as RpcSpawnSessionParams,
          );
          state.daemonState = "running";
          break;

        case "killSession":
          state.daemonState = "stopping";
          await callbacks?.onKillSession(
            data.params as RpcKillSessionParams,
          );
          state.daemonState = "idle";
          break;

        case "requestShutdown":
          await callbacks?.onRequestShutdown(
            data.params as RpcRequestShutdownParams,
          );
          break;

        default: {
          const _exhaustive: never = data.method;
          console.warn(`[heartbeat] Unknown RPC method: ${_exhaustive}`);
        }
      }
    } catch (err) {
      console.error(
        `[heartbeat] Error handling RPC ${data.method}:`,
        err,
      );
      state.daemonState = "error";
      callbacks?.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return socket;
}

/**
 * Disconnect from the happy-server and clean up timers.
 */
export function disconnect(): void {
  stopHeartbeat();

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  state.connected = false;
  state.daemonState = "offline";
  state.lastHeartbeat = null;
  state.reconnectAttempts = 0;
  callbacks = null;
}

/**
 * Send a machine-alive heartbeat to the server.
 * Call this periodically (e.g., every 60 seconds via startHeartbeat).
 */
export function sendHeartbeat(): void {
  if (!socket?.connected) {
    console.warn("[heartbeat] Cannot send heartbeat: not connected");
    return;
  }

  const machineId = loadConfig().machineId;
  if (!machineId) {
    console.warn("[heartbeat] Cannot send heartbeat: no machineId configured");
    return;
  }

  const payload = {
    machineId,
    time: new Date().toISOString(),
  };

  socket.emit("machine-alive", payload);
  state.lastHeartbeat = Date.now();
}

/**
 * Update and emit the current daemon state to the server.
 */
export function updateDaemonState(newState: DaemonState): void {
  state.daemonState = newState;

  if (socket?.connected) {
    socket.emit("machine-update-state", { daemonState: newState });
  }
}

/**
 * Start the periodic heartbeat interval.
 */
function startHeartbeat(): void {
  stopHeartbeat();
  sendHeartbeat(); // Send immediately on connect
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the periodic heartbeat interval.
 */
function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Get the underlying Socket.IO socket instance (for advanced use).
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Check if the heartbeat client is currently connected.
 */
export function isConnected(): boolean {
  return socket?.connected ?? false;
}