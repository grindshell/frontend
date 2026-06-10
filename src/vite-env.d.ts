/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ENDPOINT?: string;
  readonly VITE_WS_ENDPOINT?: string;
  /** "1" (offline UI-dev) or "0". */
  readonly VITE_UI_DEV?: string;
  readonly VITE_CF_TURNSTILE_SITEKEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
