import { For, Show, createEffect, createSignal, onMount } from "solid-js";
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
  const [promotee, setPromotee] = createSignal("");
  const [modResult, setModResult] = createSignal<{ ok: boolean; text: string }>();

  // Load the moderator listing once connected as an admin (chat.md
  // "Moderator designation").
  createEffect(() => {
    if (game.online() && game.world.isAdmin) game.listModerators();
  });

  const designate = (username: string, moderator: boolean) => {
    setModResult(undefined);
    game.setModerator(username, moderator, {
      onSuccess: (msg) => {
        setModResult({ ok: true, text: msg ?? "designation updated" });
        setPromotee("");
        game.listModerators();
      },
      onError: (reason) => setModResult({ ok: false, text: reason ?? "failed" }),
    });
  };

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

        {/* Player-moderator designation (chat.md "Moderator designation") —
            also reachable as the /promote and /unpromote chat commands. */}
        <div class="p-3 border border-base-300 rounded-xl bg-base-200 max-w-2xl">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Player moderators</legend>
            <Show
              when={game.world.moderators}
              fallback={
                <p class="text-sm text-base-content/45">
                  {game.online() ? "Loading designations…" : "Offline — connect to a server to manage moderators."}
                </p>
              }
            >
              {(mods) => (
                <Show
                  when={mods().length > 0}
                  fallback={<p class="text-sm text-base-content/45">No player moderators designated.</p>}
                >
                  <ul class="space-y-1">
                    <For each={mods()}>
                      {(name) => (
                        <li class="flex items-center gap-3 text-sm">
                          <span class="font-mono">{name}</span>
                          <button
                            class="btn btn-xs btn-outline"
                            disabled={!game.online()}
                            onClick={() => designate(name, false)}
                          >
                            Unpromote
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              )}
            </Show>
            <form
              class="flex items-center gap-2 mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const name = promotee().trim();
                if (name) designate(name, true);
              }}
            >
              <input
                type="text"
                class="input input-sm grow font-mono"
                placeholder="username"
                value={promotee()}
                onInput={(e) => setPromotee(e.currentTarget.value)}
              />
              <button
                type="submit"
                class="btn btn-sm btn-primary"
                disabled={!game.online() || !promotee().trim()}
              >
                Promote
              </button>
            </form>
            <p class="label text-base-content/45">
              Moderators hold the server-wide chat-moderation powers. Promotions run as root and
              are logged centrally against you.
            </p>
            <Show when={modResult()}>
              {(r) => (
                <span class={"text-sm " + (r().ok ? "text-success" : "text-error")}>
                  {r().text}
                </span>
              )}
            </Show>
          </fieldset>
        </div>
      </Show>
    </section>
  );
}
