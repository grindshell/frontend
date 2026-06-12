import { Show, createSignal, onMount } from "solid-js";
import { useGame } from "../../lib/game-context";
import { fetchStatus } from "../../lib/api";
import { config } from "../../lib/config";

/**
 * Server-operator tools. Reached from the Admin sidebar section, which only
 * appears for designated admins (`world.isAdmin`). The page itself is also gated
 * so navigating here directly as a non-admin shows a notice rather than an
 * action that would get the connection severed (server-status.md "Admin
 * commands"). The first tool is setting the message of the day.
 */
export function Admin() {
  const game = useGame();
  const [body, setBody] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<{ ok: boolean; text: string }>();

  // Prefill with the current MOTD (the unauthenticated status read). Offline → skip.
  onMount(async () => {
    if (config.uiDev) return;
    try {
      const status = await fetchStatus();
      if (!body()) setBody(status.motd);
    } catch {
      // Best-effort prefill; leave the field empty on failure.
    }
  });

  const save = () => {
    setBusy(true);
    setResult(undefined);
    game.setMotd(body(), {
      onSuccess: () => {
        setBusy(false);
        setResult({ ok: true, text: "Message of the day updated." });
      },
      onError: (reason) => {
        setBusy(false);
        setResult({ ok: false, text: reason ?? "Failed to update." });
      },
    });
  };

  return (
    <section class="size-full flex flex-col gap-4" data-screen-label="Admin">
      <header class="flex items-baseline gap-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Admin</h1>
        <span class="text-xs text-base-content/45">// server operator tools</span>
      </header>

      <Show
        when={game.world.isAdmin}
        fallback={
          <div class="p-3 border border-base-300 rounded-xl bg-base-200 text-sm text-base-content/60 max-w-2xl">
            This area is for designated server admins. Your account isn't on the sudoers list.
          </div>
        }
      >
        <div class="p-3 border border-base-300 rounded-xl bg-base-200 max-w-2xl">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Message of the day</legend>
            <textarea
              class="textarea w-full h-32 font-mono text-sm"
              placeholder="Shown on the login screen. Leave empty to clear."
              value={body()}
              onInput={(e) => setBody(e.currentTarget.value)}
            />
            <p class="label text-base-content/45">
              Stored centrally and shown to everyone on the login screen. Carried out as root and
              logged.
            </p>
            <div class="flex items-center gap-3 mt-2">
              <button
                class="btn btn-sm btn-primary"
                disabled={busy() || !game.online()}
                onClick={save}
              >
                <Show when={busy()} fallback="Save">
                  <span class="loading loading-spinner loading-xs" />
                </Show>
              </button>
              <Show when={!game.online()}>
                <span class="text-xs text-base-content/45">
                  Offline — connect to a server to edit.
                </span>
              </Show>
              <Show when={result()}>
                {(r) => (
                  <span class={"text-sm " + (r().ok ? "text-success" : "text-error")}>
                    {r().text}
                  </span>
                )}
              </Show>
            </div>
          </fieldset>
        </div>
      </Show>
    </section>
  );
}
