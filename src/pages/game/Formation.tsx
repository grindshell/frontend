import { For, Match, Show, Switch, createSignal, type ParentProps } from "solid-js";

// TODO: placeholder data — real units come from the (not-yet-ported) game state.
type UnitRowData = {
  id: number;
  name: string;
  role: string;
  formation?: string;
  status: string;
};

const UNIT_DATA: UnitRowData[] = [
  { id: 2, name: "Adventurer", role: "Vanguard", formation: "Main", status: "Ok" },
  { id: 3, name: "Brigid", role: "Medic", formation: "Main", status: "Ok" },
  { id: 5, name: "Hollow-7", role: "Skirmish", status: "Hurt" },
  { id: 7, name: "Vex", role: "Sapper", formation: "Main", status: "Ok" },
];

type UnitView = "table" | "detail";

export function Formation() {
  const [unitView, setUnitView] = createSignal<UnitView>("table");
  const [unitDetailId, setUnitDetailId] = createSignal(0);

  return (
    <section class="size-full flex flex-col" data-screen-label="Formation">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Formation</h1>
        <span class="text-xs text-base-content/45">// your deployed squad</span>
      </header>

      <div class="tabs tabs-box">
        <input type="radio" name="formation_tabs" class="tab" aria-label="Units" checked />
        <TabContent>
          <Switch>
            <Match when={unitView() === "table"}>
              <table class="table">
                <thead class="text-base-content/60">
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Formation</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={UNIT_DATA}>
                    {(u) => (
                      <tr
                        class="hover:bg-base-300 cursor-pointer"
                        onClick={() => {
                          setUnitDetailId(u.id);
                          setUnitView("detail");
                        }}
                      >
                        <td class="font-mono text-base-content/50">{u.id}</td>
                        <td>{u.name}</td>
                        <td class="text-base-content/70">{u.role}</td>
                        <td class="text-base-content/70">{u.formation ?? "—"}</td>
                        <td class={u.status === "Ok" ? "text-success" : "text-warning"}>
                          {u.status}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Match>
            <Match when={unitView() === "detail"}>
              <UnitDetail unitId={unitDetailId()} onBack={() => setUnitView("table")} />
            </Match>
          </Switch>
        </TabContent>

        <input type="radio" name="formation_tabs" class="tab" aria-label="Formation" />
        <TabContent>
          <p class="text-sm text-base-content/50 p-4 text-center">
            Formation grid editor — coming once unit placement lands.
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

function UnitDetail(props: { unitId: number; onBack: () => void }) {
  const unit = () => UNIT_DATA.find((u) => u.id === props.unitId);
  return (
    <div class="flex flex-col gap-4">
      <div>
        <button class="btn btn-sm btn-ghost" onClick={() => props.onBack()}>
          ← Back
        </button>
      </div>
      <Show when={unit()} fallback={<p class="text-center text-base-content/50">Unit not found.</p>}>
        {(u) => (
          <div class="text-center">
            <h2 class="text-2xl font-semibold">{u().name}</h2>
            <p class="text-base-content/60">
              {u().role} · {u().status}
            </p>
          </div>
        )}
      </Show>
    </div>
  );
}
