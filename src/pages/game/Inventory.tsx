import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useGame } from "../../lib/game-context";
import type { ItemStackView } from "../../lib/protocol";
import { STAT_KEYS, failingReqs, statsSummary } from "../../lib/stats";
import { TickRateBadge } from "../../components/TickRateBadge";

// The inventory screen: the player's committed holdings (inventory.md), live
// from the server's authoritative `inventory` push, plus the gear/equipment
// surface over the roster push. Rewards land here only at action end
// (actions.md "Reward delivery") — accruing tallies live on the Actions
// screen, not here. Consumables are usable on the player's own formation, and
// the resulting formation-scoped Zone Effects surface in the Active effects
// panel with a live countdown (zone-effects.md).

/** Display metadata for the fixed resource classes (resources.md). */
const CURRENCY_ROWS = [
  { key: "credits", label: "Credits", short: "cr" },
  { key: "dust", label: "Dust", short: "du" },
  { key: "rousingDevices", label: "Rousing Devices", short: "ro" },
] as const;

const GENERAL_ROWS = [
  { key: "bio", label: "Biological" },
  { key: "met", label: "Metallurgical" },
  { key: "ele", label: "Electrical" },
  { key: "liq", label: "Liquid" },
] as const;

const fmt = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

export function Inventory() {
  const game = useGame();
  const inv = () => game.world.inventory;
  const [useError, setUseError] = createSignal<string | null>(null);
  const onUse = (id: string) => {
    setUseError(null);
    game.useConsumable(id, (reason) => setUseError(reason ?? "could not use that item"));
  };

  // Item stacks split by kind; item resources sorted by category then name so
  // the grouping label reads top-to-bottom.
  const resources = createMemo(() =>
    (inv()?.items ?? [])
      .filter((s) => s.kind === "resource")
      .slice()
      .sort(
        (a, b) =>
          (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name),
      ),
  );
  const consumables = createMemo(() => (inv()?.items ?? []).filter((s) => s.kind === "consumable"));
  const other = createMemo(() =>
    (inv()?.items ?? []).filter((s) => s.kind !== "resource" && s.kind !== "consumable"),
  );

  return (
    <section class="size-full flex flex-col" data-screen-label="Inventory">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Inventory</h1>
        <span class="text-xs text-base-content/45">
          // committed holdings — rewards land here when an action ends
        </span>
      </header>

      <div class="flex flex-col gap-4 overflow-y-auto pr-1">
        <Show when={!inv()}>
          <div class="bg-base-200/40 rounded-box p-4 text-sm text-base-content/55">
            Waiting for the server's inventory snapshot…
          </div>
        </Show>

        {/* Numeric currencies (resources.md "Resource classes"). */}
        <div>
          <p class="text-xs text-base-content/45 mb-1 px-1">Currencies</p>
          <div class="grid grid-cols-3 gap-2">
            <For each={CURRENCY_ROWS}>
              {(row) => (
                <div class="bg-base-200/40 rounded-box px-3 py-2">
                  <div class="text-[10px] uppercase tracking-wider text-base-content/50">
                    {row.label}
                  </div>
                  <div class="font-mono text-lg leading-tight">
                    {fmt(inv()?.currencies[row.key])}
                    <span class="text-xs text-base-content/40 ml-0.5">{row.short}</span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Server cadence / rate-limit status (overview.md "Dilation under
            load"): the live expected tick interval and whether rate limiting is
            rising or easing — the same signal the Overview Effects card shows. */}
        <div>
          <p class="text-xs text-base-content/45 mb-1 px-1">Server cadence</p>
          <div class="bg-base-200/40 rounded-box px-3 py-2 flex items-center gap-3">
            <TickRateBadge />
            <span class="text-[10px] text-base-content/40 ml-auto">
              ticks dilate above a 3s floor under load
            </span>
          </div>
        </div>

        {/* Active formation-scoped Zone Effects (zone-effects.md). */}
        <ActiveEffects />

        {/* Bulk general resources. */}
        <div>
          <p class="text-xs text-base-content/45 mb-1 px-1">General resources</p>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
            <For each={GENERAL_ROWS}>
              {(row) => (
                <div class="bg-base-200/40 rounded-box px-3 py-2">
                  <div class="text-[10px] uppercase tracking-wider text-base-content/50">
                    {row.label} <span class="text-base-content/35">({row.key})</span>
                  </div>
                  <div class="font-mono text-lg leading-tight">{fmt(inv()?.general[row.key])}</div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Item stacks (inventory.md "Stack semantics"). */}
        <div class="grid md:grid-cols-2 gap-4">
          <StackTable
            title="Item resources"
            hint="discrete, named drops — grouped by category"
            stacks={resources()}
            showCategory
            empty="No item resources yet."
          />
          <div>
            <StackTable
              title="Consumables"
              hint="use on your formation"
              stacks={consumables()}
              empty="No consumables yet."
              onUse={onUse}
            />
            <Show when={useError()}>
              <p class="text-xs text-error mt-2 px-1">✗ {useError()}</p>
            </Show>
          </div>
        </div>
        <Show when={other().length > 0}>
          <StackTable title="Other items" stacks={other()} empty="" />
        </Show>

        {/* Gear & equipment (items.md "Gear instances and templates"). */}
        <GearSection />
      </div>
    </section>
  );
}

/** Unequipped gear (with equip controls) and the per-unit equipment panel,
 * both live over the authoritative inventory + roster pushes. */
function GearSection() {
  const game = useGame();
  const gear = () => game.world.inventory?.gear ?? [];
  // Gear paging (the snapshot carries one server-clamped page; the pager
  // requests another and the answering inventory push re-renders the table).
  const gearPage = () => game.world.inventory?.gearPage ?? 0;
  const gearPages = () => game.world.inventory?.gearPages ?? 1;
  const gearTotal = () => game.world.inventory?.gearTotal ?? 0;
  const roster = () => game.world.roster ?? [];
  const [unitId, setUnitId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  // Equip target: the selected unit, defaulting to the first roster unit.
  const target = createMemo(
    () => roster().find((u) => u.id === unitId()) ?? roster()[0] ?? null,
  );

  const equip = (instanceId: number) => {
    const unit = target();
    if (!unit) return;
    setError(null);
    game.equipGear(unit.id, instanceId, (reason) => setError(reason ?? "equip failed"));
  };
  const unequip = (unit: string, instanceId: number) => {
    setError(null);
    game.unequipGear(unit, instanceId, (reason) => setError(reason ?? "unequip failed"));
  };

  return (
    <div class="grid md:grid-cols-2 gap-4">
      <div class="bg-base-200/40 rounded-box p-3">
        <div class="flex items-baseline gap-2 mb-2 flex-wrap">
          <p class="text-xs text-base-content/45">Gear</p>
          <span class="text-[10px] text-base-content/35">
            // unequipped instances
            <Show when={gearTotal() > gear().length}> ({gearTotal()} total)</Show>
          </span>
          <Show when={roster().length > 1}>
            <select
              class="select select-xs ml-auto"
              value={target()?.id ?? ""}
              onChange={(e) => setUnitId(e.currentTarget.value)}
            >
              <For each={roster()}>{(u) => <option value={u.id}>{u.name}</option>}</For>
            </select>
          </Show>
        </div>
        <Show
          when={gear().length > 0}
          fallback={<p class="text-xs text-base-content/40 py-1">No unequipped gear.</p>}
        >
          <table class="table table-xs">
            <thead>
              <tr class="text-[10px] uppercase tracking-wider text-base-content/45">
                <th class="font-normal">piece</th>
                <th class="font-normal">slot</th>
                <th class="font-normal text-right">score</th>
                <th class="font-normal w-20" />
              </tr>
            </thead>
            <tbody>
              <For each={gear()}>
                {(g) => {
                  const failing = createMemo(() => (target() ? failingReqs(g, target()!) : []));
                  return (
                    <tr>
                      <td>
                        <div class="truncate">{g.name}</div>
                        <div class="text-[10px] text-base-content/45 font-mono">
                          {statsSummary(g.stats) || "no stats"}
                          <Show when={failing().length > 0}>
                            <span class="text-warning"> · needs {failing().join(", ")}</span>
                          </Show>
                        </div>
                      </td>
                      <td class="font-mono text-base-content/55">{g.slot}</td>
                      <td class="font-mono text-right">{g.gearScore}</td>
                      <td class="text-right">
                        <button
                          class="btn btn-xs btn-soft"
                          classList={{ "btn-disabled": failing().length > 0 }}
                          title={
                            failing().length > 0
                              ? `Requires trained ${failing().join(", ")}`
                              : `Equip on ${target()?.name ?? "—"}`
                          }
                          onClick={() => equip(g.instanceId)}
                        >
                          Equip
                        </button>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </Show>
        <Show when={gearPages() > 1}>
          <div class="flex items-center justify-center gap-2 mt-2">
            <button
              class="btn btn-xs btn-ghost"
              disabled={gearPage() === 0}
              onClick={() => game.requestGearPage(gearPage() - 1)}
            >
              ‹ prev
            </button>
            <span class="font-mono text-xs text-base-content/55 tabular-nums">
              page {gearPage() + 1}/{gearPages()}
            </span>
            <button
              class="btn btn-xs btn-ghost"
              disabled={gearPage() + 1 >= gearPages()}
              onClick={() => game.requestGearPage(gearPage() + 1)}
            >
              next ›
            </button>
          </div>
        </Show>
        <Show when={error()}>
          <p class="text-xs text-error mt-2">✗ {error()}</p>
        </Show>
      </div>

      <div class="bg-base-200/40 rounded-box p-3">
        <div class="flex items-baseline gap-2 mb-2">
          <p class="text-xs text-base-content/45">Units & equipment</p>
          <span class="text-[10px] text-base-content/35">// effective = trained + gear</span>
        </div>
        <Show
          when={roster().length > 0}
          fallback={
            <p class="text-xs text-base-content/40 py-1">Waiting for the roster snapshot…</p>
          }
        >
          <For each={roster()}>
            {(u) => (
              <div class="mb-3 last:mb-0">
                <div class="flex items-baseline gap-2">
                  <span class="text-sm">{u.name}</span>
                  <Show when={u.isPlayer}>
                    <span class="badge badge-xs badge-soft">player</span>
                  </Show>
                </div>
                <div class="font-mono text-[11px] text-base-content/60 mt-0.5">
                  <For each={STAT_KEYS}>
                    {([k, label]) => (
                      <span class="mr-2">
                        {label} {u.effective[k]}
                        <Show when={u.effective[k] !== u.trained[k]}>
                          <span class="text-success">({u.trained[k]}+{u.effective[k] - u.trained[k]})</span>
                        </Show>
                      </span>
                    )}
                  </For>
                </div>
                <Show
                  when={u.equipment.length > 0}
                  fallback={
                    <p class="text-[11px] text-base-content/40 mt-1">Nothing equipped.</p>
                  }
                >
                  <ul class="mt-1 divide-y divide-base-300/40 text-sm">
                    <For each={u.equipment}>
                      {(g) => (
                        <li class="flex items-center gap-2 py-1">
                          <span class="font-mono text-[10px] uppercase tracking-wider text-base-content/45 w-16 shrink-0">
                            {g.slot}
                          </span>
                          <span class="truncate min-w-0 flex-1">
                            {g.name}
                            <span class="text-[10px] text-base-content/45 font-mono ml-1">
                              {statsSummary(g.stats)}
                            </span>
                          </span>
                          <button
                            class="btn btn-xs btn-ghost"
                            onClick={() => unequip(u.id, g.instanceId)}
                          >
                            Unequip
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function StackTable(props: {
  title: string;
  hint?: string;
  stacks: ItemStackView[];
  showCategory?: boolean;
  empty: string;
  /** When set, each row gets a Use button (consumables). */
  onUse?: (id: string) => void;
}) {
  return (
    <div class="bg-base-200/40 rounded-box p-3">
      <div class="flex items-baseline gap-2 mb-2">
        <p class="text-xs text-base-content/45">{props.title}</p>
        <Show when={props.hint}>
          <span class="text-[10px] text-base-content/35">// {props.hint}</span>
        </Show>
      </div>
      <Show
        when={props.stacks.length > 0}
        fallback={<p class="text-xs text-base-content/40 py-1">{props.empty}</p>}
      >
        <table class="table table-xs">
          <thead>
            <tr class="text-[10px] uppercase tracking-wider text-base-content/45">
              <th class="font-normal">item</th>
              <Show when={props.showCategory}>
                <th class="font-normal w-16">cat</th>
              </Show>
              <th class="font-normal text-right w-16">qty</th>
              <Show when={props.onUse}>
                <th class="font-normal w-14" />
              </Show>
            </tr>
          </thead>
          <tbody>
            <For each={props.stacks}>
              {(s) => (
                <tr>
                  <td class="truncate">{s.name}</td>
                  <Show when={props.showCategory}>
                    <td class="font-mono uppercase text-base-content/55">{s.category ?? "—"}</td>
                  </Show>
                  <td class="font-mono text-right">{s.qty}</td>
                  <Show when={props.onUse}>
                    <td class="text-right">
                      <button
                        class="btn btn-xs btn-soft"
                        title={`Use ${s.name} on your formation`}
                        onClick={() => props.onUse!(s.id)}
                      >
                        Use
                      </button>
                    </td>
                  </Show>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}

/** The player's active formation-scoped Zone Effects (zone-effects.md), live
 * over the authoritative `effects` push, with a local 1-second countdown
 * seeded from the server's remaining-time baseline. */
function ActiveEffects() {
  const game = useGame();
  const [nowMs, setNowMs] = createSignal(Date.now());
  onMount(() => {
    const h = setInterval(() => setNowMs(Date.now()), 1000);
    onCleanup(() => clearInterval(h));
  });

  // Stamp an absolute expiry the moment a snapshot arrives (this memo re-runs
  // only when the effect set changes — never on each countdown tick).
  const stamped = createMemo(() => {
    const at = Date.now();
    return game.world.effects.map((e) => ({ ...e, expiresAtMs: at + e.remainingSecs * 1000 }));
  });

  const fmtLeft = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  };

  return (
    <Show when={stamped().length > 0}>
      <div>
        <p class="text-xs text-base-content/45 mb-1 px-1">Active effects</p>
        <div class="flex flex-col gap-2">
          <For each={stamped()}>
            {(e) => {
              const left = () => e.expiresAtMs - nowMs();
              return (
                <div class="bg-base-200/40 rounded-box px-3 py-2 flex items-center gap-3">
                  <span class="badge badge-sm badge-success badge-soft shrink-0">{e.scope}</span>
                  <div class="min-w-0 flex-1">
                    <div class="text-sm truncate">{e.name}</div>
                    <div class="text-[10px] text-base-content/45 font-mono">{e.summary}</div>
                  </div>
                  <span class="font-mono text-sm tabular-nums" classList={{ "text-warning": left() < 30000 }}>
                    {fmtLeft(left())}
                  </span>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </Show>
  );
}
