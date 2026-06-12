import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { useGame } from "../../lib/game-context";
import type { FormationSlotView, GearView, ResolvedSkillView, UnitView } from "../../lib/protocol";
import { STAT_FEEDS, STAT_KEYS, failingReqs, statsSummary } from "../../lib/stats";
import { cellNumber } from "../../lib/formation";
import { PixelPortrait } from "../../components/PixelPortrait";

// The unit detail view (Formation › Units › a unit): a two-column inspector
// over the authoritative roster / formation / inventory pushes, with prev/next
// paging through the roster in list order. The LEFT column is the unit's
// identity card — generated pixel portrait (content-format.md "Portraits and
// visual identity"), formation membership, general data — plus the section
// list; clicking a section expands it in the RIGHT column (clicking it again
// collapses it).
//
//  - Stats & Skills: trained vs effective stats with contribution-matrix hover
//    text (stats.md keeps the stats label-free, so the hovers state what each
//    stat feeds, not invented flavor) and the merged skill list in processing
//    order — hover a skill for its description, click it for the full lower
//    info view.
//  - Gear: stacked equipped (top) / inventory (bottom) with a detail panel for
//    the selected piece; drag a piece between the two zones to equip/unequip
//    (the real `equipGear`/`unequipGear` ops — nothing optimistic).
//  - Metadata: placeholder. Unit record-keeping (creation date, join date,
//    ranking) would be an on-demand backend lookup that the wire doesn't serve
//    yet, and this client doesn't invent contracts (CLAUDE.md §6).

const SECTIONS = [
  { id: "stats", label: "Stats & Skills", hint: "trained levels + the merged skill list" },
  { id: "gear", label: "Gear", hint: "equipped pieces + your inventory" },
  { id: "meta", label: "Metadata", hint: "record-keeping — not served yet" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function UnitDetail(props: {
  unitId: string;
  /** Switch the detail view to another roster unit (prev/next paging). */
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const game = useGame();
  const roster = () => game.world.roster ?? [];
  const index = () => roster().findIndex((u) => u.id === props.unitId);
  const unit = () => (index() >= 0 ? roster()[index()] : undefined);
  const prev = () => (index() > 0 ? roster()[index() - 1] : undefined);
  const next = () => (index() >= 0 ? roster()[index() + 1] : undefined);

  const [section, setSection] = createSignal<SectionId | null>("stats");

  const formationSlot = (): FormationSlotView | null =>
    game.world.formation?.find((s) => s.unit === props.unitId) ?? null;

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-2 flex-wrap">
        <button class="btn btn-sm btn-ghost" onClick={() => props.onBack()}>
          ← Back
        </button>
        <div class="grow" />
        <button
          class="btn btn-sm btn-ghost"
          disabled={!prev()}
          title={prev() ? `View ${prev()!.name}` : "First unit in the roster"}
          onClick={() => prev() && props.onSelect(prev()!.id)}
        >
          ‹ <span class="max-w-28 truncate">{prev()?.name ?? "—"}</span>
        </button>
        <span class="font-mono text-xs text-base-content/45 tabular-nums">
          {index() + 1}/{roster().length}
        </span>
        <button
          class="btn btn-sm btn-ghost"
          disabled={!next()}
          title={next() ? `View ${next()!.name}` : "Last unit in the roster"}
          onClick={() => next() && props.onSelect(next()!.id)}
        >
          <span class="max-w-28 truncate">{next()?.name ?? "—"}</span> ›
        </button>
      </div>

      <Show
        when={unit()}
        fallback={<p class="text-center text-base-content/50 py-8">Unit not found.</p>}
      >
        {(u) => (
          <div class="grid md:grid-cols-[17rem_minmax(0,1fr)] gap-4 items-start">
            {/* Left column: identity + the section list. */}
            <div class="flex flex-col gap-3">
              <IdentityCard unit={u()} slot={formationSlot()} />
              <ul class="menu menu-md bg-base-200/40 rounded-box w-full p-2">
                <For each={SECTIONS}>
                  {(s) => (
                    <li>
                      <button
                        classList={{ "menu-active": section() === s.id }}
                        onClick={() => setSection(section() === s.id ? null : s.id)}
                      >
                        <div class="flex flex-col items-start gap-0">
                          <span>{s.label}</span>
                          <span class="text-[10px] text-base-content/40">// {s.hint}</span>
                        </div>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </div>

            {/* Right column: the expanded section. */}
            <div class="bg-base-200/30 rounded-box p-4 min-h-64">
              <Switch
                fallback={
                  <p class="text-sm text-base-content/40 text-center py-10">
                    Pick a section on the left to expand it here.
                  </p>
                }
              >
                <Match when={section() === "stats"}>
                  <StatsSkillsPanel unit={u()} />
                </Match>
                <Match when={section() === "gear"}>
                  <GearPanel unit={u()} />
                </Match>
                <Match when={section() === "meta"}>
                  <MetadataPanel />
                </Match>
              </Switch>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

/** The unit's identity card: portrait, name/title, formation membership, and
 * the general numbers the roster snapshot already carries. */
function IdentityCard(props: { unit: UnitView; slot: FormationSlotView | null }) {
  const u = () => props.unit;
  const gearScore = () => u().equipment.reduce((sum, g) => sum + g.gearScore, 0);
  return (
    <div class="bg-base-200/40 rounded-box p-4 flex flex-col items-center gap-2">
      <PixelPortrait seed={`unit:${u().id}`} class="size-28 rounded-box bg-base-300/50 p-1.5" />
      <div class="text-center">
        <h2 class="text-lg font-semibold leading-tight">
          {u().name}
          <Show when={u().isPlayer}>
            <span class="badge badge-xs badge-soft ml-1.5 align-middle">player</span>
          </Show>
        </h2>
        <Show when={u().title}>
          <p class="text-xs text-base-content/60">{u().title}</p>
        </Show>
      </div>
      <Show
        when={props.slot}
        fallback={<span class="badge badge-sm badge-ghost">not in formation</span>}
      >
        {(s) => (
          <span class="badge badge-sm badge-success badge-soft">
            in formation — cell {cellNumber(s().x, s().y)}
          </span>
        )}
      </Show>
      <dl class="w-full text-xs mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt class="text-base-content/45">id</dt>
        <dd class="font-mono truncate text-right">{u().id}</dd>
        <dt class="text-base-content/45">gear</dt>
        <dd class="text-right">
          {u().equipment.length} equipped · gs {gearScore()}
        </dd>
        <dt class="text-base-content/45">skills</dt>
        <dd class="text-right">{u().resolvedSkills?.length ?? 0} active</dd>
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stats & Skills                                                      */
/* ------------------------------------------------------------------ */

function StatsSkillsPanel(props: { unit: UnitView }) {
  const skills = (): ResolvedSkillView[] => props.unit.resolvedSkills ?? [];
  const [skillId, setSkillId] = createSignal<string | null>(null);
  const selected = () => skills().find((s) => s.id === skillId()) ?? null;
  const selectedOrder = () => skills().findIndex((s) => s.id === skillId()) + 1;

  // Paging to another unit keeps this panel mounted — drop the skill selection
  // so the lower info view never shows a stale unit's skill.
  createEffect(on(() => props.unit.id, () => setSkillId(null), { defer: true }));

  return (
    <div class="flex flex-col gap-4">
      <div>
        <p class="text-xs text-base-content/45 mb-1">
          Stats <span class="text-base-content/35">// effective = trained + gear — hover for what each feeds</span>
        </p>
        <table class="table table-sm">
          <thead class="text-base-content/60">
            <tr>
              <th>Stat</th>
              <th class="text-right" title="Earned through use-based XP; gear requirements check this value only.">
                Trained
              </th>
              <th class="text-right">Effective</th>
            </tr>
          </thead>
          <tbody class="font-mono">
            <For each={STAT_KEYS}>
              {([k, label]) => (
                <tr>
                  <td>
                    <span class="cursor-help underline decoration-dotted decoration-base-content/30" title={STAT_FEEDS[k]}>
                      {label}
                    </span>
                  </td>
                  <td class="text-right">{props.unit.trained[k]}</td>
                  <td class="text-right">
                    {props.unit.effective[k]}
                    <Show when={props.unit.effective[k] !== props.unit.trained[k]}>
                      <span class="text-success ml-1">
                        (+{props.unit.effective[k] - props.unit.trained[k]})
                      </span>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      <div>
        <p class="text-xs text-base-content/45 mb-1">
          Skills{" "}
          <span class="text-base-content/35">
            // in processing order — hover for the description, click for detail
          </span>
        </p>
        <Show
          when={skills().length > 0}
          fallback={<p class="text-sm text-base-content/40">No active skills.</p>}
        >
          <ul class="text-sm divide-y divide-base-300/40">
            <For each={skills()}>
              {(s, i) => (
                <li>
                  <button
                    class="w-full text-left py-1.5 px-1 rounded hover:bg-base-300/40"
                    classList={{ "bg-base-300/60": skillId() === s.id }}
                    title={s.description || "No description authored yet."}
                    onClick={() => setSkillId(skillId() === s.id ? null : s.id)}
                  >
                    <div class="flex items-baseline gap-2">
                      <span class="font-mono text-[10px] text-base-content/35 w-4 shrink-0 text-right">
                        {i() + 1}
                      </span>
                      <span class="min-w-0 flex-1 truncate">{s.name}</span>
                      <Show when={s.conflict}>
                        <span class="badge badge-xs badge-warning badge-soft shrink-0">conflict</span>
                      </Show>
                      <Show when={s.unregistered}>
                        <span class="badge badge-xs badge-ghost shrink-0">unregistered</span>
                      </Show>
                      <span class="font-mono text-base-content/70 shrink-0">{s.value}</span>
                    </div>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        {/* The lower informational view for the clicked skill. */}
        <Show when={selected()} keyed>
          {(s) => (
            <div class="mt-3 bg-base-300/30 rounded-box p-3 flex gap-3">
              <PixelPortrait seed={`skill:${s.id}`} class="size-12 shrink-0 rounded bg-base-300/50 p-1" />
              <div class="min-w-0 flex-1 flex flex-col gap-1">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="font-semibold">{s.name}</span>
                  <span class="font-mono text-[10px] text-base-content/45">{s.id}</span>
                  <span class="ml-auto font-mono text-sm">value {s.value}</span>
                </div>
                <p class="text-xs text-base-content/60">
                  {s.description || "No description authored yet."}
                </p>
                <p class="text-[11px] text-base-content/45">
                  Runs {selectedOrder()} of {skills().length} on this unit — earlier skills' writes
                  are visible to later ones.
                </p>
                <Show when={s.conflict}>
                  <p class="text-[11px] text-warning">
                    Conflicting priority overrides — fell back to the registry default order.
                  </p>
                </Show>
                <Show when={s.unregistered}>
                  <p class="text-[11px] text-base-content/45">
                    No registry entry — still dispatches, but processes last.
                  </p>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gear                                                                */
/* ------------------------------------------------------------------ */

/** Fixed display order for the gear slots (units.md "Unit composition"). */
const SLOT_ORDER = ["headwear", "torso", "legs", "mainHand", "offHand", "trinket"];
const slotRank = (s: string): number => {
  const i = SLOT_ORDER.indexOf(s);
  return i === -1 ? SLOT_ORDER.length : i;
};

type GearZone = "equipped" | "inventory";

function GearPanel(props: { unit: UnitView }) {
  const game = useGame();
  const inv = () => game.world.inventory;

  const equipped = () => [...props.unit.equipment].sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
  const stash = () => inv()?.gear ?? [];

  const [selectedId, setSelectedId] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [dropHot, setDropHot] = createSignal<GearZone | null>(null);

  createEffect(on(() => props.unit.id, () => { setSelectedId(null); setError(null); }, { defer: true }));

  // The selected piece, wherever it currently lives — an equip/unequip moves
  // the instance between the two authoritative snapshots.
  const isEquipped = (id: number) => props.unit.equipment.some((g) => g.instanceId === id);
  const selected = (): GearView | null => {
    const id = selectedId();
    if (id == null) return null;
    return (
      props.unit.equipment.find((g) => g.instanceId === id) ??
      stash().find((g) => g.instanceId === id) ??
      null
    );
  };

  const equip = (g: GearView) => {
    // The cheap stat preview (items.md "Gear requirements") — the server's
    // check is authoritative, but a trained-stat failure is sure to nack.
    const failing = failingReqs(g, props.unit);
    if (failing.length > 0) {
      setError(`${g.name} requires trained ${failing.join(", ")}`);
      return;
    }
    setError(null);
    game.equipGear(props.unit.id, g.instanceId, (r) => setError(r ?? "equip failed"));
  };
  const unequip = (g: GearView) => {
    setError(null);
    game.unequipGear(props.unit.id, g.instanceId, (r) => setError(r ?? "unequip failed"));
  };

  /* Drag a tile between the zones: drop on Equipped equips, drop on Inventory
   * unequips. The payload is the instance id + origin zone. */
  const onDragStart = (g: GearView, from: GearZone) => (e: DragEvent) => {
    e.dataTransfer?.setData("text/plain", JSON.stringify({ id: g.instanceId, from }));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    setSelectedId(g.instanceId);
  };
  const onDrop = (zone: GearZone) => (e: DragEvent) => {
    e.preventDefault();
    setDropHot(null);
    const raw = e.dataTransfer?.getData("text/plain");
    if (!raw) return;
    let payload: { id: number; from: GearZone };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.from === zone) return;
    if (zone === "equipped") {
      const g = stash().find((x) => x.instanceId === payload.id);
      if (g) equip(g);
    } else {
      const g = props.unit.equipment.find((x) => x.instanceId === payload.id);
      if (g) unequip(g);
    }
  };
  const onDragOver = (zone: GearZone) => (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    setDropHot(zone);
  };

  const tile = (g: GearView, zone: GearZone) => {
    const failing = zone === "inventory" ? failingReqs(g, props.unit) : [];
    return (
      <button
        class="w-20 flex flex-col items-center gap-1 p-1.5 rounded-box bg-base-300/40 hover:bg-base-300/70 cursor-grab"
        classList={{
          "outline-2 outline-accent": selectedId() === g.instanceId,
          "opacity-60": failing.length > 0,
        }}
        draggable
        onDragStart={onDragStart(g, zone)}
        title={`${g.name} · ${g.slot} · gs ${g.gearScore}${
          failing.length > 0 ? ` · requires trained ${failing.join(", ")}` : ""
        }`}
        onClick={() => setSelectedId(selectedId() === g.instanceId ? null : g.instanceId)}
      >
        <PixelPortrait seed={`gear:${g.template}`} class="size-10 rounded bg-base-100/40 p-0.5" />
        <span class="text-[10px] leading-tight text-center line-clamp-2 break-all">{g.name}</span>
        <span class="font-mono text-[9px] text-base-content/45 uppercase">{g.slot}</span>
      </button>
    );
  };

  return (
    <div class="flex flex-col gap-3">
      {/* Top: what the unit is wearing. */}
      <div
        class="rounded-box border border-dashed p-3 transition-colors"
        classList={{
          "border-primary bg-primary/5": dropHot() === "equipped",
          "border-base-300": dropHot() !== "equipped",
        }}
        onDragOver={onDragOver("equipped")}
        onDragLeave={() => setDropHot((z) => (z === "equipped" ? null : z))}
        onDrop={onDrop("equipped")}
      >
        <p class="text-xs text-base-content/45 mb-2">
          Equipped <span class="text-base-content/35">// drop a piece here to equip it</span>
        </p>
        <Show
          when={equipped().length > 0}
          fallback={<p class="text-sm text-base-content/40 py-2">Nothing equipped.</p>}
        >
          <div class="flex flex-wrap gap-2">
            <For each={equipped()}>{(g) => tile(g, "equipped")}</For>
          </div>
        </Show>
      </div>

      {/* Middle: the selected piece's detail. */}
      <Show when={selected()} keyed>
        {(g) => (
          <div class="bg-base-300/30 rounded-box p-3 flex gap-3">
            <PixelPortrait seed={`gear:${g.template}`} class="size-14 shrink-0 rounded bg-base-100/40 p-1" />
            <div class="min-w-0 flex-1 flex flex-col gap-1">
              <div class="flex items-baseline gap-2 flex-wrap">
                <span class="font-semibold">{g.name}</span>
                <span class="font-mono text-[10px] text-base-content/45">{g.template}</span>
                <span class="badge badge-xs badge-ghost font-mono uppercase">{g.slot}</span>
                <span class="ml-auto font-mono text-sm">
                  gs {g.gearScore}
                  <Show when={g.enhancement > 0}>
                    <span class="text-info ml-1">+{g.enhancement}</span>
                  </Show>
                </span>
              </div>
              <p class="text-xs font-mono text-base-content/60">{statsSummary(g.stats) || "no stats"}</p>
              <Show when={statsSummary(g.requirements)}>
                <p class="text-[11px] text-base-content/50">
                  Requires trained {statsSummary(g.requirements).split("+").join("")}
                  <Show when={failingReqs(g, props.unit).length > 0}>
                    <span class="text-warning"> — not met: {failingReqs(g, props.unit).join(", ")}</span>
                  </Show>
                </p>
              </Show>
              <Show when={(g.skills ?? []).length > 0}>
                <p class="text-[11px] text-base-content/50">
                  Grants {(g.skills ?? []).map((s) => `${s.name} +${s.value}`).join(", ")}
                </p>
              </Show>
              <div class="mt-1">
                <Show
                  when={isEquipped(g.instanceId)}
                  fallback={
                    <button
                      class="btn btn-xs btn-soft"
                      classList={{ "btn-disabled": failingReqs(g, props.unit).length > 0 }}
                      onClick={() => equip(g)}
                    >
                      Equip on {props.unit.name}
                    </button>
                  }
                >
                  <button class="btn btn-xs btn-ghost" onClick={() => unequip(g)}>
                    Unequip
                  </button>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Show>

      <Show when={error()}>
        <div class="alert alert-soft alert-error text-xs py-2">✗ {error()}</div>
      </Show>

      {/* Bottom: the player's unequipped gear. */}
      <div
        class="rounded-box border border-dashed p-3 transition-colors"
        classList={{
          "border-primary bg-primary/5": dropHot() === "inventory",
          "border-base-300": dropHot() !== "inventory",
        }}
        onDragOver={onDragOver("inventory")}
        onDragLeave={() => setDropHot((z) => (z === "inventory" ? null : z))}
        onDrop={onDrop("inventory")}
      >
        <p class="text-xs text-base-content/45 mb-2">
          Inventory{" "}
          <span class="text-base-content/35">
            // unequipped gear — drop a worn piece here to unequip it
            <Show when={(inv()?.gearTotal ?? 0) > stash().length}> ({inv()?.gearTotal} total)</Show>
          </span>
        </p>
        <Show
          when={inv()}
          fallback={
            <p class="text-sm text-base-content/40 py-2">
              The inventory streams from the server — connect to manage gear.
            </p>
          }
        >
          <Show
            when={stash().length > 0}
            fallback={<p class="text-sm text-base-content/40 py-2">No unequipped gear.</p>}
          >
            <div class="flex flex-wrap gap-2">
              <For each={stash()}>{(g) => tile(g, "inventory")}</For>
            </div>
          </Show>
          <Show when={(inv()?.gearPages ?? 1) > 1}>
            <div class="flex items-center justify-center gap-2 mt-2">
              <button
                class="btn btn-xs btn-ghost"
                disabled={(inv()?.gearPage ?? 0) === 0}
                onClick={() => game.requestGearPage((inv()?.gearPage ?? 0) - 1)}
              >
                ‹ prev
              </button>
              <span class="font-mono text-xs text-base-content/55 tabular-nums">
                page {(inv()?.gearPage ?? 0) + 1}/{inv()?.gearPages ?? 1}
              </span>
              <button
                class="btn btn-xs btn-ghost"
                disabled={(inv()?.gearPage ?? 0) + 1 >= (inv()?.gearPages ?? 1)}
                onClick={() => game.requestGearPage((inv()?.gearPage ?? 0) + 1)}
              >
                next ›
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Metadata                                                            */
/* ------------------------------------------------------------------ */

/** Placeholder: unit record-keeping (creation date, join date, roster ranking)
 * is planned as an on-demand backend lookup — it isn't part of the cached
 * roster snapshot, and the wire doesn't carry it yet, so nothing is invented
 * here (frontend CLAUDE.md §6). */
function MetadataPanel() {
  return (
    <div class="flex flex-col gap-3">
      <p class="text-xs text-base-content/45">
        Metadata <span class="text-base-content/35">// record-keeping for this unit</span>
      </p>
      <div class="alert alert-soft text-xs">
        <span>
          Not served by the backend yet. Planned: creation date, roster join date, ranking across
          all units — looked up on demand rather than carried on the roster snapshot. This panel
          lights up when the wire grows the call.
        </span>
      </div>
    </div>
  );
}
