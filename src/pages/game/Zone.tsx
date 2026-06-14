import { createEffect, createSignal, For, Show } from "solid-js";
import { useGame } from "../../lib/game-context";
import type { BossOptionView, CombatLobbyView } from "../../lib/protocol";

// The Zone page (combat.md "Active combat" / zones-and-travel.md): the
// moment-to-moment life of the player's current zone — who else is present, an
// activity log to interact with the zone, and the available active actions (the
// bosses that can be roused) or the current fight if one is in progress. The MVP
// surface is **active combat only**: a player rouses a boss using a resource
// (the host's entry cost), others present in the zone can join the lobby, and
// each Attack resolves a turn against the shared boss. Skills/items come later.
//
// All of this needs live server state, so offline it shows empty states rather
// than invented data (frontend CLAUDE.md §6/§7).

/** General-resource id → the short label the sidebar resources view uses. */
const RES_LABEL: Record<string, string> = {
  bio: "BIO",
  met: "MET",
  ele: "ELE",
  liq: "LIQ",
};
const resLabel = (id: string) => RES_LABEL[id] ?? id.toUpperCase();

/** A horizontal HP bar (current / max) with a label. */
function HpBar(props: { label: string; hp: number; max: number; tone: string }) {
  const pct = () => (props.max > 0 ? Math.max(0, Math.min(100, (props.hp / props.max) * 100)) : 0);
  return (
    <div class="w-full">
      <div class="flex justify-between text-[11px] text-base-content/55 mb-0.5">
        <span>{props.label}</span>
        <span class="font-mono">
          {Math.max(0, props.hp)} / {props.max}
        </span>
      </div>
      <div class="h-2 w-full rounded bg-base-300 overflow-hidden">
        <div class={"h-full transition-[width] " + props.tone} style={{ width: `${pct()}%` }} />
      </div>
    </div>
  );
}

/** The players-present panel: co-presence at username granularity. */
function PlayersHere() {
  const game = useGame();
  return (
    <div class="border border-base-300 rounded p-3">
      <h2 class="text-sm font-semibold mb-2">
        Players here
        <span class="ml-2 text-xs text-base-content/45 font-normal">
          ({game.world.zonePlayers.length})
        </span>
      </h2>
      <Show
        when={game.world.zonePlayers.length > 0}
        fallback={<p class="text-xs text-base-content/40">— nobody else is around —</p>}
      >
        <ul class="space-y-1 text-sm">
          <For each={game.world.zonePlayers}>
            {(p) => (
              <li class="flex items-center justify-between">
                <span class="truncate">{p.username}</span>
                <Show when={p.inCombat}>
                  <span class="badge badge-xs badge-error">in combat</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

/** The in-progress fight view: shared boss + roster, your pool, Attack / Leave. */
function FightView() {
  const game = useGame();
  const combat = () => game.world.combat!;
  const [err, setErr] = createSignal<string | null>(null);
  // A short local lockout mirroring the server's 1s rate limit, so the Attack
  // button reads as on cooldown right after a swing.
  const [cooling, setCooling] = createSignal(false);

  const attack = () => {
    setErr(null);
    setCooling(true);
    setTimeout(() => setCooling(false), 1000);
    game.combatAttack(combat().instance, (reason) => setErr(reason ?? "could not attack"));
  };

  return (
    <div class="border border-base-300 rounded p-3 space-y-3">
      <div class="flex items-baseline justify-between">
        <h2 class="text-sm font-semibold">
          {combat().boss.name}
          <Show when={combat().youAreHost}>
            <span class="ml-2 badge badge-xs badge-primary">host</span>
          </Show>
        </h2>
        <span class="text-xs text-base-content/45 font-mono">
          contribution {combat().yourContribution}
        </span>
      </div>

      <HpBar label="Boss" hp={combat().boss.hp} max={combat().boss.maxHp} tone="bg-error" />
      <HpBar
        label="Your formation"
        hp={combat().yourFormationHp}
        max={combat().yourFormationMaxHp}
        tone="bg-success"
      />

      <div>
        <h3 class="text-[11px] uppercase tracking-wider text-base-content/45 mb-1">Party</h3>
        <ul class="space-y-1 text-xs font-mono">
          <For each={combat().participants}>
            {(p) => (
              <li class="flex items-center justify-between gap-2">
                <span class="truncate">
                  {p.username}
                  {p.isHost ? " ★" : ""}
                </span>
                <span class="flex items-center gap-2">
                  <span class={p.downed ? "text-error" : "text-base-content/60"}>
                    {p.downed ? "downed" : `${Math.max(0, p.formationHp)}/${p.formationMaxHp}`}
                  </span>
                  <span class="text-base-content/40">· {p.contribution}</span>
                </span>
              </li>
            )}
          </For>
        </ul>
      </div>

      <Show when={err()}>
        <p class="text-xs text-error">{err()}</p>
      </Show>

      <div class="flex gap-2">
        <button
          class="btn btn-sm btn-error grow"
          disabled={combat().youDowned || cooling()}
          onClick={attack}
        >
          {combat().youDowned ? "Downed" : "Attack"}
        </button>
        <button
          class="btn btn-sm btn-ghost"
          onClick={() => game.leaveCombat(combat().instance)}
        >
          Leave
        </button>
      </div>
    </div>
  );
}

/** The lobby/start view when not in a fight: open lobbies to join + the
 * available bosses to rouse. */
function LobbiesAndStart() {
  const game = useGame();
  const [err, setErr] = createSignal<string | null>(null);

  const join = (lobby: CombatLobbyView) => {
    setErr(null);
    game.joinCombat(lobby.instance, (reason) => setErr(reason ?? "could not join"));
  };
  const open = (boss: BossOptionView) => {
    setErr(null);
    game.openCombat(boss.id, (reason) => setErr(reason ?? "could not rouse"));
  };

  return (
    <div class="space-y-3">
      <Show when={err()}>
        <p class="text-xs text-error">{err()}</p>
      </Show>

      {/* Open lobbies others (or you) have started here. */}
      <div class="border border-base-300 rounded p-3">
        <h2 class="text-sm font-semibold mb-2">Open fights</h2>
        <Show
          when={game.world.zoneCombat.length > 0}
          fallback={<p class="text-xs text-base-content/40">— no open fights in this zone —</p>}
        >
          <ul class="space-y-2">
            <For each={game.world.zoneCombat}>
              {(lobby) => (
                <li class="flex items-center justify-between gap-2 text-sm">
                  <div class="min-w-0">
                    <div class="truncate font-medium">{lobby.bossName}</div>
                    <div class="text-xs text-base-content/45 font-mono">
                      {lobby.bossHp}/{lobby.bossMaxHp} hp · {lobby.participants} in
                      {lobby.host ? ` · host ${lobby.host}` : ""}
                    </div>
                  </div>
                  <button class="btn btn-xs btn-primary" onClick={() => join(lobby)}>
                    Join
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      {/* Available bosses to rouse (the active-combat actions). */}
      <div class="border border-base-300 rounded p-3">
        <h2 class="text-sm font-semibold mb-2">Rouse a boss</h2>
        <Show
          when={game.world.zoneBosses.length > 0}
          fallback={<p class="text-xs text-base-content/40">— no bosses can be roused here —</p>}
        >
          <ul class="space-y-2">
            <For each={game.world.zoneBosses}>
              {(boss) => (
                <li class="flex items-start justify-between gap-2 text-sm">
                  <div class="min-w-0">
                    <div class="truncate font-medium">{boss.name}</div>
                    <div class="text-xs text-base-content/45">{boss.description}</div>
                    <div class="text-xs text-base-content/55 font-mono mt-0.5">
                      {boss.maxHp} hp · cost {boss.costAmount} {resLabel(boss.costResource)}
                    </div>
                  </div>
                  <button class="btn btn-xs" onClick={() => open(boss)}>
                    Rouse
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
}

/** The activity log with a zone-interaction input (combat narration flows in via
 * `combatEvent` → `world.log`; the MUD interaction input echoes locally, as the
 * Actions page log does, since zone interactions aren't served yet). */
function ZoneLog() {
  const game = useGame();
  const [input, setInput] = createSignal("");
  let listEl: HTMLUListElement | undefined;

  createEffect(() => {
    game.world.log.length;
    if (listEl) listEl.scrollTop = listEl.scrollHeight;
  });

  const submit = (e: Event) => {
    e.preventDefault();
    const cmd = input().trim();
    if (!cmd) return;
    setInput("");
    game.logLocal(`> ${cmd}`);
    game.logLocal("Nothing answers. (Zone interactions are not available yet.)");
  };

  const kindClass = (kind: string) =>
    ({
      info: "text-base-content/55",
      combat: "text-base-content/80",
      failure: "text-error",
      reward: "text-success",
      local: "text-base-content/40 italic",
    })[kind] ?? "";

  return (
    <div class="w-full md:w-80 shrink-0 flex flex-col gap-2 overflow-hidden h-72 md:h-auto">
      <h2 class="text-sm font-semibold">Activity</h2>
      <ul
        ref={listEl}
        class="grow border border-base-300 rounded overflow-y-auto p-2 font-mono text-[12px] space-y-0.5"
      >
        <Show
          when={game.world.log.length > 0}
          fallback={<li class="text-base-content/35">— the log is quiet —</li>}
        >
          <For each={game.world.log}>
            {(entry) => <li class={kindClass(entry.kind)}>{entry.text}</li>}
          </For>
        </Show>
      </ul>
      <form class="flex flex-row gap-2" onSubmit={submit}>
        <input
          type="text"
          placeholder="Interact with the zone…"
          class="input input-sm grow"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
        />
        <button
          type="submit"
          class="btn btn-sm"
          classList={{ "btn-success": input().trim().length > 0 }}
          disabled={input().trim().length === 0}
        >
          Send
        </button>
      </form>
    </div>
  );
}

export function Zone() {
  const game = useGame();

  // The current zone's display name, when the map has been loaded.
  const zoneName = () =>
    game.world.map?.zones.find((z) => z.pos === game.world.zone)?.name ?? null;

  // Refresh the zone's players, lobbies, and rousable bosses whenever the
  // player's zone changes (arrival re-pushes gameState, moving `world.zone`).
  createEffect(() => {
    game.world.zone;
    if (game.online()) {
      game.listZonePlayers();
      game.listZoneCombat();
      game.listZoneBosses();
    }
  });

  return (
    <section class="size-full flex flex-col" data-screen-label="Zone">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Zone</h1>
        <span class="text-xs text-base-content/45">
          // {zoneName() ?? game.world.zone}
        </span>
      </header>

      <Show
        when={game.online()}
        fallback={
          <div class="grow grid place-items-center text-base-content/40 text-sm">
            Offline — the zone needs a server connection.
          </div>
        }
      >
        <div class="grow flex flex-col md:flex-row gap-4 overflow-hidden">
          {/* Main column: players-here + the active actions / current fight. */}
          <div class="grow flex flex-col gap-4 overflow-y-auto min-w-0">
            <PlayersHere />
            <Show when={game.world.combat} fallback={<LobbiesAndStart />}>
              <FightView />
            </Show>
          </div>
          {/* The activity log. */}
          <ZoneLog />
        </div>
      </Show>
    </section>
  );
}
