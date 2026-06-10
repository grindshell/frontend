import { createSignal } from "solid-js";

// Global auth state. Module-level signals so the App gate, the game context,
// and the Settings sign-out all read/write one source of truth reactively.
//
// "Authed" means either a real session token is present, or the user chose to
// enter offline dev mode from the login screen.

const TOKEN_KEY = "grindshell.token";

const [authToken, setAuthTokenSignal] = createSignal<string | null>(
  localStorage.getItem(TOKEN_KEY),
);
const [offlineEntered, setOfflineEntered] = createSignal(false);

export { authToken, offlineEntered };

/** Store a session token and mark the client authenticated. */
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  setAuthTokenSignal(token);
}

/** Enter offline dev mode (no token, no server) from the login screen. */
export function enterOffline() {
  setOfflineEntered(true);
}

/** Sign out: drop the token and any offline session, returning to the gate. */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  setAuthTokenSignal(null);
  setOfflineEntered(false);
}

/** Whether the login gate should be bypassed. */
export function isAuthed(): boolean {
  return authToken() !== null || offlineEntered();
}
