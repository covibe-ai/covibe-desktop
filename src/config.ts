import { homedir, platform, tmpdir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export interface CovibeConfig {
  authToken?: string;
  machineId?: string;
  refreshToken?: string;
  serverUrl: string;
  autoStart: boolean;
  idleTimeoutMinutes: number;
  maxConcurrentSessions: number;
  theme: "light" | "dark" | "system";
  minimizedToTray: boolean;
}

const DEFAULT_CONFIG: CovibeConfig = {
  serverUrl: "https://api.covibe.ai",
  autoStart: false,
  idleTimeoutMinutes: 30,
  maxConcurrentSessions: 3,
  theme: "system",
  minimizedToTray: true,
};

export function getConfigDir(): string {
  const p = platform();
  let base: string;
  if (p === "darwin") {
    base = join(homedir(), "Library", "Application Support", "Covibe");
  } else if (p === "win32") {
    base = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Covibe");
  } else {
    base = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "covibe");
  }
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function loadConfig(): CovibeConfig {
  try {
    const raw = readFileSync(getConfigPath(), "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: CovibeConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

export function getMachineId(): string {
  const cfg = loadConfig();
  if (cfg.machineId) return cfg.machineId;
  const id = "covibe-" + crypto.randomUUID();
  saveConfig({ ...cfg, machineId: id });
  return id;
}
