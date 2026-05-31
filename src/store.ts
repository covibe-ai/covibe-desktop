import type { DaemonState } from "./machine/heartbeat.ts";
import type { UserInfo, Workspace, MachineInfo } from "./api/client.ts";
import type { WorkspaceStatus } from "./workspace/manager.ts";

// ── Event Types ──

export type StoreEvent =
  | "auth:changed"
  | "auth:logout"
  | "workspaces:changed"
  | "workspace:status"
  | "machine:changed"
  | "machine:heartbeat"
  | "machine:daemon"
  | "connection:changed"
  | "performance:update"
  | "tools:detected"
  | "*"
  | string;

export type StoreListener = (event: StoreEvent, data?: unknown) => void;

// ── State Shape ──

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  refreshToken: string | null;
  user: UserInfo | null;
}

export interface WorkspaceState {
  /** Each workspace with its local daemon status */
  items: WorkspaceWithStatus[];
  /** Last sync timestamp */
  lastSync: number | null;
}

export interface WorkspaceWithStatus extends Workspace {
  daemonStatus: WorkspaceStatus;
  pid: number | null;
}

export interface MachineState {
  id: string | null;
  info: MachineInfo | null;
  daemonState: DaemonState;
  connected: boolean;
  lastHeartbeat: number | null;
  reconnectAttempts: number;
}

export interface PerformanceMetrics {
  cpuUsage: number;
  memoryUsage: {
    total: number;
    used: number;
    percent: number;
  };
  uptime: number;
  timestamp: number;
}

export interface AvailableTool {
  name: string;
  label: string;
  available: boolean;
  version: string | null;
}

export interface ToolsState {
  detectedAt: string | null;
  tools: AvailableTool[];
}

export interface AppStore {
  auth: AuthState;
  workspaces: WorkspaceState;
  machine: MachineState;
  performance: PerformanceMetrics | null;
  tools: ToolsState;
}

// ── Default State ──

const DEFAULT_AUTH: AuthState = {
  isAuthenticated: false,
  token: null,
  refreshToken: null,
  user: null,
};

const DEFAULT_WORKSPACES: WorkspaceState = {
  items: [],
  lastSync: null,
};

const DEFAULT_MACHINE: MachineState = {
  id: null,
  info: null,
  daemonState: "offline",
  connected: false,
  lastHeartbeat: null,
  reconnectAttempts: 0,
};

const DEFAULT_TOOLS: ToolsState = {
  detectedAt: null,
  tools: [],
};

const DEFAULT_STORE: AppStore = {
  auth: { ...DEFAULT_AUTH },
  workspaces: { ...DEFAULT_WORKSPACES },
  machine: { ...DEFAULT_MACHINE },
  performance: null,
  tools: { ...DEFAULT_TOOLS },
};

// ── Store Implementation ──

/**
 * Simple reactive store using event emitter pattern.
 * The renderer can subscribe to specific events and read current state.
 */
class Store {
  private state: AppStore;
  private listeners: Map<string, Set<StoreListener>>;
  private wildcardListeners: Set<StoreListener>;

  constructor(initialState?: Partial<AppStore>) {
    this.state = this.mergeDefaults(initialState);
    this.listeners = new Map();
    this.wildcardListeners = new Set();
  }

  private mergeDefaults(initial?: Partial<AppStore>): AppStore {
    return {
      auth: { ...DEFAULT_AUTH, ...(initial?.auth ?? {}) },
      workspaces: { ...DEFAULT_WORKSPACES, ...(initial?.workspaces ?? {}) },
      machine: { ...DEFAULT_MACHINE, ...(initial?.machine ?? {}) },
      performance: initial?.performance ?? null,
      tools: { ...DEFAULT_TOOLS, ...(initial?.tools ?? {}) },
    };
  }

  // ── State Access ──

  /** Get the entire store state (read-only snapshot). */
  getState(): Readonly<AppStore> {
    return this.state;
  }

  /** Get a specific slice of state. */
  getSlice<K extends keyof AppStore>(key: K): Readonly<AppStore[K]> {
    return this.state[key];
  }

  // ── State Mutation ──

  /**
   * Update a slice of state and emit the corresponding event.
   */
  setSlice<K extends keyof AppStore>(
    key: K,
    value: Partial<AppStore[K]>,
    event?: StoreEvent,
  ): void {
    const previous = this.state[key];

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      this.state = {
        ...this.state,
        [key]: { ...(previous as unknown as Record<string, unknown>), ...(value as unknown as Record<string, unknown>) } as unknown as AppStore[K],
      };
    } else {
      this.state = { ...this.state, [key]: value };
    }

    const emittedEvent = event ?? `${key as string}:changed`;
    this.emit(emittedEvent, this.state[key]);
  }

  /**
   * Replace an entire slice of state.
   */
  setSliceFull<K extends keyof AppStore>(
    key: K,
    value: AppStore[K],
    event?: StoreEvent,
  ): void {
    this.state = { ...this.state, [key]: value };
    const emittedEvent = event ?? `${key as string}:changed`;
    this.emit(emittedEvent, this.state[key]);
  }

  // ── Auth Helpers ──

  setAuth(auth: Partial<AuthState>): void {
    this.setSlice("auth", auth, "auth:changed");
  }

  setUser(user: UserInfo | null): void {
    this.state = {
      ...this.state,
      auth: { ...this.state.auth, user },
    };
    this.emit("auth:changed", this.state.auth);
  }

  setLoggedOut(): void {
    this.state = this.mergeDefaults({
      performance: this.state.performance,
    });
    this.emit("auth:logout");
  }

  // ── Workspace Helpers ──

  setWorkspaces(workspaces: WorkspaceWithStatus[], lastSync?: number): void {
    this.state = {
      ...this.state,
      workspaces: {
        items: workspaces,
        lastSync: lastSync ?? Date.now(),
      },
    };
    this.emit("workspaces:changed", this.state.workspaces);
  }

  updateWorkspaceStatus(id: string, status: WorkspaceStatus, pid: number | null): void {
    const items = this.state.workspaces.items.map((ws) =>
      ws.id === id ? { ...ws, daemonStatus: status, pid } : ws,
    );
    this.state = {
      ...this.state,
      workspaces: { ...this.state.workspaces, items },
    };
    this.emit("workspace:status", { id, status, pid });
  }

  // ── Machine Helpers ──

  setMachine(machine: Partial<MachineState>): void {
    this.setSlice("machine", machine, "machine:changed");
  }

  setMachineConnection(connected: boolean): void {
    this.state = {
      ...this.state,
      machine: { ...this.state.machine, connected },
    };
    this.emit("connection:changed", connected);
  }

  setDaemonState(daemonState: DaemonState): void {
    this.state = {
      ...this.state,
      machine: { ...this.state.machine, daemonState },
    };
    this.emit("machine:daemon", daemonState);
  }

  updateHeartbeat(time: number): void {
    this.state = {
      ...this.state,
      machine: { ...this.state.machine, lastHeartbeat: time },
    };
    this.emit("machine:heartbeat", time);
  }

  // ── Performance ──

  setPerformance(metrics: PerformanceMetrics): void {
    this.state = {
      ...this.state,
      performance: metrics,
    };
    this.emit("performance:update", metrics);
  }

  // ── Tools ──

  setTools(tools: AvailableTool[], detectedAt: string): void {
    this.state = {
      ...this.state,
      tools: { tools, detectedAt },
    };
    this.emit("tools:detected", this.state.tools);
  }

  // ── Event Subscription ──

  /**
   * Subscribe to a specific event.
   * Use "*" to listen to all events.
   * Returns an unsubscribe function.
   */
  on(event: StoreEvent, listener: StoreListener): () => void {
    if (event === "*") {
      this.wildcardListeners.add(listener);
      return () => {
        this.wildcardListeners.delete(listener);
      };
    }

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  /**
   * Remove a specific listener for an event.
   */
  off(event: StoreEvent, listener: StoreListener): void {
    if (event === "*") {
      this.wildcardListeners.delete(listener);
      return;
    }
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Emit an event to all subscribers.
   */
  private emit(event: StoreEvent, data?: unknown): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          listener(event, data);
        } catch (err) {
          console.error(`[store] Error in listener for ${event}:`, err);
        }
      }
    }

    // Notify wildcard listeners
    for (const listener of this.wildcardListeners) {
      try {
        listener(event, data);
      } catch (err) {
        console.error(`[store] Error in wildcard listener:`, err);
      }
    }
  }

  /**
   * Reset the entire store to defaults.
   */
  reset(): void {
    this.state = this.mergeDefaults();
    this.emit("*", this.state);
  }

  /**
   * Get the number of registered listeners.
   */
  listenerCount(event?: StoreEvent): number {
    if (event) {
      if (event === "*") return this.wildcardListeners.size;
      return this.listeners.get(event)?.size ?? 0;
    }
    let count = this.wildcardListeners.size;
    for (const listeners of this.listeners.values()) {
      count += listeners.size;
    }
    return count;
  }
}

// ── Singleton Export ──

/**
 * Global application store instance.
 * Import this in renderer and main process to share state.
 */
export const appStore = new Store();

export default Store;