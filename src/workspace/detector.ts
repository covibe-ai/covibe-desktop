// ── Types ──

export interface DetectedTool {
  /** Canonical name (e.g., "cursor", "claude", "gemini", "opencode") */
  name: string;
  /** Display label */
  label: string;
  /** Full path to the binary */
  path: string;
  /** Version string if available */
  version: string | null;
  /** Whether the tool is currently available on this machine */
  available: boolean;
}

export interface DetectionResult {
  /** All checked tools with their availability status */
  tools: DetectedTool[];
  /** List of tool names that are available */
  available: string[];
  /** Timestamp of the detection */
  detectedAt: string;
}

// ── Tool Definitions ──

interface ToolCheck {
  name: string;
  label: string;
  binary: string;
  versionFlag: string;
  versionRegex: RegExp;
}

const TOOLS_TO_CHECK: ToolCheck[] = [
  {
    name: "cursor",
    label: "Cursor Agent",
    binary: "cursor",
    versionFlag: "--version",
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    name: "claude",
    label: "Claude Codex",
    binary: "claude",
    versionFlag: "--version",
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    name: "gemini",
    label: "Google Gemini",
    binary: "gemini",
    versionFlag: "--version",
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  {
    name: "opencode",
    label: "OpenCode",
    binary: "opencode",
    versionFlag: "--version",
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
];

// ── Cache ──

let cachedResult: DetectionResult | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

// ── Detection Logic ──

/**
 * Check if a binary is available via Bun's `which` utility.
 */
function findBinary(binary: string): string | null {
  try {
    const result = Bun.which(binary);
    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the version of a tool by running it with the version flag.
 * Uses Bun.spawnSync for a synchronous version check.
 */
function getVersionSync(binary: string, versionFlag: string, versionRegex: RegExp): string | null {
  try {
    const result = Bun.spawnSync([binary, versionFlag], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.exitCode !== 0) return null;

    const output = result.stdout.toString().trim();
    const match = output.match(versionRegex);
    return match?.[1] ?? output.split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Detect all configured vibecoding tools on this machine.
 * Checks availability via `which` and extracts version information.
 * Uses memoization within the same process tick.
 */
export async function detectTools(force = false): Promise<DetectionResult> {
  const now = Date.now();

  if (!force && cachedResult !== null && now - cacheTime < CACHE_TTL_MS) {
    return cachedResult;
  }

  const tools: DetectedTool[] = [];
  const available: string[] = [];

  for (const toolDef of TOOLS_TO_CHECK) {
    const toolPath = findBinary(toolDef.binary);

    if (toolPath) {
      const version = getVersionSync(
        toolDef.binary,
        toolDef.versionFlag,
        toolDef.versionRegex,
      );

      tools.push({
        name: toolDef.name,
        label: toolDef.label,
        path: toolPath,
        version,
        available: true,
      });

      available.push(toolDef.name);
    } else {
      tools.push({
        name: toolDef.name,
        label: toolDef.label,
        path: "",
        version: null,
        available: false,
      });
    }
  }

  const result: DetectionResult = {
    tools,
    available,
    detectedAt: new Date().toISOString(),
  };

  cachedResult = result;
  cacheTime = now;

  return result;
}

/**
 * Check if a specific tool is available.
 * Uses detection cache.
 */
export async function isToolAvailable(name: string): Promise<boolean> {
  const result = await detectTools();
  return result.available.includes(name);
}

/**
 * Get details for a specific tool.
 * Uses detection cache.
 */
export async function getTool(name: string): Promise<DetectedTool | undefined> {
  const result = await detectTools();
  return result.tools.find((t) => t.name === name);
}

/**
 * Clear the detection cache so the next call re-detects.
 */
export function clearCache(): void {
  cachedResult = null;
  cacheTime = 0;
}

/**
 * Get the list of tools that are checked, regardless of availability.
 */
export function getCheckedTools(): string[] {
  return TOOLS_TO_CHECK.map((t) => t.name);
}