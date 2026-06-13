import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { config } from "../lib/config";

// Cloudflare Turnstile widget, run *on demand*. The backend requires a `cfToken`
// on login/register (except in its test build), but we don't want to burn a
// challenge the moment the form appears. Instead the widget renders in
// deferred-execution mode (`execution: "execute"`, `appearance:
// "interaction-only"`) — invisible and idle until the parent calls
// `getToken()` at submit time. If Turnstile clears the visitor silently the
// promise resolves immediately; if it needs a human the widget pops into view
// and the promise resolves once they solve it.
//
// When there's no sitekey configured (pure local dev) the widget is skipped
// entirely and `getToken()` resolves with an empty token.
//
// Docs: https://developers.cloudflare.com/turnstile/

type TurnstileApi = {
  render: (el: string | HTMLElement, opts: Record<string, unknown>) => string;
  execute: (el: string | HTMLElement, opts?: Record<string, unknown>) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Imperative handle the parent uses to run the challenge at submit time. */
export type TurnstileHandle = {
  /**
   * Run the challenge and resolve with a fresh single-use token. Resolves
   * immediately when Turnstile clears the visitor without interaction; waits
   * for the user otherwise. Rejects if the challenge errors or the widget
   * isn't ready. Resolves with `""` when CAPTCHA is disabled (no sitekey).
   */
  getToken: () => Promise<string>;
};

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
  onReady: (handle: TurnstileHandle) => void;
  onError?: (code: string) => void;
}) {
  let container: HTMLDivElement | undefined;
  let widgetId: string | undefined;
  const [err, setErr] = createSignal("");

  // A challenge currently in flight (between an `execute()` call and its
  // callback). Tokens are single-use, so we never cache across submits — each
  // getToken() runs a fresh challenge.
  let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
  let pendingPromise: Promise<string> | null = null;
  // Whether the widget has run at least once (needs a reset before re-running).
  let consumed = false;

  const settleSuccess = (token: string) => {
    pending?.resolve(token);
    pending = null;
    pendingPromise = null;
  };
  const settleError = (e: Error) => {
    pending?.reject(e);
    pending = null;
    pendingPromise = null;
  };

  const getToken = (): Promise<string> => {
    if (!config.cfSitekey) return Promise.resolve(""); // disabled — empty token
    if (pendingPromise) return pendingPromise; // a challenge is already running
    if (!window.turnstile || widgetId === undefined) {
      return Promise.reject(new Error("The CAPTCHA isn't ready yet. Please try again."));
    }
    setErr("");
    pendingPromise = new Promise<string>((resolve, reject) => {
      pending = { resolve, reject };
      try {
        if (consumed) window.turnstile!.reset(widgetId!);
        consumed = true;
        window.turnstile!.execute(widgetId!);
      } catch (e) {
        settleError(e instanceof Error ? e : new Error("CAPTCHA failed to run."));
      }
    });
    return pendingPromise;
  };

  onMount(async () => {
    // Expose the handle even before the script loads — getToken() rejects
    // gracefully if it's invoked while the widget is still coming up.
    props.onReady({ getToken });

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
      // Don't run on render — wait for an explicit execute() at submit time.
      execution: "execute",
      // Stay invisible unless the challenge actually needs the user.
      appearance: "interaction-only",
      callback: (token: string) => settleSuccess(token),
      "error-callback": (code: string) => {
        setErr(`CAPTCHA error (${code}).`);
        props.onError?.(String(code));
        settleError(new Error(`CAPTCHA error (${code}).`));
      },
      // A token expired before it was used (~5 min). Force the next getToken()
      // to start a clean challenge.
      "expired-callback": () => {
        consumed = true;
        settleError(new Error("The CAPTCHA expired. Please try again."));
      },
    });
  });

  onCleanup(() => {
    if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
  });

  return (
    <div class="w-full flex flex-col items-center gap-1 py-1">
      {/* Stays mounted at all times; interaction-only keeps it invisible until needed. */}
      <div ref={container} />
      <Show when={err()}>
        <p class="text-error text-sm">{err()}</p>
      </Show>
    </div>
  );
}
