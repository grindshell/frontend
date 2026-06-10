import {
  For,
  Match,
  Show,
  Switch,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

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
function ActionCard(props: { span: Span }) {
  const [tick, setTick] = createSignal(0);
  onMount(() => {
    const t = setInterval(() => setTick((x) => (x + 1) % 100), 120);
    onCleanup(() => clearInterval(t));
  });
  const T = () => tier(props.span);

  return (
    <Switch>
      <Match when={T() === "micro"}>
        <div class="h-full flex flex-col justify-between">
          <div class="font-mono text-sm font-semibold">TRAVEL</div>
          <progress class="progress progress-primary w-full h-1" value={tick()} max="100" />
          <div class="font-mono text-[10px] text-base-content/50">14/18 · {tick()}%</div>
        </div>
      </Match>

      <Match when={T() === "small"}>
        <div class="h-full flex flex-col gap-2">
          <div class="font-mono text-lg font-semibold leading-tight">TRAVEL</div>
          <div class="text-[11px] text-base-content/50 -mt-1">→ Sector 04 / Ridgeline</div>
          <progress class="progress progress-primary w-full h-1.5" value={tick()} max="100" />
          <div class="flex justify-between text-[10px] font-mono text-base-content/60">
            <span>14/18 steps</span>
            <span>{tick()}%</span>
          </div>
        </div>
      </Match>

      <Match when={true}>
        <div class="flex flex-col h-full gap-3">
          <div class="flex items-baseline gap-2 flex-wrap">
            <span class="font-mono text-2xl font-semibold tracking-tight">TRAVEL</span>
            <span class="text-xs text-base-content/50">→ Sector 04 / Ridgeline</span>
          </div>
          <div class="space-y-1.5">
            <div class="flex justify-between text-[11px] font-mono text-base-content/60">
              <span>step 14 / 18</span>
              <span>{tick()}%</span>
            </div>
            <progress class="progress progress-primary w-full h-1.5" value={tick()} max="100" />
          </div>
          <div class="grid grid-cols-3 gap-2 mt-auto text-center">
            <Stat label="energy" value="78" sub="/100" />
            <Stat label="eta" value="03:42" sub="m" />
            <Stat label="encounters" value="2" sub="hostile" tone="warning" />
          </div>
          <Show when={T() === "large"}>
            <div class="border-t border-base-300/60 pt-3 mt-1 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <div class="text-[10px] uppercase tracking-wider text-base-content/45 mb-1">
                  queued route
                </div>
                <div class="font-mono text-base-content/75 leading-relaxed">
                  Down · Down · North · Down · Down · East · …
                </div>
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-wider text-base-content/45 mb-1">
                  recent
                </div>
                <ul class="font-mono text-[11px] text-base-content/70 space-y-0.5">
                  <li>14:42:11 — entered Ridgeline</li>
                  <li>14:40:02 — picked up Pyrite ×8</li>
                  <li>14:38:10 — chat: pulling north</li>
                </ul>
              </div>
            </div>
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

/* ---------- MAP ---------- */
const MAP_GRID = [
  "............",
  "..####..####",
  "..#..#..#*.#",
  "..#..####..#",
  "...P........",
  "##..####..##",
];
const BIG_MAP = [
  "................................",
  "....####..####..........####....",
  "....#..#..#*.#..........#..#....",
  "....#..####..#..........####....",
  ".....P.........................*",
  "##..####..##....####..########..",
  "................################",
  "....####..####..####..#......#..",
  "................................",
];

function MapGlyph(props: { ch: string }) {
  return (
    <Switch fallback={<span class="text-base-content/15">·</span>}>
      <Match when={props.ch === "P"}>
        <span class="text-primary font-bold">@</span>
      </Match>
      <Match when={props.ch === "*"}>
        <span class="text-warning">◆</span>
      </Match>
      <Match when={props.ch === "#"}>
        <span class="text-base-content/30">█</span>
      </Match>
    </Switch>
  );
}

function MapAscii(props: { grid: string[]; class?: string }) {
  return (
    <div class={"whitespace-pre " + (props.class ?? "")}>
      <For each={props.grid}>
        {(row) => (
          <div>
            <For each={[...row]}>{(ch) => <MapGlyph ch={ch} />}</For>
          </div>
        )}
      </For>
    </div>
  );
}

function Coord(props: { k: string; v: string }) {
  return (
    <div class="flex justify-between gap-2 border-b border-base-300/60 pb-0.5">
      <dt class="text-base-content/45 uppercase tracking-wider text-[10px] mt-0.5">{props.k}</dt>
      <dd class="font-mono text-base-content/80">{props.v}</dd>
    </div>
  );
}

function MapCard(props: { span: Span }) {
  const T = () => tier(props.span);
  return (
    <Switch>
      <Match when={T() === "micro"}>
        <div class="h-full flex items-center justify-center font-mono text-[10px] text-base-content/65">
          <span class="text-primary mr-1">@</span> (14,7)
        </div>
      </Match>

      <Match when={T() === "small"}>
        <div class="h-full flex flex-col justify-center">
          <MapAscii grid={MAP_GRID} class="font-mono text-[10px] leading-[12px] overflow-hidden" />
          <div class="text-[10px] font-mono text-base-content/55 mt-1.5 flex justify-between">
            <span>Ridgeline</span>
            <span>(14,7)</span>
          </div>
        </div>
      </Match>

      <Match when={T() === "medium"}>
        <div class="flex h-full gap-3">
          <MapAscii
            grid={MAP_GRID}
            class="font-mono text-[12px] leading-[14px] flex-1 overflow-hidden bg-base-300/40 rounded p-2 text-base-content/70"
          />
          <dl class="text-[11px] space-y-1 w-28 shrink-0">
            <Coord k="zone" v="Ridgeline" />
            <Coord k="coords" v="(14,7)" />
            <Coord k="biome" v="alpine" />
            <Coord k="visited" v="62%" />
          </dl>
        </div>
      </Match>

      <Match when={true}>
        <div class="flex h-full gap-4">
          <MapAscii
            grid={BIG_MAP}
            class="font-mono text-[14px] leading-[15px] flex-1 overflow-hidden bg-base-300/40 rounded p-3 text-base-content/70"
          />
          <div class="w-40 shrink-0 flex flex-col gap-2">
            <dl class="text-[11px] space-y-1">
              <Coord k="zone" v="Ridgeline" />
              <Coord k="coords" v="(14,7)" />
              <Coord k="biome" v="alpine" />
              <Coord k="visited" v="62%" />
              <Coord k="danger" v="moderate" />
              <Coord k="weather" v="windy" />
            </dl>
            <div class="border-t border-base-300/60 pt-2 mt-1 text-[11px] space-y-1">
              <div class="text-[10px] uppercase tracking-wider text-base-content/45">legend</div>
              <div class="flex items-center gap-2">
                <span class="text-primary font-mono">@</span> <span>you</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-warning font-mono">◆</span> <span>point of interest</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-base-content/40 font-mono">█</span> <span>blocked</span>
              </div>
            </div>
          </div>
        </div>
      </Match>
    </Switch>
  );
}

/* ---------- INVENTORY ---------- */
const INV_ITEMS = [
  { n: "Iron Ore", q: 142, w: "kg", t: "resource" },
  { n: "Copper Ingot", q: 31, w: "kg", t: "material" },
  { n: "Rationed Bread", q: 12, w: "ct", t: "consumable" },
  { n: "Bone Splinter", q: 8, w: "ct", t: "reagent" },
  { n: "Steel Hauberk", q: 1, w: "eq", t: "armor", eq: true },
  { n: "Pickaxe (Tier 2)", q: 1, w: "eq", t: "tool", eq: true },
  { n: "Bandage", q: 6, w: "ct", t: "consumable" },
  { n: "Pyrite Shard", q: 44, w: "ct", t: "reagent" },
  { n: "Lockpick", q: 3, w: "ct", t: "tool" },
  { n: "Healing Draught", q: 2, w: "ct", t: "consumable" },
];

function InventoryCard(props: { span: Span }) {
  const T = () => tier(props.span);
  return (
    <Switch>
      <Match when={T() === "micro"}>
        <div class="h-full flex flex-col justify-center text-center">
          <div class="text-[10px] uppercase tracking-wider text-base-content/50">credits</div>
          <div class="font-mono text-base leading-tight">
            12,480<span class="text-xs text-base-content/40">cr</span>
          </div>
        </div>
      </Match>

      <Match when={T() === "small"}>
        <div class="h-full flex flex-col gap-1.5">
          <div class="grid grid-cols-2 gap-1.5">
            <div class="rounded bg-base-300/50 px-1.5 py-1">
              <div class="text-[9px] uppercase tracking-wider text-base-content/50">cr</div>
              <div class="font-mono text-sm">12,480</div>
            </div>
            <div class="rounded bg-base-300/50 px-1.5 py-1">
              <div class="text-[9px] uppercase tracking-wider text-base-content/50">dust</div>
              <div class="font-mono text-sm">847</div>
            </div>
          </div>
          <div class="text-[10px] font-mono text-base-content/55 flex justify-between mt-auto pt-1 border-t border-base-300/60">
            <span>{INV_ITEMS.length} items</span>
            <span>183 / 240 kg</span>
          </div>
        </div>
      </Match>

      <Match when={true}>
        <div class="flex flex-col h-full">
          <div class="grid grid-cols-2 gap-2 mb-3">
            <div class="rounded bg-base-300/50 px-2 py-1.5">
              <div class="text-[10px] uppercase tracking-wider text-base-content/50">credits</div>
              <div class="font-mono text-lg leading-tight">
                12,480<span class="text-xs text-base-content/40">cr</span>
              </div>
            </div>
            <div class="rounded bg-base-300/50 px-2 py-1.5">
              <div class="text-[10px] uppercase tracking-wider text-base-content/50">dust</div>
              <div class="font-mono text-lg leading-tight">
                847<span class="text-xs text-base-content/40">d</span>
              </div>
            </div>
          </div>
          <div
            class={
              "flex text-[10px] uppercase tracking-wider text-base-content/45 mb-1 px-1 " +
              (T() === "large" ? "gap-4" : "justify-between")
            }
          >
            <span class="flex-1">item</span>
            <Show when={T() === "large"}>
              <span class="w-16">type</span>
            </Show>
            <span>qty</span>
          </div>
          <ul class="overflow-y-auto flex-1 -mx-1 px-1 text-sm divide-y divide-base-300/40">
            <For each={INV_ITEMS}>
              {(it) => (
                <li class="flex items-baseline gap-2 py-1">
                  <div class="flex items-center gap-1.5 min-w-0 flex-1">
                    <Show when={it.eq}>
                      <span class="text-[9px] text-success border border-success/40 px-1 rounded">
                        EQ
                      </span>
                    </Show>
                    <span class="truncate">{it.n}</span>
                  </div>
                  <Show when={T() === "large"}>
                    <span class="text-[10px] text-base-content/45 uppercase tracking-wider w-16 shrink-0">
                      {it.t}
                    </span>
                  </Show>
                  <span class="font-mono text-base-content/80 shrink-0">
                    {it.q}
                    <span class="text-base-content/40 text-xs">{it.w}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
          <div class="mt-2 pt-2 border-t border-base-300/60 flex justify-between text-[11px] font-mono text-base-content/55">
            <span>weight</span>
            <span>183 / 240 kg</span>
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
type Unit = { id: number; n: string; role: string; hp: number; status: string };
const UNITS: Unit[] = [
  { id: 2, n: "Adventurer", role: "Vanguard", hp: 88, status: "ok" },
  { id: 3, n: "Brigid", role: "Medic", hp: 72, status: "ok" },
  { id: 5, n: "Hollow-7", role: "Skirmish", hp: 41, status: "hurt" },
  { id: 7, n: "Vex", role: "Sapper", hp: 64, status: "ok" },
];
const statusTone = (s: string) =>
  s === "hurt" ? "text-warning" : s === "down" ? "text-error" : "text-success";
const hpBar = (hp: number) =>
  hp > 70 ? "bg-success h-full" : hp > 40 ? "bg-warning h-full" : "bg-error h-full";

function FormationCard(props: { span: Span }) {
  const T = () => tier(props.span);
  const avgHp = Math.round(UNITS.reduce((a, u) => a + u.hp, 0) / UNITS.length);

  return (
    <Switch>
      <Match when={T() === "micro"}>
        <div class="h-full flex flex-col items-center justify-center text-center">
          <div class="text-[9px] uppercase tracking-wider text-base-content/50">squad</div>
          <div class="font-mono text-sm">
            {UNITS.length}/6 · {avgHp}hp
          </div>
        </div>
      </Match>

      <Match when={T() === "small"}>
        <ul class="h-full text-[11px] flex flex-col gap-1">
          <For each={UNITS}>
            {(u) => (
              <li class="flex items-center gap-2">
                <span class="font-mono text-[10px] text-base-content/40">#{u.id}</span>
                <span class="truncate flex-1">{u.n}</span>
                <span class={"font-mono " + statusTone(u.status)}>{u.hp}</span>
              </li>
            )}
          </For>
        </ul>
      </Match>

      <Match when={true}>
        <div class="flex flex-col h-full">
          <div class="flex justify-between items-baseline mb-1.5">
            <span class="text-[10px] uppercase tracking-wider text-base-content/45">main squad</span>
            <span class="text-[10px] font-mono text-base-content/55">
              {UNITS.length} / 6 deployed
            </span>
          </div>
          <ul class="text-sm divide-y divide-base-300/40 overflow-y-auto flex-1">
            <For each={UNITS}>
              {(u) => (
                <li class="flex items-center gap-3 py-1.5">
                  <span class="font-mono text-[10px] text-base-content/40 w-5">#{u.id}</span>
                  <span class="flex-1 min-w-0">
                    <span class="truncate block leading-tight">{u.n}</span>
                    <span class="text-[10px] text-base-content/45">{u.role}</span>
                  </span>
                  <div class="w-16">
                    <div class="text-[10px] font-mono text-right text-base-content/60 leading-none mb-0.5">
                      {u.hp}
                    </div>
                    <div class="h-1 bg-base-300 rounded overflow-hidden">
                      <div class={hpBar(u.hp)} style={{ width: `${u.hp}%` }} />
                    </div>
                  </div>
                  <span class={"text-[10px] uppercase font-medium w-10 text-right " + statusTone(u.status)}>
                    {u.status}
                  </span>
                </li>
              )}
            </For>
          </ul>
          <Show when={T() === "large"}>
            <div class="mt-3 pt-3 border-t border-base-300/60 grid grid-cols-3 gap-2 text-center">
              <Stat label="formation" value="Wedge" />
              <Stat label="morale" value="+12" />
              <Stat label="cohesion" value="84" sub="/100" />
            </div>
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

/* ---------- ACTIVITY LOG ---------- */
const LOG_LINES = [
  { t: "14:42:11", k: "info", m: "Stepped into Ridgeline (14,7)." },
  { t: "14:41:58", k: "warn", m: "Hostile signal detected — 2 entities." },
  { t: "14:41:30", k: "info", m: "Travel queue: 14 / 18 steps remaining." },
  { t: "14:40:02", k: "loot", m: "Picked up 8× Pyrite Shard." },
  { t: "14:39:11", k: "trade", m: "Sell order filled: 60× Iron Ore @ 24cr." },
  { t: "14:38:44", k: "info", m: "Energy regen +4 (rationed bread)." },
  { t: "14:38:10", k: "chat", m: "@vex: pulling north on my mark." },
  { t: "14:37:55", k: "warn", m: "Bandage stock low (6 remaining)." },
  { t: "14:37:20", k: "info", m: "Crossed waypoint marker β-3." },
  { t: "14:36:48", k: "loot", m: "Picked up 12× Iron Ore." },
];
const LOG_TAG: Record<string, string> = {
  info: "text-base-content/50",
  warn: "text-warning",
  loot: "text-success",
  trade: "text-primary",
  chat: "text-info",
};

function LogCard(props: { span: Span }) {
  const T = () => tier(props.span);
  const lines = () => (T() === "small" ? LOG_LINES.slice(0, 4) : LOG_LINES);

  return (
    <Switch>
      <Match when={T() === "micro"}>
        <div class="h-full flex flex-col justify-center font-mono text-[10px] text-base-content/70 leading-tight">
          <div class="text-base-content/40">14:42</div>
          <div class="truncate">Stepped into Ridgeline.</div>
        </div>
      </Match>

      <Match when={true}>
        <ul
          class="font-mono h-full overflow-y-auto"
          style={{
            "font-size": T() === "small" ? "11px" : "12px",
            "line-height": "1.55",
          }}
        >
          <For each={lines()}>
            {(l) => (
              <li class="flex gap-2 py-0.5">
                <span class="text-base-content/30 shrink-0">{l.t}</span>
                <Show when={T() !== "small"}>
                  <span class={"shrink-0 uppercase text-[10px] mt-[2px] w-12 " + LOG_TAG[l.k]}>
                    {l.k}
                  </span>
                </Show>
                <span class="text-base-content/85 truncate">{l.m}</span>
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
  { id: "inventory", title: "Inventory", route: "/profile", defSpan: { col: 4, row: 4 }, Body: InventoryCard },
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
