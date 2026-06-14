import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import { useGame } from "../../lib/game-context";
import type {
  ActionStatsView,
  ActionView,
  Direction,
  KnowledgeGainView,
  RewardsView,
  XpGainView,
} from "../../lib/protocol";

// The idle-action screen: a tabbed per-action details column on the left and
// the collapsible action log (also the future MUD-interaction surface) on the
// right. Combat and Travel are live — Harvest/Craft remain placeholders until
// their server-side action models land (see frontend CLAUDE.md §6).
// The tab set mirrors canon's action kinds (actions.md: combat, harvesting,
// crafting, travel — housing construction is a crafting action, not a kind).
const TABS = ["Combat", "Travel", "Harvest", "Craft"] as const;
type Tab = (typeof TABS)[number];

/** The tabs whose action models the backend actually serves today. */
const LIVE_TABS: readonly Tab[] = ["Combat", "Travel"];

/** Tab label → the wire `kind` id the backend uses for it. */
const KIND_BY_TAB: Record<Tab, string> = {
  Combat: "combat",
  Travel: "travel",
  Harvest: "harvesting",
  Craft: "crafting",
};

export function Actions() {
  const game = useGame();
  const rawInitalTab = game.world.action?.kind ?? "Combat";
  const initialTab = (rawInitalTab.charAt(0).toUpperCase() + rawInitalTab.slice(1)) as Tab;
  const [tab, setTab] = createSignal<Tab>(initialTab);
  const [showLog, setShowLog] = createSignal(true);

  return (
    <section class="size-full flex flex-col" data-screen-label="Actions">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Actions</h1>
        <span class="text-xs text-base-content/45">// what your party is doing</span>
        <button
          class="btn btn-xs btn-ghost ml-auto"
          onClick={() => setShowLog((v) => !v)}
          aria-pressed={showLog()}
        >
          {showLog() ? "Hide log ▸" : "Show log ◂"}
        </button>
      </header>

      <div class="grow flex flex-col md:flex-row gap-4 overflow-y-auto md:overflow-hidden">
        <div class="grow flex flex-col min-h-0">
          <div role="tablist" class="tabs tabs-box w-fit mb-3">
            <For each={TABS}>
              {(t) => (
                <button
                  role="tab"
                  class="tab"
                  classList={{ "tab-active": tab() === t }}
                  disabled={!LIVE_TABS.includes(t)}
                  title={LIVE_TABS.includes(t) ? undefined : "coming soon"}
                  onClick={() => {
                    // Switching tabs while the reward view is up means the
                    // player wants to start a *different* action — drop the
                    // completed action's RewardView so the new tab opens on its
                    // picker instead of re-showing the old rewards.
                    if (t !== tab() && game.world.lastRewards != null) {
                      game.clearRewards();
                    }
                    setTab(t);
                  }}
                >
                  {t}
                  <Show when={game.world.action?.kind === KIND_BY_TAB[t]}>
                    <span class="ml-1 text-primary">●</span>
                  </Show>
                </button>
              )}
            </For>
          </div>

          <div class="grow min-h-0 overflow-y-auto border border-base-300 rounded p-4">
            <Switch>
              <Match when={tab() === "Combat"}>
                <CombatTab />
              </Match>
              <Match when={tab() === "Travel"}>
                <TravelTab />
              </Match>
            </Switch>
          </div>
        </div>

        <Show when={showLog()}>
          <ActionLog />
        </Show>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Combat tab                                                          */
/* ------------------------------------------------------------------ */

function CombatTab() {
  const game = useGame();
  const current = createMemo(() =>
    game.world.action?.kind === "combat" ? game.world.action : null,
  );

  // Fetch the zone roster when entering the tab (and on zone change) unless
  // it's already cached — the server expects the client to cache per zone.
  createEffect(() => {
    if (game.online() && !game.world.enemies[game.world.zone]) game.listEnemies();
  });

  return (
    <Switch>
      <Match when={current()}>{(act) => <CurrentCombat act={act()} />}</Match>
      <Match when={game.world.lastRewards != null}>
        <RewardView />
      </Match>
      <Match when={true}>
        <EnemyBrowser />
      </Match>
    </Switch>
  );
}

/** The target picker: the zone's (knowledge-filtered) mobs on the left, the
 * selected mob's known details + KC input on the right. */
function EnemyBrowser() {
  const game = useGame();
  const roster = createMemo(() => game.world.enemies[game.world.zone] ?? []);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [kc, setKc] = createSignal("25");
  const selected = createMemo(() => roster().find((e) => e.id === selectedId()) ?? null);

  const kcValue = createMemo(() => {
    const n = Number.parseInt(kc(), 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  });

  const start = (e: Event) => {
    e.preventDefault();
    const target = selected();
    const n = kcValue();
    if (target && n) game.startCombat(target.id, n);
  };

  return (
    <Show
      when={game.online()}
      fallback={
        <p class="text-base-content/50">
          Offline — connect to a server to start actions.
        </p>
      }
    >
      <div class="h-full grid md:grid-cols-2 gap-4">
        <div class="flex flex-col overflow-hidden">
          <p class="text-xs text-base-content/45 mb-2">
            Targets in zone <span class="font-mono">{game.world.zone}</span>
          </p>
          <ul class="grow overflow-y-auto menu menu-sm bg-base-200/40 rounded-box w-full flex-nowrap">
            <Show
              when={roster().length > 0}
              fallback={<li class="p-2 text-base-content/40">Scanning the zone…</li>}
            >
              <For each={roster()}>
                {(e) => (
                  <li>
                    <button
                      classList={{ "menu-active": selectedId() === e.id }}
                      onClick={() => setSelectedId(e.id)}
                    >
                      {e.name}
                    </button>
                  </li>
                )}
              </For>
            </Show>
          </ul>
        </div>

        <div class="overflow-y-auto">
          <Show
            when={selected()}
            fallback={
              <p class="text-base-content/40 mt-8 text-center">
                Select a target to view what you know about it.
              </p>
            }
          >
            {(e) => (
              <form class="flex flex-col gap-3" onSubmit={start}>
                <h2 class="text-lg font-mono">{e().name}</h2>
                <div class="space-y-1">
                  <For each={e().descriptions}>
                    {(d) => <p class="text-sm text-base-content/60 italic">{d}</p>}
                  </For>
                </div>
                <Show when={e().drops.length > 0}>
                  <div>
                    <p class="text-xs text-base-content/45 mb-1">Known drops</p>
                    <div class="flex flex-wrap gap-1">
                      <For each={e().drops}>
                        {(d) => <span class="badge badge-sm badge-soft">{d}</span>}
                      </For>
                    </div>
                  </div>
                </Show>
                <div class="flex items-end gap-2 mt-2">
                  <label class="form-control">
                    <span class="label-text text-xs text-base-content/45 mb-1 block">
                      Kill count
                    </span>
                    <input
                      type="number"
                      min="1"
                      class="input input-sm w-28"
                      value={kc()}
                      onInput={(ev) => setKc(ev.currentTarget.value)}
                    />
                  </label>
                  <button type="submit" class="btn btn-sm btn-primary" disabled={!kcValue()}>
                    Start combat
                  </button>
                </div>
              </form>
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}

/** The in-flight combat action: KC progress, both health pools, the cached
 * stat blocks (with the live modifier), and the accrued tally. */
function CurrentCombat(props: { act: ActionView; }) {
  const game = useGame();
  // The combat slice of the action view; always present when kind is
  // "combat", which is the only way this component renders.
  const combat = () => props.act.combat;
  const phaseLabel = () =>
    ({
      preparation: "preparing",
      execution: "fighting",
      downtime: "downtime",
      regroup: "regrouping",
      resolution: "resolving",
    })[props.act.phase];

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3 flex-wrap">
        <h2 class="text-lg font-mono">Combat — {combat()?.enemyName}</h2>
        <span
          class="badge badge-sm"
          classList={{
            "badge-primary": props.act.phase === "execution",
            "badge-error": props.act.phase === "downtime",
            "badge-warning": props.act.phase === "regroup",
          }}
        >
          {phaseLabel()}
        </span>
        <button class="btn btn-xs btn-soft hover:btn-error ml-auto" onClick={() => game.stopAction()}>
          Stop action
        </button>
      </div>

      <div>
        <div class="flex justify-between text-xs text-base-content/55 mb-1">
          <span>Kill count</span>
          <span class="font-mono">
            {props.act.kcDone}/{props.act.kcTarget}
          </span>
        </div>
        <progress
          class="progress progress-primary w-full"
          max={props.act.kcTarget}
          value={props.act.kcDone}
        />
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <HpBar label="Your formation" hp={props.act.formationHp} max={props.act.formationMaxHp} cls="progress-success" />
        <Show when={combat()}>
          {(c) => <HpBar label={c().enemyName} hp={c().enemyHp} max={c().enemyMaxHp} cls="progress-error" />}
        </Show>
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <StatsPanel title="Formation action stats" stats={props.act.formationStats} modifier={props.act.modifier} />
        <Show when={combat()}>
          {(c) => <StatsPanel title="Enemy action stats" stats={c().enemyStats} />}
        </Show>
      </div>

      <div>
        <p class="text-xs text-base-content/45 mb-1">Accrued (commits when the action ends)</p>
        <TallyBadges tally={props.act.tally} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Travel tab                                                          */
/* ------------------------------------------------------------------ */

/** Compass labels for the six grid directions. */
const DIRECTION_LABEL: Record<Direction, string> = {
  north: "North",
  south: "South",
  east: "East",
  west: "West",
  up: "Up",
  down: "Down",
};

function TravelTab() {
  const game = useGame();
  const current = createMemo(() =>
    game.world.action?.kind === "travel" ? game.world.action : null,
  );

  // Fetch the zone's destinations on entering the tab (and on zone change)
  // unless already cached — same per-zone caching as the enemy roster.
  createEffect(() => {
    if (game.online() && !game.world.destinations[game.world.zone]) {
      game.listDestinations();
    }
  });

  return (
    <Switch>
      <Match when={current()}>{(act) => <CurrentTravel act={act()} />}</Match>
      <Match when={game.world.lastRewards != null}>
        <RewardView />
      </Match>
      <Match when={true}>
        <DestinationBrowser />
      </Match>
    </Switch>
  );
}

/** The destination picker: the current zone's adjacent authored zones on the
 * left, the selected route's details + "Start travel" on the right. Travel
 * takes no KC — the engine prices the journey from the formation's Speed. */
function DestinationBrowser() {
  const game = useGame();
  const dests = createMemo(() => game.world.destinations[game.world.zone] ?? []);
  const [selectedDir, setSelectedDir] = createSignal<Direction | null>(null);
  const selected = createMemo(() => dests().find((d) => d.direction === selectedDir()) ?? null);

  const start = (e: Event) => {
    e.preventDefault();
    const d = selected();
    if (d) game.startTravel(d.direction);
  };

  return (
    <Show
      when={game.online()}
      fallback={
        <p class="text-base-content/50">
          Offline — connect to a server to travel.
        </p>
      }
    >
      <div class="h-full grid md:grid-cols-2 gap-4">
        <div class="flex flex-col overflow-hidden">
          <p class="text-xs text-base-content/45 mb-2">
            Routes out of zone <span class="font-mono">{game.world.zone}</span>
          </p>
          <ul class="grow overflow-y-auto menu menu-sm bg-base-200/40 rounded-box w-full flex-nowrap">
            <Show
              when={dests().length > 0}
              fallback={<li class="p-2 text-base-content/40">Mapping the routes…</li>}
            >
              <For each={dests()}>
                {(d) => (
                  <li>
                    <button
                      classList={{ "menu-active": selectedDir() === d.direction }}
                      onClick={() => setSelectedDir(d.direction)}
                    >
                      <span class="font-mono text-xs text-base-content/45 w-12 shrink-0">
                        {DIRECTION_LABEL[d.direction]}
                      </span>
                      {d.name}
                    </button>
                  </li>
                )}
              </For>
            </Show>
          </ul>
        </div>

        <div class="overflow-y-auto">
          <Show
            when={selected()}
            fallback={
              <p class="text-base-content/40 mt-8 text-center">
                Select a route to travel.
              </p>
            }
          >
            {(d) => (
              <form class="flex flex-col gap-3" onSubmit={start}>
                <h2 class="text-lg font-mono">{d().name}</h2>
                <div class="flex flex-wrap gap-1">
                  <span class="badge badge-sm badge-soft">{DIRECTION_LABEL[d().direction]}</span>
                  <span class="badge badge-sm badge-soft">Danger {d().danger}</span>
                  <span class="badge badge-sm badge-soft font-mono">{d().position}</span>
                </div>
                <p class="text-sm text-base-content/60 italic">
                  Travel time is set by your formation's Speed and the
                  destination's danger when the journey begins.
                </p>
                <div class="mt-2">
                  <button type="submit" class="btn btn-sm btn-primary">
                    Start travel
                  </button>
                </div>
              </form>
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}

/** The in-flight travel action: journey progress, the destination, and the
 * cached formation stats (Speed drives the pace). Travel resolves no rounds and
 * wins no loot — its outcome is the arrival — but it does accrue use-based XP
 * each tick (progression.md), so there are no health pools but there is an XP
 * tally. */
function CurrentTravel(props: { act: ActionView; }) {
  const game = useGame();
  const travel = () => props.act.travel;
  const phaseLabel = () =>
    ({
      preparation: "plotting",
      execution: "traveling",
      downtime: "downtime",
      regroup: "regrouping",
      resolution: "arriving",
    })[props.act.phase];

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3 flex-wrap">
        <h2 class="text-lg font-mono">Travel — {travel()?.destinationName}</h2>
        <span
          class="badge badge-sm"
          classList={{ "badge-primary": props.act.phase === "execution" }}
        >
          {phaseLabel()}
        </span>
        <button class="btn btn-xs btn-soft hover:btn-error ml-auto" onClick={() => game.stopAction()}>
          Stop action
        </button>
      </div>

      <Show when={travel()}>
        {(t) => (
          <div class="flex flex-wrap gap-1">
            <span class="badge badge-sm badge-soft">{DIRECTION_LABEL[t().direction]}</span>
            <span class="badge badge-sm badge-soft">Danger {t().danger}</span>
            <span class="badge badge-sm badge-soft font-mono">{t().destination}</span>
          </div>
        )}
      </Show>

      <div>
        <div class="flex justify-between text-xs text-base-content/55 mb-1">
          <span>Journey</span>
          <span class="font-mono">
            <Show when={props.act.phase !== "preparation"} fallback="plotting course…">
              {props.act.kcDone}/{props.act.kcTarget} ticks
            </Show>
          </span>
        </div>
        <progress
          class="progress progress-primary w-full"
          max={Math.max(props.act.kcTarget, 1)}
          value={props.act.kcDone}
        />
      </div>

      <Show
        when={
          (props.act.tally.experience ?? []).length > 0 ||
          (props.act.tally.knowledge ?? []).length > 0
        }
      >
        <div class="flex flex-col gap-1">
          <span class="text-xs text-base-content/55">Gained this journey</span>
          <div class="flex flex-wrap gap-1">
            <XpBadges experience={props.act.tally.experience} />
            <KnowledgeBadges knowledge={props.act.tally.knowledge} />
          </div>
        </div>
      </Show>

      <StatsPanel
        title="Formation action stats"
        stats={props.act.formationStats}
        modifier={props.act.modifier}
      />
    </div>
  );
}

function HpBar(props: { label: string; hp: number; max: number; cls: string; }) {
  return (
    <div>
      <div class="flex justify-between text-xs text-base-content/55 mb-1">
        <span>{props.label}</span>
        <span class="font-mono">
          {props.hp}/{props.max}
        </span>
      </div>
      <progress class={`progress w-full ${props.cls}`} max={Math.max(props.max, 1)} value={Math.max(props.hp, 0)} />
    </div>
  );
}

const STAT_ROWS: { key: keyof ActionStatsView; label: string; }[] = [
  { key: "health", label: "Health" },
  { key: "physicalAttack", label: "P.Atk" },
  { key: "magicalAttack", label: "M.Atk" },
  { key: "physicalDefense", label: "P.Def" },
  { key: "magicalDefense", label: "M.Def" },
  { key: "speed", label: "Speed" },
];

/** A six-stat block; the formation side shows its per-tick modifier (zone
 * effects, status effects) next to the cached value when one is active. */
function StatsPanel(props: { title: string; stats: ActionStatsView; modifier?: ActionStatsView; }) {
  return (
    <div class="bg-base-200/40 rounded-box p-3">
      <p class="text-xs text-base-content/45 mb-2">{props.title}</p>
      <table class="table table-xs font-mono">
        <tbody>
          <For each={STAT_ROWS}>
            {(row) => {
              const mod = () => props.modifier?.[row.key] ?? 0;
              return (
                <tr>
                  <td class="text-base-content/55">{row.label}</td>
                  <td class="text-right">
                    {props.stats[row.key]}
                    <Show when={mod() !== 0}>
                      <span class={mod() > 0 ? "text-success" : "text-error"}>
                        {" "}
                        ({mod() > 0 ? "+" : ""}
                        {mod()})
                      </span>
                    </Show>
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}

/** Per-target use-based XP badges (progression.md): "+30 STR", with a "→2"
 * suffix on the gains that crossed a trained-level boundary at commit. */
function XpBadges(props: { experience?: XpGainView[]; }) {
  return (
    <For each={props.experience ?? []}>
      {(e) => (
        <span class="badge badge-sm badge-soft">
          🎓 +{e.amount} {e.target.toUpperCase()}
          <Show when={e.levelAfter > e.levelBefore}>
            <span class="text-success">&nbsp;→{e.levelAfter}</span>
          </Show>
        </span>
      )}
    </For>
  );
}

/** Per-entity Knowledge badges (knowledge.md): "🧭 +7 Rust Flats". */
function KnowledgeBadges(props: { knowledge?: KnowledgeGainView[]; }) {
  return (
    <For each={props.knowledge ?? []}>
      {(k) => (
        <span class="badge badge-sm badge-soft">
          🧭 +{k.amount} {k.label}
        </span>
      )}
    </For>
  );
}

function TallyBadges(props: { tally: RewardsView; }) {
  const c = () => props.tally.currencies;
  return (
    <div class="flex flex-wrap gap-1">
      <span class="badge badge-sm badge-soft">☠ {props.tally.kills} kills</span>
      <span class="badge badge-sm badge-soft">💰 {c().credits} CR</span>
      <Show when={c().dust > 0}>
        <span class="badge badge-sm badge-soft">✨ {c().dust} DU</span>
      </Show>
      <Show when={c().rousingDevices > 0}>
        <span class="badge badge-sm badge-soft">🔅 {c().rousingDevices} RO</span>
      </Show>
      <For each={Object.entries(props.tally.general).filter(([, q]) => q > 0)}>
        {([id, qty]) => (
          <span class="badge badge-sm badge-soft">
            {qty} {id.toUpperCase()}
          </span>
        )}
      </For>
      <For each={props.tally.items}>
        {(s) => (
          <span class="badge badge-sm badge-soft">
            {s.qty}× {s.name}
          </span>
        )}
      </For>
      <XpBadges experience={props.tally.experience} />
      <KnowledgeBadges knowledge={props.tally.knowledge} />
    </div>
  );
}

/** Shown when the last action ended: the committed rewards, with quick restart
 * (just another full change-action — the server keeps no restart state). */
function RewardView() {
  const game = useGame();
  const r = () => game.world.lastRewards!;

  // Quick restart re-issues the same action that just ended (the server keeps
  // no restart state). Travel re-sends the same direction from the *current*
  // zone, so after arriving it keeps heading that way if a zone lies beyond.
  const canRestart = () =>
    r().kind === "travel" ? game.world.lastTravel != null : game.world.lastCombat != null;

  const restart = () => {
    if (r().kind === "travel") {
      const last = game.world.lastTravel;
      if (last) game.startTravel(last.direction);
    } else {
      const last = game.world.lastCombat;
      if (last) game.startCombat(last.enemy, last.kc);
    }
  };

  const isTravel = () => r().kind === "travel";

  return (
    <div class="max-w-md mx-auto mt-6 flex flex-col gap-4 text-center">
      <Show
        when={isTravel()}
        fallback={
          <>
            <h2 class="text-lg font-mono">
              {r().stopped ? "Action stopped" : "Action complete"}
            </h2>
            <p class="text-base-content/60">
              {r().kind} vs {r().targetName} — KC {r().kcDone}/{r().kcTarget}
            </p>
            <div class="bg-base-200/40 rounded-box p-4">
              <p class="text-xs text-base-content/45 mb-2">Rewards committed</p>
              <div class="flex justify-center">
                <TallyBadges tally={r().rewards} />
              </div>
            </div>
          </>
        }
      >
        {/* Travel's outcome is the arrival (or, when stopped, no movement at
            all) — but the journey still banked use-based XP. */}
        <h2 class="text-lg font-mono">{r().stopped ? "Journey abandoned" : "Arrived"}</h2>
        <p class="text-base-content/60">
          {r().stopped
            ? `You never set out for ${r().targetName}.`
            : `You have reached ${r().targetName}.`}
        </p>
        <Show
          when={
            (r().rewards.experience ?? []).length > 0 ||
            (r().rewards.knowledge ?? []).length > 0
          }
        >
          <div class="bg-base-200/40 rounded-box p-4">
            <p class="text-xs text-base-content/45 mb-2">Gained on the journey</p>
            <div class="flex justify-center flex-wrap gap-1">
              <XpBadges experience={r().rewards.experience} />
              <KnowledgeBadges knowledge={r().rewards.knowledge} />
            </div>
          </div>
        </Show>
      </Show>
      <div class="flex justify-center gap-2">
        <button class="btn btn-sm btn-primary" disabled={!canRestart()} onClick={restart}>
          {isTravel() && !r().stopped ? "Travel onward" : "Quick restart"}
        </button>
        <button class="btn btn-sm btn-soft" onClick={() => game.clearRewards()}>
          {isTravel() ? "Choose a route" : "Choose a target"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Action log                                                          */
/* ------------------------------------------------------------------ */

/** The right-hand action log: per-tick combat narration, and the input that
 * will become the MUD-interaction surface once zones serve interactions. */
function ActionLog() {
  const game = useGame();
  const [input, setInput] = createSignal("");
  let listEl: HTMLUListElement | undefined;

  // Keep the newest line in view.
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
    // MUD-like interactions are zone-served and not implemented server-side
    // yet (knowledge-base/design/mud.md) — answer locally for now.
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
        <button type="submit" class="btn btn-sm" classList={{ "btn-success": input().trim().length > 0 }} disabled={input().trim().length === 0}>
          Send
        </button>
      </form>
    </div>
  );
}
