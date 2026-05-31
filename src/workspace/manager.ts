import { getWorkspaces } from "../api/client.ts";
import type { Workspace } from "../api/client.ts";

// ── Types ──

export type WorkspaceStatus = "running" | "stopped" | "starting" | "stopping" | "error";

export interface ManagedWorkspace {
  workspace: Workspace;
  status: WorkspaceStatus;
  pid: number | null;
  startedAt: number | null;
  stoppedAt: number | null;
}

export type WorkspaceChangeListener = (
  workspaces: Map<string, ManagedWorkspace>,
) => void;

// ── Configuration ──

const POLL_INTERVAL_MS = 30_000;
const SIGTERM_TIMEOUT_MS = 10_000;
const HAPPY_CLI_COMMAND = "happy";

// ── State ──

const managedWorkspaces = new Map<string, ManagedWorkspace>();

/**
 * Map of workspace ID to subprocess handle.
 * Bun.spawn() returns Subprocess, not ChildProcess.
 */
const childProcesses = new Map<string, import("bun").Subprocess>();

const changeListeners = new Set<WorkspaceChangeListener>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ── Helpers ──

function shouldBeRunning(workspace: Workspace): boolean {
  return workspace.status === "active";
}

// ── Child Process Management ──

/**
 * Spawn a happy CLI process for a workspace.
 * Returns the Subprocess handle.
 */
function spawnHappyProcess(workspaceId: string): import("bun").Subprocess | null {
  const managed = managedWorkspaces.get(workspaceId);
  if (!managed) return null;

  managed.status = "starting";
  notifyListeners();

  try {
    const proc = Bun.spawn([
      HAPPY_CLI_COMMAND,
      "session",
      "start",
      "--workspace",
      workspaceId,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        COVIBE_WORKSPACE_ID: workspaceId,
      },
    });

    childProcesses.set(workspaceId, proc);
    managed.pid = proc.pid;
    managed.startedAt = Date.now();
    managed.status = "running";
    managed.stoppedAt = null;

    // Handle process exit
    proc.exited.then((exitCode: number) => {
      console.log(
        `[workspace-manager] Process for ${workspaceId} exited with code ${exitCode}`,
      );
      childProcesses.delete(workspaceId);
      managed.pid = null;
      managed.status = "stopped";
      managed.stoppedAt = Date.now();
      notifyListeners();
    });

    // Capture stdout for logging
    const readStdout = async () => {
      try {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          console.log(`[happy:${workspaceId}] ${decoder.decode(value)}`);
        }
      } catch {
        // stdout stream ended or errored
      }
    };
    readStdout();

    // Capture stderr for logging
    const readStderr = async () => {
      try {
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          console.error(`[happy:${workspaceId}:err] ${decoder.decode(value)}`);
        }
      } catch {
        // stderr stream ended or errored
      }
    };
    readStderr();

    notifyListeners();
    return proc;
  } catch (err) {
    console.error(
      `[workspace-manager] Failed to spawn happy for ${workspaceId}:`,
      err,
    );
    managed.status = "error";
    managed.pid = null;
    notifyListeners();
    return null;
  }
}

/**
 * Kill a happy CLI process for a workspace.
 * Sends SIGTERM first, then SIGKILL after a timeout.
 */
async function killHappyProcess(workspaceId: string): Promise<void> {
  const proc = childProcesses.get(workspaceId);
  const managed = managedWorkspaces.get(workspaceId);

  if (!proc) {
    if (managed) {
      managed.status = "stopped";
      managed.pid = null;
      managed.stoppedAt = Date.now();
      notifyListeners();
    }
    return;
  }

  if (managed) {
    managed.status = "stopping";
    notifyListeners();
  }

  try {
    // SIGTERM first - graceful shutdown
    proc.kill("SIGTERM");

    // Wait up to SIGTERM_TIMEOUT_MS for the process to exit
    const exited = await Promise.race([
      proc.exited,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), SIGTERM_TIMEOUT_MS),
      ),
    ]);

    if (exited === null) {
      // Process did not exit in time, force kill
      console.warn(
        `[workspace-manager] Process ${workspaceId} did not exit gracefully, sending SIGKILL`,
      );
      proc.kill("SIGKILL");
      await proc.exited;
    }
  } catch (err) {
    console.error(
      `[workspace-manager] Error killing process for ${workspaceId}:`,
      err,
    );
  }

  childProcesses.delete(workspaceId);

  if (managed) {
    managed.pid = null;
    managed.status = "stopped";
    managed.stoppedAt = Date.now();
    notifyListeners();
  }
}

// ── Sync Logic ──

/**
 * Pull workspace list from server and reconcile with local state.
 * Spawns happy processes for workspaces that should be running but aren't.
 * Kills processes for workspaces that should be stopped.
 */
async function syncWorkspaces(): Promise<void> {
  try {
    const serverWorkspaces = await getWorkspaces();

    // Build a set of server workspace IDs for quick lookup
    const serverIds = new Set(serverWorkspaces.map((ws) => ws.id));

    // Remove local workspaces that no longer exist on server
    for (const [id, managed] of managedWorkspaces.entries()) {
      if (!serverIds.has(id) && managed.status !== "stopped") {
        console.log(
          `[workspace-manager] Workspace ${id} removed from server, killing process`,
        );
        await killHappyProcess(id);
        managedWorkspaces.delete(id);
      }
    }

    // Process each server workspace
    for (const workspace of serverWorkspaces) {
      const existing = managedWorkspaces.get(workspace.id);

      if (!existing) {
        // New workspace from server
        const managed: ManagedWorkspace = {
          workspace,
          status: "stopped",
          pid: null,
          startedAt: null,
          stoppedAt: null,
        };
        managedWorkspaces.set(workspace.id, managed);
      } else {
        // Update workspace data
        existing.workspace = workspace;
      }

      const managed = managedWorkspaces.get(workspace.id)!;

      if (shouldBeRunning(workspace) && managed.status === "stopped") {
        console.log(
          `[workspace-manager] Starting happy for workspace ${workspace.id}`,
        );
        spawnHappyProcess(workspace.id);
      } else if (!shouldBeRunning(workspace) && managed.status === "running") {
        console.log(
          `[workspace-manager] Stopping happy for workspace ${workspace.id}`,
        );
        await killHappyProcess(workspace.id);
      }
    }

    notifyListeners();
  } catch (err) {
    console.error("[workspace-manager] Sync failed:", err);
  }
}

/**
 * Notify all registered change listeners.
 */
function notifyListeners(): void {
  for (const listener of changeListeners) {
    try {
      listener(managedWorkspaces);
    } catch (err) {
      console.error("[workspace-manager] Listener error:", err);
    }
  }
}

// ── Public API ──

/**
 * Start the workspace manager: begins polling the server and reconciling.
 */
export function start(): void {
  if (isRunning) {
    console.log("[workspace-manager] Already running");
    return;
  }

  isRunning = true;
  console.log("[workspace-manager] Starting workspace manager");

  // Immediate first sync
  syncWorkspaces().catch(console.error);

  // Periodic polling
  pollTimer = setInterval(() => {
    syncWorkspaces().catch(console.error);
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the workspace manager: kills all managed processes and stops polling.
 */
export async function stop(): Promise<void> {
  if (!isRunning) return;

  isRunning = false;
  console.log("[workspace-manager] Stopping workspace manager");

  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Kill all running processes
  const killPromises: Promise<void>[] = [];
  for (const [id, managed] of managedWorkspaces.entries()) {
    if (managed.status === "running" || managed.status === "starting") {
      killPromises.push(killHappyProcess(id));
    }
  }

  if (killPromises.length > 0) {
    await Promise.all(killPromises);
  }

  managedWorkspaces.clear();
  childProcesses.clear();
  notifyListeners();
}

/**
 * Get a read-only snapshot of all managed workspaces.
 */
export function getWorkspaceList(): ManagedWorkspace[] {
  return Array.from(managedWorkspaces.values());
}

/**
 * Get a specific managed workspace by ID.
 */
export function getWorkspace(id: string): ManagedWorkspace | undefined {
  return managedWorkspaces.get(id);
}

/**
 * Subscribe to workspace state changes.
 * Returns an unsubscribe function.
 */
export function onChange(listener: WorkspaceChangeListener): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/**
 * Check if the manager is currently running.
 */
export function isActive(): boolean {
  return isRunning;
}

/**
 * Force a workspace to start or stop regardless of server state.
 * Useful for manual overrides from the settings UI.
 */
export async function forceStart(workspaceId: string): Promise<boolean> {
  const managed = managedWorkspaces.get(workspaceId);
  if (!managed) return false;
  if (managed.status === "running" || managed.status === "starting") return true;

  const proc = spawnHappyProcess(workspaceId);
  return proc !== null;
}

export async function forceStop(workspaceId: string): Promise<void> {
  const managed = managedWorkspaces.get(workspaceId);
  if (!managed) return;
  if (managed.status === "stopped" || managed.status === "stopping") return;

  await killHappyProcess(workspaceId);
}