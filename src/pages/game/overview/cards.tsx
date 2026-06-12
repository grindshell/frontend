import { For, Match, Show, Switch, createEffect, type JSX } from "solid-js";
import { actionTarget, summarizeRewards, useGame } from "../../../lib/game-context";
import type { MapZoneInfo } from "../../../lib/protocol";

// Overview cards — condensed views of the underlying game pages. Each body
// receives a { col, row } span and adapts its density to the card's area.
// Tiers: micro (area<=2) · small (<=6) · medium (<=15) · large (>15).

export type Span = { col: number; row: number };
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
  Body: (props: { span: Span }) => JSX.Element;
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
  execution: "fighting",
  downtime: "downtime",
  regroup: "regrouping",
  resolution: "resolving",
};

function ActionCard(props: { span: Span }) {
  const game = useGame();
  const T = () => tier(props.span);
  const action = () => game.world.action;

  return (
    <Show
      when={action()}
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
            <div class="flex flex-col h-full gap-3">
              <div class="flex items-baseline gap-2 flex-wrap">
                <span class="font-mono text-2xl font-semibold tracking-tight uppercase">
                  {a().kind}
                </span>
                <span class="text-xs text-base-content/50">vs {actionTarget(a())}</span>
              </div>
              <div class="space-y-1.5">
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
              <div class="grid grid-cols-3 gap-2 mt-auto text-center">
                <Stat
                  label="formation hp"
                  value={a().formationHp}
                  sub={`/${a().formationMaxHp}`}
                  tone={a().formationHp < a().formationMaxHp / 2 ? "warning" : undefined}
                />
                <Stat label="phase" value={PHASE_LABEL[a().phase] ?? a().phase} />
                <Stat label="kills" value={a().tally.kills} />
              </div>
              <Show when={T() === "large"}>
                <div class="border-t border-base-300/60 pt-3 mt-1 text-[11px]">
                  <div class="text-[10px] uppercase tracking-wider text-base-content/45 mb-1">
                    accrued (commits when the action ends)
                  </div>
                  <div class="font-mono text-base-content/75 leading-relaxed">
                    {summarizeRewards(a().tally)}
                  </div>
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
// A live 3x3 neighbourhood from the game context (`world.map`, the server's
// `mapView` push — the same source the Area page renders): the current zone at
// the centre plus its eight grid neighbours on the current Z-plane, north up.
// Requests the map when online; offline / before the first push it shows a
// compact empty state rather than invented zones (frontend CLAUDE.md §6). The
// micro tier is too small for the grid, so it falls back to just the current
// zone. Only wire-served fields are shown — no biome/weather/visited% flavour.

type MapVec = { x: number; y: number; z: number };
const parseMapPos = (s: string): MapVec => {
  const [x, y, z] = s.split(",").map(Number);
  return { x, y, z };
};

/** Danger text tone for a neighbour's number (1 safe → 5 lethal). */
const dangerTone = (d: number): string =>
  d <= 1 ? "text-base-content/70" : d <= 3 ? "text-warning" : "text-error";

type MiniCellInfo = { zone: MapZoneInfo | null; isCurrent: boolean };

function MiniCell(props: { cell: MiniCellInfo }) {
  const z = () => props.cell.zone;
  const cur = () => props.cell.isCurrent;
  return (
    <div
      class="rounded-sm flex items-center justify-center leading-none font-mono"
      classList={{
        "bg-primary text-primary-content font-bold": cur(),
        "bg-base-300/70": !cur() && !!z() && z()!.discovered,
        "border border-dashed border-base-content/40": !cur() && !!z() && !z()!.discovered,
        "bg-base-300/15": !cur() && !z(),
      }}
    >
      <Show when={cur()} fallback={<Show when={z()}>{(zz) => <span class={dangerTone(zz().danger)}>{zz().danger}</span>}</Show>}>
        @
      </Show>
    </div>
  );
}

/** The 3x3 grid itself — a square that scales to its column up to `cap`. */
function MiniMap(props: { cells: MiniCellInfo[]; cap: string; fontClass: string }) {
  return (
    <div
      class={"grid grid-cols-3 grid-rows-3 gap-0.5 aspect-square mx-auto " + props.fontClass}
      style={`width: min(100%, ${props.cap});`}
    >
      <For each={props.cells}>{(c) => <MiniCell cell={c} />}</For>
    </div>
  );
}

function MapEmpty() {
  return (
    <div class="h-full flex flex-col items-center justify-center text-center gap-1 text-base-content/45">
      <span class="font-mono text-base-content/30 tracking-widest">· · ·</span>
      <span class="text-[11px]">The map streams from the server.</span>
    </div>
  );
}

function Coord(props: { k: string; v: string }) {
  return (
    <div class="flex justify-between gap-2 border-b border-base-300/60 pb-0.5">
      <dt class="text-base-content/45 uppercase tracking-wider text-[10px] mt-0.5">{props.k}</dt>
      <dd class="font-mono text-base-content/80 truncate">{props.v}</dd>
    </div>
  );
}

function MapCard(props: { span: Span }) {
  const game = useGame();
  const T = () => tier(props.span);
  const map = () => game.world.map;
  const currentKey = () => map()?.current ?? game.world.zone;
  const current = () => parseMapPos(currentKey());
  const currentZone = () => map()?.zones.find((z) => z.pos === currentKey()) ?? null;
  const known = () => map()?.zones.filter((z) => z.discovered).length ?? 0;

  // Pull the map when connected — the connect-time push doesn't include it
  // (listMap is on-demand). Tracks zone + online only, like the Area page.
  createEffect(() => {
    void game.world.zone;
    if (game.online()) game.listMap();
  });

  // The 3x3 window on the current Z-plane in display order (north up):
  // rows dy = +1, 0, −1 · cols dx = −1, 0, +1.
  const cells = (): MiniCellInfo[] => {
    const c = current();
    const m = map();
    const out: MiniCellInfo[] = [];
    for (const dy of [1, 0, -1]) {
      for (const dx of [-1, 0, 1]) {
        const key = `${c.x + dx},${c.y + dy},${c.z}`;
        const zone = m?.zones.find((z) => z.pos === key) ?? null;
        out.push({ zone, isCurrent: dx === 0 && dy === 0 });
      }
    }
    return out;
  };

  const coordStr = () => `(${current().x}, ${current().y}, ${current().z})`;

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

      <Match when={T() === "small"}>
        <Show when={map()} fallback={<MapEmpty />}>
          <div class="h-full flex flex-col justify-center gap-1.5">
            <MiniMap cells={cells()} cap="6.5rem" fontClass="text-[10px]" />
            <div class="text-[10px] font-mono text-base-content/55 flex justify-between gap-2">
              <span class="truncate">{currentZone()?.name ?? "Unknown"}</span>
              <span class="shrink-0">
                ({current().x},{current().y})
              </span>
            </div>
          </div>
        </Show>
      </Match>

      <Match when={T() === "medium"}>
        <Show when={map()} fallback={<MapEmpty />}>
          <div class="flex h-full gap-3 items-center">
            <div class="flex-1 min-w-0">
              <MiniMap cells={cells()} cap="8.5rem" fontClass="text-xs" />
            </div>
            <dl class="text-[11px] space-y-1 w-28 shrink-0">
              <Coord k="zone" v={currentZone()?.name ?? "Unknown"} />
              <Coord k="coords" v={coordStr()} />
              <Coord k="danger" v={currentZone() ? String(currentZone()!.danger) : "—"} />
              <Coord k="known" v={`${known()} zones`} />
            </dl>
          </div>
        </Show>
      </Match>

      <Match when={true}>
        <Show when={map()} fallback={<MapEmpty />}>
          <div class="flex h-full gap-4 items-center">
            <div class="flex-1 min-w-0">
              <MiniMap cells={cells()} cap="11rem" fontClass="text-sm" />
            </div>
            <div class="w-40 shrink-0 flex flex-col gap-2">
              <dl class="text-[11px] space-y-1">
                <Coord k="zone" v={currentZone()?.name ?? "Unknown"} />
                <Coord k="coords" v={coordStr()} />
                <Coord k="danger" v={currentZone() ? String(currentZone()!.danger) : "—"} />
                <Coord k="known" v={`${known()} discovered`} />
              </dl>
              <div class="border-t border-base-300/60 pt-2 mt-1 text-[11px] space-y-1">
                <div class="text-[10px] uppercase tracking-wider text-base-content/45">legend</div>
                <div class="flex items-center gap-2">
                  <span class="text-primary font-mono">@</span> <span>you</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="inline-block size-3 rounded-sm bg-base-300/70" />{" "}
                  <span>discovered (danger #)</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="inline-block size-3 rounded-sm border border-dashed border-base-content/40" />{" "}
                  <span>frontier</span>
                </div>
              </div>
            </div>
          </div>
        </Show>
      </Match>
    </Switch>
  );
}

/* ---------- INVENTORY ---------- */
// Live committed holdings from the game context (the server's authoritative
// `inventory` push). Zeros until the first push (offline / not yet connected).

function InventoryCard(props: { span: Span }) {
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
const MARKET = {
  buy: [
    { i: "Iron Ore", p: 22, q: 600 },
    { i: "Bone Splinter", p: 41, q: 90 },
    { i: "Healing Draught", p: 174, q: 12 },
    { i: "Copper Ingot", p: 84, q: 210 },
    { i: "Lockpick", p: 33, q: 40 },
    { i: "Pyrite Shard", p: 14, q: 320 },
    { i: "Steel Hauberk", p: 980, q: 1 },
  ],
  sell: [
    { i: "Iron Ore", p: 24, q: 1200 },
    { i: "Copper Ingot", p: 88, q: 340 },
    { i: "Steel Plate", p: 412, q: 18 },
    { i: "Bandage", p: 9, q: 220 },
    { i: "Pyrite Shard", p: 16, q: 510 },
    { i: "Rationed Bread", p: 6, q: 480 },
    { i: "Pickaxe (Tier 2)", p: 740, q: 3 },
  ],
};

function MarketOrdersCard(props: { span: Span; side: "buy" | "sell" }) {
  const T = () => tier(props.span);
  const rows = () => MARKET[props.side];
  const tone = () => (props.side === "buy" ? "text-success" : "text-warning");
  const arrow = () => (props.side === "buy" ? "↓" : "↑");

  return (
    <Switch>
      <Match when={T() === "micro"}>
        <div class="h-full flex flex-col items-center justify-center text-center">
          <div class="text-[9px] uppercase tracking-wider text-base-content/50">
            best {props.side === "buy" ? "bid" : "ask"}
          </div>
          <div class={"font-mono text-base " + tone()}>
            {arrow()}
            {rows()[0].p}
            <span class="text-[10px] text-base-content/40">cr</span>
          </div>
        </div>
      </Match>

      <Match when={T() === "small"}>
        <ul class="h-full text-[11px] divide-y divide-base-300/40 font-mono overflow-hidden">
          <For each={rows().slice(0, 4)}>
            {(r) => (
              <li class="flex justify-between py-0.5">
                <span class="truncate">{r.i}</span>
                <span class={tone()}>
                  {arrow()}
                  {r.p}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Match>

      <Match when={true}>
        <div class="flex flex-col h-full">
          <div class="flex justify-between text-[10px] uppercase tracking-wider text-base-content/45 mb-1.5 px-1">
            <span>item</span>
            <span class="flex gap-4">
              <span>price</span>
              <span class="w-12 text-right">qty</span>
            </span>
          </div>
          <ul class="text-sm divide-y divide-base-300/40 overflow-y-auto flex-1 -mx-1 px-1">
            <For each={rows()}>
              {(r) => (
                <li class="flex items-baseline justify-between py-1">
                  <span class="truncate">{r.i}</span>
                  <span class="flex items-baseline gap-4 font-mono shrink-0">
                    <span class={tone()}>
                      {arrow()}
                      {r.p}
                      <span class="text-base-content/40 text-xs">cr</span>
                    </span>
                    <span class="w-12 text-right text-base-content/70">
                      {r.q.toLocaleString()}
                    </span>
                  </span>
                </li>
              )}
            </For>
          </ul>
          <div class="mt-2 pt-2 border-t border-base-300/60 flex justify-between text-[11px] font-mono text-base-content/55">
            <span>open {props.side === "buy" ? "bids" : "asks"}</span>
            <span>
              {rows().length} · best {arrow()}
              {rows()[0].p}cr
            </span>
          </div>
        </div>
      </Match>
    </Switch>
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

function FormationCard(props: { span: Span }) {
  const game = useGame();
  const T = () => tier(props.span);
  const units = () => game.world.roster ?? [];
  const placedCount = () => game.world.formation?.length ?? 0;

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
              <li class="flex items-center gap-2">
                <span class="truncate flex-1">{u.name}</span>
                <Show when={u.isPlayer}>
                  <span class="text-[9px] uppercase tracking-wider text-base-content/40">you</span>
                </Show>
                <span class="font-mono text-base-content/60">VIT {u.effective.vit}</span>
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
                <li class="py-1.5">
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

function LogCard(props: { span: Span }) {
  const game = useGame();
  const T = () => tier(props.span);
  const tail = (n: number) => game.world.log.slice(-n);
  const latest = () => game.world.log[game.world.log.length - 1];

  // Keep the newest line in view: scroll the list to the bottom whenever a line
  // arrives (and on a tier change that (re)mounts the list).
  let listEl: HTMLUListElement | undefined;
  createEffect(() => {
    game.world.log.length;
    T();
    if (listEl) listEl.scrollTop = listEl.scrollHeight;
  });

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
        <ul
          ref={listEl}
          class="font-mono h-full overflow-y-auto"
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
      </Match>
    </Switch>
  );
}

/* ---------- the registry the Overview grid renders ---------- */
export const CARDS: CardDef[] = [
  { id: "action", title: "Current Action", route: "/actions", defSpan: { col: 4, row: 2 }, Body: ActionCard },
  { id: "map", title: "Map", route: "/area", defSpan: { col: 4, row: 2 }, Body: MapCard },
  { id: "inventory", title: "Inventory", route: "/inventory", defSpan: { col: 4, row: 4 }, Body: InventoryCard },
  { id: "formation", title: "Formation", route: "/formation", defSpan: { col: 4, row: 2 }, Body: FormationCard },
  {
    id: "buy",
    title: "Market · Buy",
    route: "/global-market",
    defSpan: { col: 4, row: 2 },
    badge: "BIDS",
    Body: (p) => <MarketOrdersCard span={p.span} side="buy" />,
  },
  { id: "log", title: "Activity Log", route: "/actions", defSpan: { col: 8, row: 2 }, badge: "LIVE", Body: LogCard },
  {
    id: "sell",
    title: "Market · Sell",
    route: "/global-market",
    defSpan: { col: 4, row: 2 },
    badge: "ASKS",
    Body: (p) => <MarketOrdersCard span={p.span} side="sell" />,
  },
];

export const CARDS_BY_ID: Record<string, CardDef> = Object.fromEntries(
  CARDS.map((c) => [c.id, c]),
);
