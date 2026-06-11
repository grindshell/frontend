import { For, Index, Match, Show, Switch, createEffect, createSignal, type ParentProps } from "solid-js";
import { useGame } from "../../lib/game-context";
import type { FormationSlotView, UnitView } from "../../lib/protocol";

// The formation screen: live units from the server's authoritative `roster`
// push (units.md) and the grid editor over the authoritative `formation`
// snapshot (formations.md "Editing the formation"). Edits are local until
// Save sends the whole layout as one `setFormation` op — the server validates
// atomically and either acks with the fresh snapshot or nacks in full.
// Equip/unequip lives on the Inventory page.

const STAT_KEYS = [
  ["str", "STR"],
  ["vit", "VIT"],
  ["dex", "DEX"],
  ["agi", "AGI"],
  ["int", "INT"],
  ["wis", "WIS"],
] as const;

type UnitViewMode = "table" | "detail";

export function Formation() {
  const game = useGame();
  const roster = () => game.world.roster ?? [];
  const [unitView, setUnitView] = createSignal<UnitViewMode>("table");
  const [unitDetailId, setUnitDetailId] = createSignal("");

  return (
    <section class="size-full flex flex-col" data-screen-label="Formation">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Formation</h1>
        <span class="text-xs text-base-content/45">// your roster — live from the server</span>
      </header>

      <div class="tabs tabs-box">
        <input type="radio" name="formation_tabs" class="tab" aria-label="Units" checked />
        <TabContent>
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
                  unit={roster().find((u) => u.id === unitDetailId())}
                  onBack={() => setUnitView("table")}
                />
              </Match>
            </Switch>
          </Show>
        </TabContent>

        <input type="radio" name="formation_tabs" class="tab" aria-label="Formation" />
        <TabContent>
          <FormationEditor />
        </TabContent>
      </div>
    </section>
  );
}

/** The formation grid is 5x5 (formations.md "Layout"). */
const GRID = 5;

/** The soft cap on occupied cells; beyond it the size penalty applies
 * (formations.md "Formation size and diminishing returns"). */
const SOFT_CAP = 5;

/** The canon size multiplier for `n` occupied cells: 1 − 0.75·(excess/20)². */
const sizeMultiplier = (n: number): number => {
  const excess = Math.max(0, n - SOFT_CAP);
  return 1 - 0.75 * (excess / 20) ** 2;
};

/** The processing-order number of cell (x, y): top-to-bottom, right-to-left —
 * cell 1 is (4, 0), cell 25 is (0, 4) (formations.md "Layout"). */
const cellNumber = (x: number, y: number): number => (GRID - 1 - x) * GRID + y + 1;

/** The grid editor (formations.md "Editing the formation"): click a unit (in
 * the grid or on the bench), then a cell to place/move it — clicking an
 * occupied cell swaps/displaces. Edits stay local until Save sends the whole
 * layout; the server's snapshot (which the ack rides with) re-baselines the
 * view. The right-most column is the leading side (formations.md "Visual
 * presentation"). */
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

  const clickCell = (x: number, y: number) => {
    const sel = selected();
    const occ = occupant(x, y);
    if (!sel) {
      if (occ) setSelected(occ.unit);
      return;
    }
    if (occ?.unit === sel) {
      setSelected(null);
      return;
    }
    const from = placed(sel);
    edit((cur) => {
      const rest = cur.filter((s) => s.unit !== sel && s.unit !== occ?.unit);
      const next = [...rest, { unit: sel, x, y }];
      // A displaced occupant swaps into the selected unit's old cell when it
      // has one; a bench placement displaces the occupant to the bench.
      if (occ && from) next.push({ unit: occ.unit, x: from.x, y: from.y });
      return next;
    });
    setSelected(null);
  };

  const removeSelected = () => {
    const sel = selected();
    if (!sel || !placed(sel)) return;
    edit((cur) => cur.filter((s) => s.unit !== sel));
    setSelected(null);
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

        <div class="grid grid-cols-5 gap-1.5">
          <Index each={Array.from({ length: GRID * GRID })}>
            {(_, i) => {
              // Row-major render: i = y * GRID + x, left-to-right per row.
              const x = i % GRID;
              const y = Math.floor(i / GRID);
              const occ = () => occupant(x, y);
              const isSelected = () => !!occ() && occ()!.unit === selected();
              return (
                <button
                  class="aspect-square rounded-sm border text-center relative flex flex-col items-center justify-center p-1 transition-colors"
                  classList={{
                    "bg-base-300 border-base-content/20": !!occ() && !isSelected(),
                    "bg-primary/20 border-primary ring-1 ring-primary": isSelected(),
                    "bg-base-200/40 border-base-300 hover:bg-base-300/50": !occ(),
                    "cursor-pointer": !!occ() || selected() !== null,
                  }}
                  onClick={() => clickCell(x, y)}
                >
                  <span class="absolute top-0.5 right-1 text-[9px] font-mono text-base-content/30">
                    {cellNumber(x, y)}
                  </span>
                  <Show when={occ()}>
                    {(s) => (
                      <span class="text-xs leading-tight break-all line-clamp-2">
                        {unitName(s().unit)}
                      </span>
                    )}
                  </Show>
                </button>
              );
            }}
          </Index>
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
            Bench <span class="text-base-content/35">// click a unit, then a cell to place it</span>
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
                    classList={{ "btn-primary": selected() === u.id, "btn-soft": selected() !== u.id }}
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

function TabContent(props: ParentProps) {
  return (
    <div class="tab-content bg-base-100 border-base-300 p-6 overflow-auto">{props.children}</div>
  );
}

function UnitDetail(props: { unit: UnitView | undefined; onBack: () => void }) {
  return (
    <div class="flex flex-col gap-4">
      <div>
        <button class="btn btn-sm btn-ghost" onClick={() => props.onBack()}>
          ← Back
        </button>
      </div>
      <Show
        when={props.unit}
        fallback={<p class="text-center text-base-content/50">Unit not found.</p>}
      >
        {(u) => (
          <div class="flex flex-col gap-4">
            <div class="text-center">
              <h2 class="text-2xl font-semibold">
                {u().name}
                <Show when={u().isPlayer}>
                  <span class="badge badge-sm badge-soft ml-2 align-middle">player</span>
                </Show>
              </h2>
              <Show when={u().title}>
                <p class="text-base-content/60">{u().title}</p>
              </Show>
            </div>

            <div class="max-w-md mx-auto w-full">
              <p class="text-xs text-base-content/45 mb-1">
                Stats <span class="text-base-content/35">// effective = trained + gear</span>
              </p>
              <table class="table table-sm">
                <thead class="text-base-content/60">
                  <tr>
                    <th>Stat</th>
                    <th class="text-right">Trained</th>
                    <th class="text-right">Effective</th>
                  </tr>
                </thead>
                <tbody class="font-mono">
                  <For each={STAT_KEYS}>
                    {([k, label]) => (
                      <tr>
                        <td>{label}</td>
                        <td class="text-right">{u().trained[k]}</td>
                        <td class="text-right">
                          {u().effective[k]}
                          <Show when={u().effective[k] !== u().trained[k]}>
                            <span class="text-success ml-1">
                              (+{u().effective[k] - u().trained[k]})
                            </span>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>

            <div class="max-w-md mx-auto w-full">
              <p class="text-xs text-base-content/45 mb-1">
                Skills{" "}
                <span class="text-base-content/35">// in processing order — first runs first</span>
              </p>
              <Show
                when={(u().resolvedSkills ?? []).length > 0}
                fallback={<p class="text-sm text-base-content/40">No active skills.</p>}
              >
                <ul class="text-sm divide-y divide-base-300/40">
                  <For each={u().resolvedSkills}>
                    {(s, i) => (
                      <li class="py-1.5">
                        <div class="flex items-baseline gap-2">
                          <span class="font-mono text-[10px] text-base-content/35 w-4 shrink-0 text-right">
                            {i() + 1}
                          </span>
                          <span class="min-w-0 flex-1 truncate">{s.name}</span>
                          <Show when={s.conflict}>
                            <span
                              class="badge badge-xs badge-warning badge-soft shrink-0"
                              title="Conflicting priority overrides — fell back to the default order."
                            >
                              conflict
                            </span>
                          </Show>
                          <Show when={s.unregistered}>
                            <span
                              class="badge badge-xs badge-ghost shrink-0"
                              title="No registry entry — processes last."
                            >
                              unregistered
                            </span>
                          </Show>
                          <span class="font-mono text-base-content/70 shrink-0">{s.value}</span>
                        </div>
                        <Show when={s.description}>
                          <p class="text-xs text-base-content/50 pl-6 mt-0.5">{s.description}</p>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>

            <div class="max-w-md mx-auto w-full">
              <p class="text-xs text-base-content/45 mb-1">
                Equipment <span class="text-base-content/35">// manage on the Inventory page</span>
              </p>
              <Show
                when={u().equipment.length > 0}
                fallback={<p class="text-sm text-base-content/40">Nothing equipped.</p>}
              >
                <ul class="text-sm divide-y divide-base-300/40">
                  <For each={u().equipment}>
                    {(g) => (
                      <li class="flex items-center gap-2 py-1">
                        <span class="font-mono text-[10px] uppercase tracking-wider text-base-content/45 w-16 shrink-0">
                          {g.slot}
                        </span>
                        <span class="truncate min-w-0 flex-1">{g.name}</span>
                        <span class="font-mono text-[11px] text-base-content/50">
                          gs {g.gearScore}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
