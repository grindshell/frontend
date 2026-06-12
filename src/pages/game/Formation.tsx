import { For, Match, Show, Switch, createEffect, createSignal } from "solid-js";
import { useGame } from "../../lib/game-context";
import type { FormationSlotView } from "../../lib/protocol";
import CellGrid, { type CellGridItem } from "../../components/CellGrid";
import { GRID, SOFT_CAP, cellNumber, sizeMultiplier } from "../../lib/formation";
import { UnitDetail } from "./UnitDetail";

// The formation screen: a tabbed layout mirroring the Actions screen — a
// signal-driven tab strip over a single scroll region (no nested scrollbars).
// "Units" lists the roster (live from the authoritative `roster` push,
// units.md) and drills into the two-column unit detail inspector
// (UnitDetail.tsx — stats/skills, gear equip/unequip, metadata);
// "Formation" is the grid editor over the authoritative `formation` snapshot
// (formations.md "Editing the formation"). Editor edits are local until Save
// sends the whole layout as one `setFormation` op — the server validates
// atomically and either acks with the fresh snapshot or nacks in full.

const TABS = ["Units", "Formation"] as const;
type Tab = (typeof TABS)[number];

type UnitViewMode = "table" | "detail";

export function Formation() {
  const game = useGame();
  const roster = () => game.world.roster ?? [];
  const [tab, setTab] = createSignal<Tab>("Units");
  const [unitView, setUnitView] = createSignal<UnitViewMode>("table");
  const [unitDetailId, setUnitDetailId] = createSignal("");

  return (
    <section class="size-full flex flex-col" data-screen-label="Formation">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Formation</h1>
        <span class="text-xs text-base-content/45">// your roster — live from the server</span>
      </header>

      <div class="grow flex flex-col overflow-hidden">
        <div role="tablist" class="tabs tabs-box w-fit mb-3">
          <For each={TABS}>
            {(t) => (
              <button
                role="tab"
                class="tab"
                classList={{ "tab-active": tab() === t }}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            )}
          </For>
        </div>

        <div class="grow overflow-y-auto border border-base-300 rounded p-4">
          <Switch>
            <Match when={tab() === "Units"}>
              <Show
                when={roster().length > 0}
                fallback={
                  <p class="text-sm text-base-content/50 p-4 text-center">
                    Waiting for the roster snapshot…
                  </p>
                }
              >
                <Switch>
                  <Match when={unitView() === "table"}>
                    <table class="table">
                      <thead class="text-base-content/60">
                        <tr>
                          <th>Name</th>
                          <th>Title</th>
                          <th>Skills</th>
                          <th>Gear</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={roster()}>
                          {(u) => (
                            <tr
                              class="hover:bg-base-300 cursor-pointer"
                              onClick={() => {
                                setUnitDetailId(u.id);
                                setUnitView("detail");
                              }}
                            >
                              <td>
                                {u.name}
                                <Show when={u.isPlayer}>
                                  <span class="badge badge-xs badge-soft ml-2">player</span>
                                </Show>
                              </td>
                              <td class="text-base-content/70">{u.title ?? "—"}</td>
                              <td class="text-base-content/70">
                                {(u.resolvedSkills?.length ?? u.skills.length) || "—"}
                              </td>
                              <td class="text-base-content/70">{u.equipment.length || "—"}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </Match>
                  <Match when={unitView() === "detail"}>
                    <UnitDetail
                      unitId={unitDetailId()}
                      onSelect={setUnitDetailId}
                      onBack={() => setUnitView("table")}
                    />
                  </Match>
                </Switch>
              </Show>
            </Match>
            <Match when={tab() === "Formation"}>
              <FormationEditor />
            </Match>
          </Switch>
        </div>
      </div>
    </section>
  );
}

/** A formation cell as a CellGrid item — the gridstack grid renders these.
 * Grid constants and the canon formulas live in lib/formation.ts, shared with
 * the unit detail view. */
interface GridSlot extends CellGridItem {
  /** Roster unit id at this cell. */
  unit: string;
  /** Display name. */
  name: string;
  /** Processing-order number (formations.md "Layout"). */
  num: number;
}

/** Render one occupied formation cell: the unit name + its processing-order
 * number. Empty cells are just the grid backdrop — CellGrid renders only
 * occupied cells. */
function renderSlot(slot: GridSlot, container: HTMLDivElement) {
  container.classList.add("bg-base-300", "text-base-content");
  const num = document.createElement("span");
  num.className =
    "absolute top-0.5 right-1 text-[9px] font-mono text-base-content/30 pointer-events-none";
  num.textContent = String(slot.num);
  const name = document.createElement("span");
  name.className =
    "text-xs leading-tight break-all line-clamp-2 pointer-events-none";
  name.textContent = slot.name;
  container.appendChild(num);
  container.appendChild(name);
}

/** The grid editor (formations.md "Editing the formation"), rendered on the
 * shared Gridstack `CellGrid` (the same component the Area map and the editor's
 * formation tester use). Drag a placed unit onto another cell to move it;
 * dropping on an occupied cell swaps the two. Click a bench unit to select it,
 * then click a cell to place it; click a placed unit to select it (then Remove,
 * or click an empty cell to move it). Edits stay local until Save sends the
 * whole layout as one `setFormation` op — the server validates atomically and
 * either acks with the fresh snapshot or nacks in full. The right-most column
 * is the leading side (formations.md "Visual presentation"). */
function FormationEditor() {
  const game = useGame();
  const roster = () => game.world.roster ?? [];
  const server = () => game.world.formation;

  // Local edits over the server baseline; null = mirroring the snapshot.
  const [draft, setDraft] = createSignal<FormationSlotView[] | null>(null);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const slots = () => draft() ?? server() ?? [];
  const dirty = () => draft() !== null;

  // Any fresh server snapshot re-baselines the editor: the one the save's ack
  // rides with, and a resync/reconnect push alike.
  createEffect(() => {
    void game.world.formation;
    setDraft(null);
    setSaving(false);
  });

  const unitName = (id: string) => roster().find((u) => u.id === id)?.name ?? id;
  const occupant = (x: number, y: number) => slots().find((s) => s.x === x && s.y === y);
  const placed = (unit: string) => slots().find((s) => s.unit === unit);
  const bench = () => roster().filter((u) => !placed(u.id));

  const edit = (fn: (cur: FormationSlotView[]) => FormationSlotView[]) => {
    setError(null);
    setDraft(fn(slots().map((s) => ({ ...s }))));
  };

  // Move a unit onto cell (x, y): an empty target moves it there; an occupied
  // target swaps when the unit is already on the grid (the occupant takes the
  // source cell), or displaces the occupant to the bench when the unit came
  // from the bench (no source cell). The single edit path for both gridstack
  // drag (onItemMove) and click-to-place.
  const moveUnitTo = (unit: string, x: number, y: number) => {
    const occ = occupant(x, y);
    if (occ?.unit === unit) return; // dropped on its own cell — no-op
    const from = placed(unit);
    edit((cur) => {
      const rest = cur.filter((s) => s.unit !== unit && s.unit !== occ?.unit);
      const next = [...rest, { unit, x, y }];
      if (occ && from) next.push({ unit: occ.unit, x: from.x, y: from.y });
      return next;
    });
  };

  // Click a cell: with a unit selected (from the bench or the grid), place/move
  // it here; otherwise select the cell's occupant (if any).
  const clickCell = (x: number, y: number) => {
    const sel = selected();
    const occ = occupant(x, y);
    if (sel) {
      if (occ?.unit === sel) {
        setSelected(null);
        return;
      }
      moveUnitTo(sel, x, y);
      setSelected(null);
      return;
    }
    if (occ) setSelected(occ.unit);
  };

  const removeUnit = (unit: string) => edit((cur) => cur.filter((s) => s.unit !== unit));

  const removeSelected = () => {
    const sel = selected();
    if (!sel || !placed(sel)) return;
    removeUnit(sel);
    setSelected(null);
  };

  // The placed slots as CellGrid items (x/y map straight to grid column/row, so
  // the right-most column renders as the leading side — no inversion).
  const items = (): GridSlot[] =>
    slots().map((s) => ({
      x: s.x,
      y: s.y,
      unit: s.unit,
      name: unitName(s.unit),
      num: cellNumber(s.x, s.y),
    }));

  // The selected unit's cell, for the accent highlight (null when it's a bench
  // unit not yet placed).
  const selectedPos = () => {
    const sel = selected();
    if (!sel) return null;
    const p = placed(sel);
    return p ? { x: p.x, y: p.y } : null;
  };

  const save = () => {
    const d = draft();
    if (!d || saving()) return;
    setSaving(true);
    game.setFormation(d, (reason) => {
      setSaving(false);
      setError(reason ?? "the server rejected the layout");
    });
  };

  const discard = () => {
    setDraft(null);
    setSelected(null);
    setError(null);
  };

  const count = () => slots().length;

  return (
    <Show
      when={server() !== null}
      fallback={
        <p class="text-sm text-base-content/50 p-4 text-center">
          Waiting for the formation snapshot… (formation editing needs a server connection)
        </p>
      }
    >
      <div class="flex flex-col gap-4 max-w-2xl mx-auto w-full">
        <Show when={game.world.action}>
          <div class="alert alert-soft alert-info text-xs py-2">
            An action is in flight — its formation stats are already locked in; saved changes
            take effect from your next action.
          </div>
        </Show>

        <div class="flex items-center justify-between text-xs text-base-content/50 px-1">
          <span>← back</span>
          <span class="text-base-content/70 font-mono tracking-wider">front →</span>
        </div>

        <div class="aspect-square w-full max-w-md mx-auto bg-base-200/40 rounded-box overflow-hidden">
          <CellGrid<GridSlot>
            items={items()}
            cols={GRID}
            rows={GRID}
            onCellClick={clickCell}
            onItemMove={(item, nx, ny) => moveUnitTo(item.unit, nx, ny)}
            selectedPos={selectedPos()}
            renderItem={renderSlot}
          />
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-base-content/60 font-mono">
            {count()}/{GRID * GRID} placed
            <Show when={count() > SOFT_CAP}>
              <span class="text-warning ml-2">
                size penalty: ×{sizeMultiplier(count()).toFixed(2)} (soft cap {SOFT_CAP})
              </span>
            </Show>
          </span>
          <div class="grow" />
          <button
            class="btn btn-xs btn-ghost"
            disabled={!selected() || !placed(selected()!)}
            onClick={removeSelected}
            title="Remove the selected placed unit from the grid"
          >
            Remove from grid
          </button>
          <button class="btn btn-xs btn-ghost" disabled={!dirty() || saving()} onClick={discard}>
            Discard
          </button>
          <button class="btn btn-xs btn-primary" disabled={!dirty() || saving()} onClick={save}>
            {saving() ? "Saving…" : "Save formation"}
          </button>
        </div>

        <Show when={error()}>
          <div class="alert alert-soft alert-error text-xs py-2">✗ {error()}</div>
        </Show>

        <div>
          <p class="text-xs text-base-content/45 mb-1">
            Bench{" "}
            <span class="text-base-content/35">
              // click a unit, then a cell — drag placed units to move or swap
            </span>
          </p>
          <Show
            when={bench().length > 0}
            fallback={<p class="text-sm text-base-content/40">Every roster unit is placed.</p>}
          >
            <div class="flex flex-wrap gap-1.5">
              <For each={bench()}>
                {(u) => (
                  <button
                    class="btn btn-xs"
                    classList={{
                      "btn-primary": selected() === u.id,
                      "btn-soft": selected() !== u.id,
                    }}
                    onClick={() => setSelected(selected() === u.id ? null : u.id)}
                  >
                    {u.name}
                    <Show when={u.isPlayer}>
                      <span class="badge badge-xs badge-ghost">player</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <p class="text-[11px] text-base-content/35">
          Cells process top-to-bottom, right-to-left (cell 1 first) — earlier cells' skills run
          first and their writes are visible to later ones. Empty cells reduce exposure to
          area attacks. The right column is the leading side.
        </p>
      </div>
    </Show>
  );
}

