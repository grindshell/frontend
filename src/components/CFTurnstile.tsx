import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { config } from "../lib/config";

// Cloudflare Turnstile widget. The backend requires a `cfToken` on
// login/register (except in its test build). We inject the Turnstile script on
// demand — when there's no sitekey configured (pure local dev), the widget is
// skipped entirely and the parent proceeds with an empty token.
//
// Docs: https://developers.cloudflare.com/turnstile/

type TurnstileApi = {
  render: (el: string | HTMLElement, opts: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load Turnstile script"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function CFTurnstile(props: {
  onSuccess: (token: string) => void;
  onError?: (code: string) => void;
  /** The issued token expired (~5 min); the parent should drop its copy. */
  onExpired?: () => void;
}) {
  let container: HTMLDivElement | undefined;
  let widgetId: string | undefined;
  const [err, setErr] = createSignal("");

  onMount(async () => {
    if (!config.cfSitekey) return; // disabled — parent treats CAPTCHA as not required
    try {
      await loadTurnstile();
    } catch {
      setErr("Could not load the CAPTCHA. Refresh to retry.");
      return;
    }
    if (!window.turnstile || !container) return;
    widgetId = window.turnstile.render(container, {
      sitekey: config.cfSitekey,
      callback: (token: string) => props.onSuccess(token),
      "error-callback": (code: string) => {
        setErr(`CAPTCHA error (${code}).`);
        props.onError?.(String(code));
      },
      // Tokens expire after ~5 minutes. Turnstile re-runs the challenge itself
      // (refresh-expired defaults to "auto"); meanwhile the stale token must
      // not be submitted, so tell the parent to drop it.
      "expired-callback": () => props.onExpired?.(),
    });
  });

  onCleanup(() => {
    if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
  });

  return (
    <div class="w-full flex justify-center py-2">
      <Show when={!err()} fallback={<p class="text-error text-sm">{err()}</p>}>
        <div ref={container} />
      </Show>
    </div>
  );
}
