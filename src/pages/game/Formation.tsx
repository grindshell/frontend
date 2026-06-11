import { For, Match, Show, Switch, createSignal, type ParentProps } from "solid-js";
import { useGame } from "../../lib/game-context";
import type { UnitView } from "../../lib/protocol";

// The roster screen: live units from the server's authoritative `roster` push
// (units.md), replaced wholesale like the inventory. Equip/unequip lives on
// the Inventory page; this screen is a read-only view of the units. Grid
// placement is not on the wire yet (formations.md) — the Formation tab says
// so honestly instead of faking a layout.

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
                          <td class="text-base-content/70">{u.skills.length || "—"}</td>
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
          <p class="text-sm text-base-content/50 p-4 text-center">
            Formation grid editing isn't served by the backend yet — units occupy the 5x5 grid
            server-side (formations.md); the editor lands here once placement is on the wire.
          </p>
        </TabContent>
      </div>
    </section>
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
              <p class="text-xs text-base-content/45 mb-1">Skills</p>
              <Show
                when={u().skills.length > 0}
                fallback={<p class="text-sm text-base-content/40">No trained skills.</p>}
              >
                <ul class="text-sm divide-y divide-base-300/40">
                  <For each={u().skills}>
                    {(s) => (
                      <li class="flex justify-between py-1">
                        <span>{s.name}</span>
                        <span class="font-mono text-base-content/70">{s.value}</span>
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
