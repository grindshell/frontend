// REST client for the backend's `/api` surface: `/login` and `/register` (both
// return a plain-text UUID session token) and `/status` (the unauthenticated
// pre-login status payload). See backend/crates/server/src/api.rs.

import { config } from "./config";
import type { ServerStatus } from "./protocol";

export type AuthError = {
  kind: "unauthorized" | "bad_request" | "conflict" | "rate_limited" | "server" | "network";
  status?: number;
  /** For rate_limited, the retry-after in ms the server reported (body text). */
  retryAfterMs?: number;
  message: string;
};

export type RegisterFields = {
  username: string;
  password: string;
  email?: string;
};

function authError(status: number, body: string): AuthError {
  switch (status) {
    case 400:
      return { kind: "bad_request", status, message: "Invalid registration details." };
    case 401:
      return { kind: "unauthorized", status, message: "Incorrect username or password." };
    case 409:
      return { kind: "conflict", status, message: "That username is already taken." };
    case 429:
      return {
        kind: "rate_limited",
        status,
        retryAfterMs: Number(body) || undefined,
        message: "Too many attempts — please wait a moment.",
      };
    default:
      return { kind: "server", status, message: `Server error (${status}).` };
  }
}

async function postForToken(path: string, payload: unknown): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${config.apiEndpoint}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw { kind: "network", message: `Could not reach the server: ${e}` } satisfies AuthError;
  }
  if (!res.ok) {
    throw authError(res.status, await res.text().catch(() => ""));
  }
  return (await res.text()).trim();
}

/**
 * Log in with username + password, returning a session token (UUID).
 * Passing an existing `token` takes the refresh path (bumps its expiry).
 */
export function login(
  cfToken: string,
  username: string,
  password: string,
  token?: string,
): Promise<string> {
  return postForToken("/login", { cfToken, username, password, token });
}

/**
 * Register an account, returning a session token (UUID). With no `fields`,
 * creates a guest account.
 */
export function register(cfToken: string, fields?: RegisterFields): Promise<string> {
  return postForToken("/register", { cfToken, ...fields });
}

async function apiGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.apiEndpoint}${path}`);
  } catch (e) {
    throw { kind: "network", message: `Could not reach the server: ${e}` } satisfies AuthError;
  }
  if (!res.ok) {
    throw authError(res.status, await res.text().catch(() => ""));
  }
  return (await res.json()) as T;
}

/**
 * Fetch the pre-login status payload (MOTD + players online) for the login
 * screen. Unauthenticated; the backend serves a coarsely-cached snapshot.
 */
export function fetchStatus(): Promise<ServerStatus> {
  return apiGet<ServerStatus>("/status");
}
