import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  type JSX,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { actionTarget, summarizeRewards, useGame } from "../../../lib/game-context";
import type { Direction, MapZoneInfo } from "../../../lib/protocol";
import { CellGrid } from "@grindshell/ui-components";

// Overview cards — condensed views of the underlying game pages. Each body
// receives a { col, row } span and adapts its density to the card's area.
// Tiers: micro (area<=2) · small (<=6) · medium (<=15) · large (>15).

export type Span = { col: number; row: number; };
export type Tier = "micro" | "small" | "medium" | "large";

export const tier = ({ col, row }: Span): Tier => {
  const a = col * row;
  if (a <= 2) return "micro";
  if (a <= 6) return "small";
  if (a <= 15) return "medium";
  return "large";
};

export type CardDef = {
  id: string;
  title: string;
  route: string;
  defSpan: Span;
  badge?: string;
  Body: (props: { span: Span; }) => JSX.Element;
};

/* ---------- shared bits ---------- */

function Stat(props: {
  label: string;
  value: JSX.Element;
  sub?: string;
  tone?: "warning";
  compact?: boolean;
}) {
  return (
    <div class={"bg-base-300/50 rounded " + (props.compact ? "px-2 py-1" : "px-2 py-1.5")}>
      <div class="text-[10px] uppercase tracking-wider text-base-content/50">
        {props.label}
      </div>
      <div class="font-mono leading-tight text-base">
        <span class={props.tone === "warning" ? "text-warning" : ""}>{props.value}</span>
        <Show when={props.sub}>
          <span class="text-base-content/40 text-xs ml-0.5">{props.sub}</span>
        </Show>
      </div>
    </div>
  );
}

/* ====================================================================== */
/* CARD BODIES — each switches on tier(span) so it re-flows on resize.    */
/* ====================================================================== */

/* ---------- ACTION ---------- */
// The in-flight idle action from the game context (`world.action`: the
// `gameState` baseline folded with `actionTick` deltas) — the same source the
// TopBar and the Actions page render. Shows an idle state when nothing runs.
const PHASE_LABEL: Record<string, string> = {
  preparation: "preparing",
  execution: "executing",
  downtime: "downtime",
  regroup: "regrouping",
  resolution: "resolving",
};

// A compact action starter for the large Action card: tabs to pick the kind, a
// dropdown of the zone's targets, and a Start/Switch button. Reuses the same
// ops the Actions page does (listEnemies/startCombat, listDestinations/
// startTravel). `changeAction` is an atomic stop-then-start, so the same call
// starts when idle and switches when an action is already running. Only the two
// live kinds (combat/travel) — Harvest/Craft have no server model yet.
function ActionStarter() {
  const game = useGame();
  const [tab, setTab] = createSignal<"combat" | "travel">("combat");
  const [enemyId, setEnemyId] = createSignal("");
  const [kc, setKc] = createSignal("25");
  const [dir, setDir] = createSignal("");

  const enemies = () => game.world.enemies[game.world.zone] ?? [];
  const dests = () => game.world.destinations[game.world.zone] ?? [];
  const running = () => game.world.action != null;
  const verb = () => (running() ? "Switch" : "Start");

  // Fetch the active tab's list for this zone (cached per zone server-side).
  createEffect(() => {
    if (!game.online()) return;
    if (tab() === "combat" && !game.world.enemies[game.world.zone]) game.listEnemies();
    if (tab() === "travel" && !game.world.destinations[game.world.zone]) game.listDestinations();
  });

  const startCombat = () => {
    const n = Math.max(1, Math.floor(Number(kc()) || 0));
    const id = enemyId() || enemies()[0]?.id;
    if (id && n >= 1) game.startCombat(id, n);
  };
  const startTravel = () => {
    const d = (dir() || dests()[0]?.direction) as Direction | "";
    if (d) game.startTravel(d as Direction);
  };

  return (
    <div class="border-t border-base-300/60 pt-2 mt-1 flex flex-col gap-2 shrink-0">
      <div class="flex items-center gap-2">
        <div role="tablist" class="tabs tabs-box tabs-xs">
          <button
            role="tab"
            class="tab"
            classList={{ "tab-active": tab() === "combat" }}
            onClick={() => setTab("combat")}
          >
            Combat
          </button>
          <button
            role="tab"
            class="tab"
            classList={{ "tab-active": tab() === "travel" }}
            onClick={() => setTab("travel")}
          >
            Travel
          </button>
        </div>
        <span class="text-[10px] text-base-content/40">
          {running() ? "switch the current action" : "start an action"}
        </span>
      </div>
      <Switch>
        <Match when={tab() === "combat"}>
          <div class="flex items-end gap-2 flex-wrap">
            <select
              class="select select-xs grow min-w-0"
              value={enemyId()}
              onChange={(e) => setEnemyId(e.currentTarget.value)}
            >
              <option value="" disabled>
                {enemies().length ? "Pick a target…" : "Scanning the zone…"}
              </option>
              <For each={enemies()}>{(en) => <option value={en.id}>{en.name}</option>}</For>
            </select>
            <input
              type="number"
              min="1"
              class="input input-xs w-16"
              title="Kill count"
              value={kc()}
              onInput={(e) => setKc(e.currentTarget.value)}
            />
            <button class="btn btn-xs btn-primary" disabled={!enemies().length} onClick={startCombat}>
              {verb()}
            </button>
          </div>
        </Match>
        <Match when={tab() === "travel"}>
          <div class="flex items-end gap-2 flex-wrap">
            <select
              class="select select-xs grow min-w-0"
              value={dir()}
              onChange={(e) => setDir(e.currentTarget.value)}
            >
              <option value="" disabled>
                {dests().length ? "Pick a route…" : "Mapping routes…"}
              </option>
              <For each={dests()}>
                {(d) => <option value={d.direction}>{DIR_LABEL[d.direction]} · {d.name}</option>}
              </For>
            </select>
            <button class="btn btn-xs btn-primary" disabled={!dests().length} onClick={startTravel}>
              {verb()}
            </button>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

function ActionCard(props: { span: Span; }) {
  const game = useGame();
  const T = () => tier(props.span);
  const action = () => game.world.action;

  return (
    <Show
      when={action()}
      fallback={
        <Show
          when={T() === "large"}
          fallback={
            <div class="h-full flex flex-col items-center justify-center text-center gap-1">
              <div class="font-mono text-sm text-base-content/55 uppercase">idle</div>
              <Show when={T() !== "micro"}>
                <div class="text-[11px] text-base-content/40">
                  No action running — pick a target on the Actions page.
                </div>
              </Show>
            </div>
          }
        >
          <div class="h-full flex flex-col">
            <div class="flex-1 flex flex-col items-center justify-center text-center gap-1">
              <div class="font-mono text-lg text-base-content/55 uppercase">idle</div>
              <div class="text-[11px] text-base-content/40">
                No action running — start one below.
              </div>
            </div>
            <ActionStarter />
          </div>
        </Show>
      }
    >
      {(a) => (
        <Switch>
          <Match when={T() === "micro"}>
            <div class="h-full flex flex-col justify-between">
              <div class="font-mono text-sm font-semibold uppercase">{a().kind}</div>
              <progress
                class="progress progress-primary w-full h-1"
                value={a().kcDone}
                max={a().kcTarget}
              />
              <div class="font-mono text-[10px] text-base-content/50">
                KC {a().kcDone}/{a().kcTarget}
              </div>
            </div>
          </Match>

          <Match when={T() === "small"}>
            <div class="h-full flex flex-col gap-2">
              <div class="font-mono text-lg font-semibold leading-tight uppercase">{a().kind}</div>
              <div class="text-[11px] text-base-content/50 -mt-1">
                vs {actionTarget(a())} · {PHASE_LABEL[a().phase] ?? a().phase}
              </div>
              <progress
                class="progress progress-primary w-full h-1.5"
                value={a().kcDone}
                max={a().kcTarget}
              />
              <div class="flex justify-between text-[10px] font-mono text-base-content/60">
                <span>KC {a().kcDone}/{a().kcTarget}</span>
                <span>
                  HP {a().formationHp}/{a().formationMaxHp}
                </span>
              </div>
            </div>
          </Match>

          <Match when={true}>
            {/* At large the card is wide and short (e.g. 6×3), so the running
                view lays out in two columns — live action on the left, accrued
                rewards + the starter on the right — to fit without scrolling.
                At medium it's a single column. */}
            <div class="flex gap-4 h-full min-h-0 overflow-hidden">
              <div class="flex-1 min-w-0 flex flex-col gap-2">
                {/* The live action read-out grows to fill the column height so
                    the stat tiles sit just below it instead of being pushed to
                    the bottom with a dead gap (the card is wide and short). */}
                <div class="flex-1 min-h-0 flex flex-col justify-center gap-2">
                  <div class="flex items-baseline gap-2 flex-wrap">
                    <span class="font-mono text-xl font-semibold tracking-tight uppercase leading-none">
                      {a().kind}
                    </span>
                    <span class="text-xs text-base-content/50 truncate">vs {actionTarget(a())}</span>
                  </div>
                  <div class="space-y-1">
                    <div class="flex justify-between text-[11px] font-mono text-base-content/60">
                      <span>kill count</span>
                      <span>
                        {a().kcDone} / {a().kcTarget}
                      </span>
                    </div>
                    <progress
                      class="progress progress-primary w-full h-1.5"
                      value={a().kcDone}
                      max={a().kcTarget}
                    />
                  </div>
                </div>
                <div class="grid grid-cols-3 gap-2 text-center">
                  <Stat
                    label="formation hp"
                    value={a().formationHp}
                    sub={`/${a().formationMaxHp}`}
                    tone={a().formationHp < a().formationMaxHp / 2 ? "warning" : undefined}
                    compact
                  />
                  <Stat label="phase" value={PHASE_LABEL[a().phase] ?? a().phase} compact />
                  <Stat label="kills" value={a().tally.kills} compact />
                </div>
              </div>
              <Show when={T() === "large"}>
                <div class="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
                  <div class="text-[11px] flex-1 min-h-0 overflow-y-auto">
                    <div class="text-[10px] uppercase tracking-wider text-base-content/45 mb-1">
                      accrued (commits when the action ends)
                    </div>
                    <div class="font-mono text-base-content/75 leading-relaxed">
                      {summarizeRewards(a().tally)}
                    </div>
                  </div>
                  {/* Switch the running action (atomic stop-then-start). */}
                  <ActionStarter />
                </div>
              </Show>
            </div>
          </Match>
        </Switch>
      )}
    </Show>
  );
}

/* ---------- MAP ---------- */
// A live, draggable mini-map from the game context (`world.map`, the server's
// `mapView` push — the same source/grid the Area page renders): a CellGrid
// window on the current Z-plane, north up, that pans by dragging and selects a
// zone on click. Requests the map + travel destinations when online; offline /
// before the first push it shows a compact empty state rather than invented
// zones (frontend CLAUDE.md §6). When there's room (medium/large) it shows an
// area-data panel for the selected (or current) zone — name, x/y/z position,
// danger, and the player's banked Knowledge — plus a Travel button for an
// adjacent destination. The micro tier is too small for the grid, so it falls
// back to just the current zone. Only wire-served fields are shown.

type MapVec = { x: number; y: number; z: number; };
const parseMapPos = (s: string): MapVec => {
  const [x, y, z] = s.split(",").map(Number);
  return { x, y, z };
};

/** Danger text tone (1 safe → 5 lethal). */
const dangerTone = (d: number): string =>
  d <= 1 ? "text-base-content/70" : d <= 3 ? "text-warning" : "text-error";

/** Compass labels for the Travel button. */
const DIR_LABEL: Record<Direction, string> = {
  north: "North",
  south: "South",
  east: "East",
  west: "West",
  up: "Up",
  down: "Down",
};

/** A cell-grid item wrapping a map zone, in true world coords. The CellGrid is
 *  rendered with `flipY`, so north (+y) renders upward without negating here. */
type MapItem = { x: number; y: number; zone: MapZoneInfo; };

/** Viewport size of the card's mini-map, in cells. */
const MAP_COLS = 5;
const MAP_ROWS = 5;

function MapEmpty() {
  return (
    <div class="h-full flex flex-col items-center justify-center text-center gap-1 text-base-content/45">
      <span class="font-mono text-base-content/30 tracking-widest">· · ·</span>
      <span class="text-[11px]">The map streams from the server.</span>
    </div>
  );
}

function MapCard(props: { span: Span; }) {
  const game = useGame();
  const T = () => tier(props.span);
  const map = () => game.world.map;
  const currentKey = () => map()?.current ?? game.world.zone;
  const current = () => parseMapPos(currentKey());
  const currentZone = () => map()?.zones.find((z) => z.pos === currentKey()) ?? null;
  const destinations = () => game.world.destinations[currentKey()] ?? [];

  const [viewZ, setViewZ] = createSignal(current().z);
  const [offsetX, setOffsetX] = createSignal(current().x - Math.floor(MAP_COLS / 2));
  const [offsetY, setOffsetY] = createSignal(current().y - Math.floor(MAP_ROWS / 2));
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);

  const recenter = () => {
    const c = current();
    setViewZ(c.z);
    setOffsetX(c.x - Math.floor(MAP_COLS / 2));
    setOffsetY(c.y - Math.floor(MAP_ROWS / 2));
  };

  // Pull the map + travel destinations when connected (both are on-demand, not
  // in the connect-time push), tracking zone + online only — same as the Area
  // page. A fresh zone recentres the viewport and clears any stale selection.
  createEffect(() => {
    void game.world.zone;
    if (game.online()) {
      game.listMap();
      game.listDestinations();
    }
  });
  createEffect(on(currentKey, () => {
    recenter();
    setSelectedKey(null);
  }));

  const items = createMemo<MapItem[]>(() => {
    const m = map();
    if (!m) return [];
    return m.zones
      .filter((z) => parseMapPos(z.pos).z === viewZ())
      .map((z) => {
        const p = parseMapPos(z.pos);
        return { x: p.x, y: p.y, zone: z };
      });
  });

  const selectedZone = (): MapZoneInfo | null => {
    const k = selectedKey();
    return k ? (map()?.zones.find((z) => z.pos === k) ?? null) : null;
  };
  // The inspected zone's display position, only when on the plane in view.
  const selectedPos = () => {
    const z = selectedZone();
    if (!z) return null;
    const p = parseMapPos(z.pos);
    if (p.z !== viewZ()) return null;
    return { x: p.x, y: p.y };
  };
  const destinationAt = (key: string) => destinations().find((d) => d.position === key);
  const selDest = () => {
    const z = selectedZone();
    return z ? destinationAt(z.pos) : undefined;
  };

  // The zone the area-data panel describes: the selected one, or the current
  // zone when nothing is selected. Its position drives the x/y/z readout.
  const infoZone = (): MapZoneInfo | null => selectedZone() ?? currentZone();
  const infoPos = () => parseMapPos(infoZone()?.pos ?? currentKey());
  const statusLabel = () => {
    const z = selectedZone();
    if (!z) return "current zone";
    if (z.pos === currentKey()) return "you are here";
    return z.discovered ? "not adjacent" : "frontier";
  };

  const onCellClick = (absX: number, absY: number) => {
    const key = `${absX},${absY},${viewZ()}`;
    const z = map()?.zones.find((zz) => zz.pos === key);
    // Clicking only selects (empty space clears it) — travel fires from the
    // Travel button, never the map click itself (matches the Area page).
    setSelectedKey(z ? key : null);
  };

  const renderZone = (item: MapItem, container: HTMLDivElement) => {
    const z = item.zone;
    if (z.pos === currentKey()) {
      container.classList.add("bg-primary", "text-primary-content", "font-semibold");
    } else if (z.discovered) {
      container.classList.add("bg-base-300", "text-base-content");
    } else {
      container.classList.add("bg-base-100", "text-base-content/60", "border", "border-dashed", "border-base-content/40");
    }
    const name = document.createElement("div");
    name.className = "text-[0.55rem] font-medium leading-tight text-center overflow-hidden";
    name.textContent = z.name;
    container.appendChild(name);
  };

  return (
    <Switch>
      <Match when={T() === "micro"}>
        <div class="h-full flex flex-col items-center justify-center text-center font-mono text-[10px]">
          <div class="text-base-content/70">
            <span class="text-primary mr-1">@</span>
            {currentZone()?.name ?? "—"}
          </div>
          <div class="text-base-content/45">
            ({current().x}, {current().y}, {current().z})
          </div>
        </div>
      </Match>

      <Match when={true}>
        <Show when={map()} fallback={<MapEmpty />}>
          <div class="h-full flex flex-row gap-1.5 min-h-0">
            {/* Draggable tile grid: `panMode` so a left-drag anywhere pans, a
                click selects (the same shared CellGrid the Area map uses). */}
            <div class="flex-1 min-h-0 min-w-0 rounded bg-base-200/40 overflow-hidden">
              <CellGrid
                items={items()}
                cols={MAP_COLS}
                rows={MAP_ROWS}
                offsetX={offsetX()}
                offsetY={offsetY()}
                minCellPx={18}
                onCellClick={onCellClick}
                onPan={(x, y) => {
                  setOffsetX(x);
                  setOffsetY(y);
                }}
                selectedPos={selectedPos()}
                renderItem={renderZone}
                panMode
                flipY
              />
            </div>

            {/* Area-data panel — only when there's room (medium/large). The
                small tier just pans/selects. Describes the selected zone, or
                the current one when nothing is selected. The width is FIXED
                (with a truncated name) so a long/short zone name can't resize
                the grid column — keeping the map grid stable on selection. */}
            <Show when={T() !== "small"}>
              <div class="w-28 shrink-0 min-w-0 flex flex-col gap-1 text-[11px] px-0.5">
                {/* <div class="flex items-center gap-2">
                  <span class="truncate font-medium text-base-content/80">
                    {infoZone()?.name ?? "Unknown"}
                  </span>
                  <Show
                    when={selDest()}
                    fallback={
                      <span class="ml-auto shrink-0 text-[9px] uppercase tracking-wider text-base-content/40">
                        {statusLabel()}
                      </span>
                    }
                  >
                    {(d) => (
                      <button
                        class="btn btn-xs btn-primary ml-auto shrink-0"
                        onClick={() => game.startTravel(d().direction)}
                      >
                        Travel {DIR_LABEL[d().direction].toLowerCase()} →
                      </button>
                    )}
                  </Show>
                </div> */}
                <span class="truncate font-medium text-base-content/80">
                  {infoZone()?.name ?? "Unknown"}
                </span>
                <Show
                  when={selDest()}
                  fallback={
                    <span class="shrink-0 text-[9px] uppercase tracking-wider text-base-content/40">
                      {statusLabel()}
                    </span>
                  }
                >
                  {(d) => (
                    <button
                      class="btn btn-xs btn-primary shrink-0"
                      onClick={() => game.startTravel(d().direction)}
                    >
                      Travel {DIR_LABEL[d().direction].toLowerCase()} →
                    </button>
                  )}
                </Show>
                <div class="flex flex-col gap-3 font-mono text-base-content/60">
                  <span title="position">
                    ({infoPos().x}, {infoPos().y}, {infoPos().z})
                  </span>
                  <span title="danger" class={dangerTone(infoZone()?.danger ?? 0)}>
                    ⚠ {infoZone()?.danger ?? "—"}
                  </span>
                  <span title="zone knowledge">🧭 {infoZone()?.knowledge ?? 0}</span>
                </div>
                {/* Z-level + recenter controls — only at the large tier, where
                    there's room. Mirrors the Area page's map controls. */}
                <Show when={T() === "large"}>
                  <div class="mt-auto flex flex-col gap-1 pt-1">
                    <div class="join self-start">
                      <button
                        class="btn btn-xs join-item"
                        title="Up a level (+z)"
                        onClick={() => setViewZ((v) => v + 1)}
                      >
                        ▲
                      </button>
                      <span class="btn btn-xs join-item no-animation pointer-events-none font-mono px-1.5">
                        z{viewZ()}
                      </span>
                      <button
                        class="btn btn-xs join-item"
                        title="Down a level (−z)"
                        onClick={() => setViewZ((v) => v - 1)}
                      >
                        ▼
                      </button>
                    </div>
                    <button class="btn btn-xs btn-ghost self-start" onClick={recenter}>
                      Recenter
                    </button>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </Match>
    </Switch>
  );
}

/* ---------- INVENTORY ---------- */
// Live committed holdings from the game context (the server's authoritative
// `inventory` push). Zeros until the first push (offline / not yet connected).

function InventoryCard(props: { span: Span; }) {
  const game = useGame();
  const T = () => tier(props.span);
  const cur = () => game.world.inventory?.currencies;
  const gen = () => game.world.inventory?.general;
  const items = () => game.world.inventory?.items ?? [];
  const fmt = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

  return (
    <Switch>
      <Match when={T() === "micro"}>
        <div class="h-full flex flex-col justify-center text-center">
          <div class="text-[10px] uppercase tracking-wider text-base-content/50">credits</div>
          <div class="font-mono text-base leading-tight">
            {fmt(cur()?.credits)}
            <span class="text-xs text-base-content/40">cr</span>
          </div>
        </div>
      </Match>

      <Match when={T() === "small"}>
        <div class="h-full flex flex-col gap-1.5">
          <div class="grid grid-cols-2 gap-1.5">
            <div class="rounded bg-base-300/50 px-1.5 py-1">
              <div class="text-[9px] uppercase tracking-wider text-base-content/50">cr</div>
              <div class="font-mono text-sm">{fmt(cur()?.credits)}</div>
            </div>
            <div class="rounded bg-base-300/50 px-1.5 py-1">
              <div class="text-[9px] uppercase tracking-wider text-base-content/50">dust</div>
              <div class="font-mono text-sm">{fmt(cur()?.dust)}</div>
            </div>
          </div>
          <div class="text-[10px] font-mono text-base-content/55 flex justify-between mt-auto pt-1 border-t border-base-300/60">
            <span>{items().length} stacks</span>
            <span>∞ capacity</span>
          </div>
        </div>
      </Match>

      <Match when={true}>
        <div class="flex flex-col h-full">
          <div class="grid grid-cols-3 gap-2 mb-2">
            <Stat label="credits" value={fmt(cur()?.credits)} sub="cr" compact />
            <Stat label="dust" value={fmt(cur()?.dust)} sub="du" compact />
            <Stat label="rousing" value={fmt(cur()?.rousingDevices)} sub="ro" compact />
          </div>
          <div class="grid grid-cols-4 gap-1.5 mb-3">
            <For
              each={[
                ["bio", gen()?.bio] as const,
                ["met", gen()?.met] as const,
                ["ele", gen()?.ele] as const,
                ["liq", gen()?.liq] as const,
              ]}
            >
              {([id, q]) => (
                <div class="rounded bg-base-300/50 px-1.5 py-1 text-center">
                  <div class="text-[9px] uppercase tracking-wider text-base-content/50">{id}</div>
                  <div class="font-mono text-sm">{fmt(q)}</div>
                </div>
              )}
            </For>
          </div>
          <div
            class={
              "flex text-[10px] uppercase tracking-wider text-base-content/45 mb-1 px-1 " +
              (T() === "large" ? "gap-4" : "justify-between")
            }
          >
            <span class="flex-1">item</span>
            <Show when={T() === "large"}>
              <span class="w-20">type</span>
            </Show>
            <span>qty</span>
          </div>
          <ul class="overflow-y-auto flex-1 -mx-1 px-1 text-sm divide-y divide-base-300/40">
            <For
              each={items()}
              fallback={
                <li class="py-2 text-xs text-base-content/45">
                  No items yet — rewards commit when an action ends.
                </li>
              }
            >
              {(it) => (
                <li class="flex items-baseline gap-2 py-1">
                  <span class="truncate min-w-0 flex-1">{it.name}</span>
                  <Show when={T() === "large"}>
                    <span class="text-[10px] text-base-content/45 uppercase tracking-wider w-20 shrink-0">
                      {it.kind}
                      {it.category ? `·${it.category}` : ""}
                    </span>
                  </Show>
                  <span class="font-mono text-base-content/80 shrink-0">{it.qty}</span>
                </li>
              )}
            </For>
          </ul>
          <div class="mt-2 pt-2 border-t border-base-300/60 flex justify-between text-[11px] font-mono text-base-content/55">
            <span>{items().length} stacks</span>
            <span>∞ capacity</span>
          </div>
        </div>
      </Match>
    </Switch>
  );
}

/* ---------- MARKET BUY / SELL ---------- */
// The player's own resting global-market orders for this side (markets.md), live
// from `world.market`. A buy order is a bid, a sell order an ask. There is no
// all-goods public book on the wire, so the Overview condenses what is server-
// served without a selected good: the player's open orders. Best = highest bid
// / lowest ask. Offline or before the first push → an empty state.
type OrderRow = { good: string; name: string; price: number; qty: number; };

function MarketOrdersCard(props: { span: Span; side: "buy" | "sell"; }) {
  const game = useGame();
  const navigate = useNavigate();
  const T = () => tier(props.span);
  const tone = () => (props.side === "buy" ? "text-success" : "text-warning");
  const arrow = () => (props.side === "buy" ? "↓" : "↑");
  // Clicking an order opens the Market page with that good pre-selected.
  const openGood = (good: string) => navigate(`/global-market?good=${encodeURIComponent(good)}`);

  // Pull the goods catalog (for names) and the player's orders when online. Both
  // are idempotent reads; tracking only `online()` / the catalog length keeps
  // this from looping on its own `marketOrders` answer.
  createEffect(() => {
    if (!game.online()) return;
    if (!game.world.market?.goods.length) game.listMarketGoods();
    game.listMyOrders();
  });

  const goodName = (id: string) =>
    game.world.market?.goods.find((g) => g.id === id)?.name ?? id;

  // This side's orders, best price first (buy: highest, sell: lowest).
  const rows = (): OrderRow[] => {
    const orders = (game.world.market?.myOrders ?? []).filter((o) => o.side === props.side);
    orders.sort((a, b) => (props.side === "buy" ? b.price - a.price : a.price - b.price));
    return orders.map((o) => ({ good: o.good, name: goodName(o.good), price: o.price, qty: o.qty }));
  };

  const noun = () => (props.side === "buy" ? "bids" : "asks");
  const best = () => rows()[0]?.price;

  return (
    <Show
      when={game.world.market}
      fallback={
        <div class="h-full flex items-center justify-center text-center text-[11px] text-base-content/45 px-2">
          {game.online() ? "Loading the market…" : "Market needs a connection."}
        </div>
      }
    >
      <Show
        when={rows().length > 0}
        fallback={
          <div class="h-full flex items-center justify-center text-center text-[11px] text-base-content/40 px-2">
            No open {noun()}.
          </div>
        }
      >
        <Switch>
          <Match when={T() === "micro"}>
            <div class="h-full flex flex-col items-center justify-center text-center">
              <div class="text-[9px] uppercase tracking-wider text-base-content/50">
                your best {props.side === "buy" ? "bid" : "ask"}
              </div>
              <div class={"font-mono text-base " + tone()}>
                {arrow()}
                {best()}
                <span class="text-[10px] text-base-content/40">cr</span>
              </div>
            </div>
          </Match>

          <Match when={T() === "small"}>
            <ul class="h-full text-[11px] divide-y divide-base-300/40 font-mono overflow-hidden">
              <For each={rows().slice(0, 4)}>
                {(r) => (
                  <li>
                    <button
                      class="w-full flex justify-between py-0.5 hover:bg-base-300/40 rounded px-1 -mx-1"
                      title={`Trade ${r.name} on the market`}
                      onClick={() => openGood(r.good)}
                    >
                      <span class="truncate">{r.name}</span>
                      <span class={tone()}>
                        {arrow()}
                        {r.price}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Match>

          <Match when={true}>
            <div class="flex flex-col h-full">
              <div class="flex justify-between text-[10px] uppercase tracking-wider text-base-content/45 mb-1.5 px-1">
                <span>good</span>
                <span class="flex gap-4">
                  <span>price</span>
                  <span class="w-12 text-right">qty</span>
                </span>
              </div>
              <ul class="text-sm divide-y divide-base-300/40 overflow-y-auto flex-1 -mx-1 px-1">
                <For each={rows()}>
                  {(r) => (
                    <li>
                      <button
                        class="w-full flex items-baseline justify-between py-1 hover:bg-base-300/40 rounded px-1 -mx-1 text-left"
                        title={`Trade ${r.name} on the market`}
                        onClick={() => openGood(r.good)}
                      >
                        <span class="truncate">{r.name}</span>
                        <span class="flex items-baseline gap-4 font-mono shrink-0">
                          <span class={tone()}>
                            {arrow()}
                            {r.price}
                            <span class="text-base-content/40 text-xs">cr</span>
                          </span>
                          <span class="w-12 text-right text-base-content/70">
                            {r.qty.toLocaleString()}
                          </span>
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <div class="mt-2 pt-2 border-t border-base-300/60 flex justify-between text-[11px] font-mono text-base-content/55">
                <span>your open {noun()}</span>
                <span>
                  {rows().length} · best {arrow()}
                  {best()}cr
                </span>
              </div>
            </div>
          </Match>
        </Switch>
      </Show>
    </Show>
  );
}

/* ---------- FORMATION ---------- */
// The live roster from the game context (`world.roster`, the server's
// authoritative `roster` push): unit names + effective (trained + gear)
// stats. Canon (formations.md): a 5x5 grid with a soft cap of 5 occupied
// cells — grid positions aren't on the wire yet, so only the roster shows.
const ROSTER_SOFT_CAP = 5;
const ROSTER_STAT_KEYS = [
  ["str", "STR"],
  ["vit", "VIT"],
  ["dex", "DEX"],
  ["agi", "AGI"],
  ["int", "INT"],
  ["wis", "WIS"],
] as const;

function FormationCard(props: { span: Span; }) {
  const game = useGame();
  const navigate = useNavigate();
  const T = () => tier(props.span);
  const units = () => game.world.roster ?? [];
  const placedCount = () => game.world.formation?.length ?? 0;
  // Clicking a unit opens the Formation page on that unit's detail inspector.
  const openUnit = (id: string) => navigate(`/formation?unit=${encodeURIComponent(id)}`);

  return (
    <Switch>
      <Match when={T() === "micro"}>
        <div class="h-full flex flex-col items-center justify-center text-center">
          <div class="text-[9px] uppercase tracking-wider text-base-content/50">roster</div>
          <div class="font-mono text-sm">
            {units().length} · cap {ROSTER_SOFT_CAP}
          </div>
        </div>
      </Match>

      <Match when={T() === "small"}>
        <ul class="h-full text-[11px] flex flex-col gap-1 overflow-hidden">
          <For
            each={units()}
            fallback={
              <li class="text-base-content/40">Waiting for the roster snapshot…</li>
            }
          >
            {(u) => (
              <li>
                <button
                  class="w-full flex items-center gap-2 hover:bg-base-300/40 rounded px-1 -mx-1"
                  title={`Inspect ${u.name}`}
                  onClick={() => openUnit(u.id)}
                >
                  <span class="truncate flex-1 text-left">{u.name}</span>
                  <Show when={u.isPlayer}>
                    <span class="text-[9px] uppercase tracking-wider text-base-content/40">you</span>
                  </Show>
                  <span class="font-mono text-base-content/60">VIT {u.effective.vit}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Match>

      <Match when={true}>
        <div class="flex flex-col h-full">
          <div class="flex justify-between items-baseline mb-1.5">
            <span class="text-[10px] uppercase tracking-wider text-base-content/45">roster</span>
            <span class="text-[10px] font-mono text-base-content/55">
              {units().length} units · soft cap {ROSTER_SOFT_CAP}
            </span>
          </div>
          <ul class="text-sm divide-y divide-base-300/40 overflow-y-auto flex-1">
            <For
              each={units()}
              fallback={
                <li class="py-2 text-xs text-base-content/40">
                  Waiting for the roster snapshot…
                </li>
              }
            >
              {(u) => (
                <li>
                  <button
                    class="w-full text-left py-1.5 hover:bg-base-300/40 rounded px-1 -mx-1"
                    title={`Inspect ${u.name}`}
                    onClick={() => openUnit(u.id)}
                  >
                    <div class="flex items-baseline gap-2">
                      <span class="truncate min-w-0">{u.name}</span>
                      <Show when={u.isPlayer}>
                        <span class="badge badge-xs badge-soft">player</span>
                      </Show>
                      <Show when={u.equipment.length > 0}>
                        <span class="ml-auto text-[10px] text-base-content/45 shrink-0">
                          {u.equipment.length} equipped
                        </span>
                      </Show>
                    </div>
                    <div class="font-mono text-[10px] text-base-content/55 mt-0.5">
                      <For
                        each={
                          T() === "large"
                            ? [...ROSTER_STAT_KEYS]
                            : [...ROSTER_STAT_KEYS].slice(0, 2)
                        }
                      >
                        {([k, label]) => (
                          <span class="mr-2">
                            {label} {u.effective[k]}
                          </span>
                        )}
                      </For>
                    </div>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={T() === "large"}>
            <div class="mt-3 pt-3 border-t border-base-300/60 text-[11px] text-base-content/45">
              {placedCount()} of {units().length} placed on the grid — arrange them on the
              Formation page.
            </div>
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

/* ---------- ACTIVITY LOG ---------- */
// The live action log from the game context (`world.log`): per-tick combat
// narration, rewards, and failures, newest last (the Actions-page
// convention). The card shows the tail so the latest lines stay visible.
const LOG_TAG: Record<string, string> = {
  info: "text-base-content/55",
  combat: "text-base-content/80",
  failure: "text-error",
  reward: "text-success",
  local: "text-base-content/40 italic",
};

function LogCard(props: { span: Span; }) {
  const game = useGame();
  const T = () => tier(props.span);
  const tail = (n: number) => game.world.log.slice(-n);
  const latest = () => game.world.log[game.world.log.length - 1];
  const [input, setInput] = createSignal("");

  // Keep the newest line in view: scroll the list to the bottom whenever a line
  // arrives (and on a tier change that (re)mounts the list).
  let listEl: HTMLUListElement | undefined;
  createEffect(() => {
    game.world.log.length;
    T();
    if (listEl) listEl.scrollTop = listEl.scrollHeight;
  });

  // The MUD-interaction surface, same as the Actions-page log (Actions.tsx):
  // zone interactions aren't served yet, so it echoes locally for now.
  const submit = (e: Event) => {
    e.preventDefault();
    const cmd = input().trim();
    if (!cmd) return;
    setInput("");
    game.logLocal(`> ${cmd}`);
    game.logLocal("Nothing answers. (Zone interactions are not available yet.)");
  };

  return (
    <Switch>
      <Match when={T() === "micro"}>
        <div class="h-full flex flex-col justify-center font-mono text-[10px] leading-tight">
          <Show
            when={latest()}
            fallback={<div class="text-base-content/35">— the log is quiet —</div>}
          >
            {(l) => <div class={"truncate " + (LOG_TAG[l().kind] ?? "")}>{l().text}</div>}
          </Show>
        </div>
      </Match>

      <Match when={true}>
        <div class="h-full flex flex-col gap-1.5 min-h-0">
          <ul
            ref={listEl}
            class="font-mono flex-1 min-h-0 overflow-y-auto"
            style={{
              "font-size": T() === "small" ? "11px" : "12px",
              "line-height": "1.55",
            }}
          >
            <For
              each={tail(T() === "small" ? 4 : 50)}
              fallback={<li class="text-base-content/35">— the log is quiet —</li>}
            >
              {(l) => (
                <li class="flex gap-2 py-0.5">
                  <Show when={T() !== "small"}>
                    <span class={"shrink-0 uppercase text-[10px] mt-[2px] w-12 " + (LOG_TAG[l.kind] ?? "")}>
                      {l.kind}
                    </span>
                  </Show>
                  <span class={"truncate " + (LOG_TAG[l.kind] ?? "text-base-content/85")}>
                    {l.text}
                  </span>
                </li>
              )}
            </For>
          </ul>
          {/* The interaction input — only where there's room (medium/large). */}
          <Show when={T() !== "small"}>
            <form class="flex gap-1.5 shrink-0" onSubmit={submit}>
              <input
                type="text"
                placeholder="Interact with the zone…"
                class="input input-xs grow"
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
              />
              <button
                type="submit"
                class="btn btn-xs"
                classList={{ "btn-success": input().trim().length > 0 }}
                disabled={input().trim().length === 0}
              >
                Send
              </button>
            </form>
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

/* ---------- the registry the Overview grid renders ---------- */
export const CARDS: CardDef[] = [
  { id: "action", title: "Current Action", route: "/actions", defSpan: { col: 4, row: 2 }, Body: ActionCard },
  { id: "map", title: "Map", route: "/area", defSpan: { col: 4, row: 2 }, Body: MapCard },
  { id: "inventory", title: "Inventory", route: "/inventory", defSpan: { col: 4, row: 4 }, Body: InventoryCard },
  {
    id: "buy",
    title: "Market · Buy",
    route: "/global-market",
    defSpan: { col: 4, row: 2 },
    badge: "BIDS",
    Body: (p) => <MarketOrdersCard span={p.span} side="buy" />,
  },
  {
    id: "sell",
    title: "Market · Sell",
    route: "/global-market",
    defSpan: { col: 4, row: 2 },
    badge: "ASKS",
    Body: (p) => <MarketOrdersCard span={p.span} side="sell" />,
  },
  { id: "log", title: "Activity Log", route: "/actions", defSpan: { col: 8, row: 2 }, badge: "LIVE", Body: LogCard },
  { id: "formation", title: "Formation", route: "/formation", defSpan: { col: 4, row: 2 }, Body: FormationCard },
];

export const CARDS_BY_ID: Record<string, CardDef> = Object.fromEntries(
  CARDS.map((c) => [c.id, c]),
);
