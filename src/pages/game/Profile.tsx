import { Show, createEffect, createSignal } from "solid-js";
import { useParams } from "@solidjs/router";
import { useGame } from "../../lib/game-context";
import { Icon } from "../../components/Icon";

/**
 * The minimal player profile (chat.md "Player profiles"): a username and a
 * live online flag — deliberately nothing more until the presence/visibility
 * rules are designed. Reached as `/profile` (your own) or
 * `/profile/<username>` (from a chat name click or `/whois`).
 */
export function Profile() {
  const game = useGame();
  const params = useParams<{ username?: string }>();
  const [error, setError] = createSignal<string>();

  // Look up whenever the route target or the connection changes; the request
  // clears the previous answer so a stale player never shows.
  createEffect(() => {
    const target = params.username ?? null;
    setError(undefined);
    if (!game.online()) return;
    game.requestProfile(target, (r) => setError(r ?? "lookup failed"));
  });

  const profile = () => game.world.profile;
  const isOwn = () => !params.username;
  const displayName = () => profile()?.username ?? (params.username || "Guest");

  return (
    <section class="size-full flex flex-col gap-4" data-screen-label="Profile">
      <header class="flex items-baseline gap-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Profile</h1>
        <span class="text-xs text-base-content/45">
          // {isOwn() ? "your public face" : "another player"}
        </span>
      </header>

      <Show
        when={game.online()}
        fallback={
          <div class="p-3 border border-base-300 rounded-xl bg-base-200 text-sm text-base-content/60 max-w-2xl">
            Offline — profiles need a server connection.
          </div>
        }
      >
        <Show
          when={!error()}
          fallback={
            <div class="p-3 border border-error/40 rounded-xl bg-base-200 text-sm text-error max-w-2xl">
              ✗ {error()}
            </div>
          }
        >
          <Show
            when={profile()}
            fallback={<div class="px-1 text-sm text-base-content/45">Looking up…</div>}
          >
            {(p) => (
              <div class="p-4 border border-base-300 rounded-xl bg-base-200 max-w-2xl flex items-center gap-4">
                <div class="w-14 h-14 rounded-lg bg-base-300 flex items-center justify-center text-base-content/60">
                  <Icon name="Identification" class="size-8" />
                </div>
                <div class="min-w-0">
                  <div class="text-lg font-mono truncate">{displayName()}</div>
                  <div class="flex items-center gap-1.5 text-sm text-base-content/60">
                    <span
                      class={
                        "inline-block w-2 h-2 rounded-full " +
                        (p().online ? "bg-success" : "bg-base-content/30")
                      }
                    />
                    {p().online ? "Online" : "Offline"}
                  </div>
                  {/* The account id shows only where the server sends it (chat.md
                      "Player profiles"): your own always, anyone's when staff. */}
                  <Show when={p().accountId != null}>
                    <div class="text-xs text-base-content/45 font-mono mt-0.5">
                      Account #{p().accountId}
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </Show>
      </Show>

      <p class="px-1 text-xs text-base-content/40 max-w-2xl">
        Profiles are minimal for now — a name and whether the player is around. Progression,
        titles, and the rest arrive with the player data layer.
      </p>
    </section>
  );
}
