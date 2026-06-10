// Runtime client configuration, read from Vite env vars (see .env.example).
//
// `uiDev` mirrors the old client's VITE_UI_DEV escape hatch: when set, the
// client runs fully offline — no REST calls, no WebSocket — so the UI is usable
// in preview / Storybook without a running backend. Chat then echoes locally.

const env = import.meta.env;

export type AppConfig = {
  /** REST base, e.g. `http://localhost:8080/api`. */
  apiEndpoint: string;
  /** WebSocket URL, e.g. `ws://localhost:8080/ws`. */
  wsEndpoint: string;
  /** Offline UI-dev mode: no network, chat echoes locally. */
  uiDev: boolean;
  /** Cloudflare Turnstile sitekey (login/register CAPTCHA). */
  cfSitekey?: string;
};

export const config: AppConfig = {
  apiEndpoint: env.VITE_API_ENDPOINT ?? "http://localhost:8080/api",
  wsEndpoint: env.VITE_WS_ENDPOINT ?? "ws://localhost:8080/ws",
  // Default to offline: there is no auth/login UI ported yet and no backend in
  // preview. Set VITE_UI_DEV=0 (and provide a token) to attempt a real connection.
  uiDev: env.VITE_UI_DEV === undefined ? true : env.VITE_UI_DEV === "1",
  cfSitekey: env.VITE_CF_TURNSTILE_SITEKEY,
};
