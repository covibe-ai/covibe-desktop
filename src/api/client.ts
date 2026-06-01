import { loadConfig, saveConfig } from "../config.ts";
import type { CovibeConfig } from "../config.ts";

// ── Types ──

export interface OidcLoginResponse {
  access: string;
  refresh: string;
}

export interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  tier: string;
  quotas: Record<string, number>;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  members: number;
  status: "active" | "archived" | "paused";
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MachineInfo {
  id: string;
  publicKey: string;
  host: string;
  platform: string;
  createdAt: string;
}

export interface RegisterMachineRequest {
  publicKey: string;
  host: string;
  platform: string;
}

// ── Auth Token Management ──

let _accessToken: string | null = null;
let _refreshToken: string | null = null;

/**
 * Load tokens from config on first access.
 */
function loadTokens(): void {
  if (_accessToken) return;
  const cfg = loadConfig();
  _accessToken = cfg.authToken ?? null;
  _refreshToken = cfg.refreshToken ?? null;
}

/**
 * Persist current tokens to config file.
 */
function persistTokens(): void {
  const cfg = loadConfig();
  cfg.authToken = _accessToken ?? undefined;
  cfg.refreshToken = _refreshToken ?? undefined;
  saveConfig(cfg);
}

export function setTokens(access: string, refresh: string): void {
  _accessToken = access;
  _refreshToken = refresh;
  persistTokens();
}

export function clearTokens(): void {
  _accessToken = null;
  _refreshToken = null;
  const cfg = loadConfig();
  cfg.authToken = undefined;
  cfg.refreshToken = undefined;
  saveConfig(cfg);
}

export function getAccessToken(): string | null {
  loadTokens();
  return _accessToken;
}

export function getRefreshToken(): string | null {
  loadTokens();
  return _refreshToken;
}

// ── HTTP Client ──

class ApiError extends Error {
  public status: number;
  public body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_TIMEOUT = 15_000;

/**
 * Build the base URL from config, falling back to the default.
 */
function getBaseUrl(): string {
  const cfg = loadConfig();
  return cfg.serverUrl;
}

/**
 * Core request method. Injects auth header, handles JSON, and returns typed data.
 * On 401, attempts a token refresh before giving up.
 */
async function request<T>(
  method: string,
  path: string,
  options?: {
    body?: unknown;
    params?: Record<string, string | undefined>;
    timeout?: number;
  },
): Promise<T> {
  loadTokens();

  const base = getBaseUrl();
  const url = new URL(path, base);

  // Append query params, filtering out undefined values
  if (options?.params) {
    for (const [key, val] of Object.entries(options.params)) {
      if (val !== undefined) {
        url.searchParams.set(key, val);
      }
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (_accessToken) {
    headers["Authorization"] = `Bearer ${_accessToken}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options?.timeout ?? DEFAULT_TIMEOUT,
  );

  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    // ── 401 handling: attempt token refresh ──
    if (response.status === 401 && _refreshToken) {
      const refreshed = await attemptTokenRefresh();
      if (refreshed) {
        // Retry original request with new token
        headers["Authorization"] = `Bearer ${_accessToken}`;
        const retryResponse = await fetch(url.toString(), {
          method,
          headers,
          body: options?.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        if (!retryResponse.ok) {
          const retryBody = await parseResponseBody(retryResponse);
          throw new ApiError(
            retryResponse.status,
            retryResponse.statusText,
            retryBody,
          );
        }

        return parseResponseBody(retryResponse) as Promise<T>;
      }
    }

    if (!response.ok) {
      const body = await parseResponseBody(response);
      throw new ApiError(response.status, response.statusText, body);
    }

    return parseResponseBody(response) as Promise<T>;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Returns true if successful, false otherwise.
 */
async function attemptTokenRefresh(): Promise<boolean> {
  if (!_refreshToken) return false;

  try {
    const base = getBaseUrl();
    const response = await fetch(`${base}/covibe_api/v1/auth/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: _refreshToken }),
    });

    if (!response.ok) {
      clearTokens();
      return false;
    }

    const data = (await response.json()) as { access: string; refresh?: string };
    _accessToken = data.access;
    if (data.refresh) {
      _refreshToken = data.refresh;
    }
    persistTokens();
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

// ── Public API Methods ──

/**
 * Authenticate with OIDC. Send id_token and provider, receive access/refresh tokens.
 */
export async function login(
  idToken: string,
  provider: string,
): Promise<OidcLoginResponse> {
  const result = await request<OidcLoginResponse>("POST", "/covibe_api/v1/auth/oidc/login", {
    body: { id_token: idToken, provider },
  });
  setTokens(result.access, result.refresh);
  return result;
}

/**
 * Get current user profile.
 */
export async function getUser(): Promise<UserInfo> {
  return request<UserInfo>("GET", "/covibe_api/v1/users/me");
}

/**
 * List all workspaces for the authenticated user.
 */
export async function getWorkspaces(): Promise<Workspace[]> {
  return request<Workspace[]>("GET", "/covibe_api/v1/workspaces");
}

/**
 * Create a new workspace.
 */
export async function createWorkspace(data: {
  name: string;
  description?: string;
  config?: Record<string, unknown>;
}): Promise<Workspace> {
  return request<Workspace>("POST", "/covibe_api/v1/workspaces", { body: data });
}

/**
 * Update an existing workspace.
 */
export async function updateWorkspace(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    status: string;
    config: Record<string, unknown>;
  }>,
): Promise<Workspace> {
  return request<Workspace>("PATCH", `/covibe_api/v1/workspaces/${id}`, { body: data });
}

/**
 * Delete (archive) a workspace.
 */
export async function deleteWorkspace(id: string): Promise<void> {
  await request<void>("DELETE", `/covibe_api/v1/workspaces/${id}`);
}

/**
 * Register this machine with the server.
 */
export async function registerMachine(
  data: RegisterMachineRequest,
): Promise<MachineInfo> {
  return request<MachineInfo>("POST", "/covibe_api/v1/machines/register", { body: data });
}

/**
 * List all registered machines.
 */
export async function getMachines(): Promise<MachineInfo[]> {
  return request<MachineInfo[]>("GET", "/covibe_api/v1/machines");
}

/**
 * Check if the client has valid tokens (does not verify they are unexpired).
 */
export function isAuthenticated(): boolean {
  loadTokens();
  return _accessToken !== null;
}

/**
 * Log out: clear tokens and any stored key material.
 */
export function logout(): void {
  clearTokens();
}

/**
 * Expose ApiError for upstream error handling.
 */
export { ApiError };