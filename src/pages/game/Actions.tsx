import { For, Match, Show, Switch, createMemo, createSignal, type ParentProps } from "solid-js";
import { createStore } from "solid-js/store";

// Ported from frontend-old without the game-context dependency: action state is
// local for now and will rebind to the server-driven current action later.
const ACTIONS = ["Idle", "Travel", "Combat", "Harvest", "Craft", "Construct"] as const;
type Action = (typeof ACTIONS)[number];

const selectableActions = () => ACTIONS.filter((a) => a !== "Idle");

export function Actions() {
  const [currentView, setCurrentView] = createSignal<Action>("Idle");
  const [input, setInput] = createSignal("");
  const hasInput = createMemo(() => input().trim().length > 0);

  return (
    <section class="size-full flex flex-col" data-screen-label="Actions">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Actions</h1>
        <span class="text-xs text-base-content/45">// what your party is doing</span>
      </header>

      <div class="grow grid lg:grid-cols-3 gap-4 overflow-hidden">
        <div class="lg:col-span-2 flex flex-col overflow-hidden">
          <Show
            when={currentView() !== "Idle"}
            fallback={<IdleSelector onSelect={setCurrentView} />}
          >
            <WithControls onSwitch={setCurrentView} onStop={() => setCurrentView("Idle")}>
              <Switch fallback={<SimpleFragment label={currentView()} />}>
                <Match when={currentView() === "Travel"}>
                  <TravelOptions />
                </Match>
              </Switch>
            </WithControls>
          </Show>
        </div>

        <div class="flex flex-col gap-2 overflow-hidden">
          <ul class="grow border border-base-300 rounded overflow-y-auto p-2 font-mono text-[12px] text-base-content/70 space-y-0.5">
            <For each={[...Array(8).keys()]}>
              {(v) => <li class="text-base-content/40">— action log line {v + 1}</li>}
            </For>
          </ul>
          <div class="flex flex-row gap-2">
            <input
              type="text"
              placeholder="Send an action command."
              class="input input-sm grow"
              value={input()}
              onInput={(e) => setInput(e.currentTarget.value)}
            />
            <button class="btn btn-sm" classList={{ "btn-success": hasInput() }} disabled={!hasInput()}>
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function IdleSelector(props: { onSelect: (a: Action) => void }) {
  return (
    <div class="m-auto p-10 border border-base-300 rounded-lg flex flex-col gap-4">
      <p class="text-center text-base-content/70">You are currently idle.</p>
      <div class="flex flex-row flex-wrap gap-2 justify-center">
        <For each={selectableActions()}>
          {(a) => (
            <button class="btn btn-sm btn-soft hover:btn-primary" onClick={() => props.onSelect(a)}>
              {a}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function WithControls(
  props: ParentProps & { onSwitch: (a: Action) => void; onStop: () => void },
) {
  return (
    <div class="size-full flex flex-col">
      <div class="flex flex-row justify-center gap-2 flex-wrap">
        <button class="btn btn-sm btn-soft hover:btn-success">Replenish Energy</button>
        <div class="dropdown">
          <button tabindex={0} class="btn btn-sm btn-soft">
            Switch Action ▾
          </button>
          <ul tabindex={0} class="dropdown-content menu bg-base-200 rounded-box z-10 w-48 p-2 shadow">
            <For each={selectableActions()}>
              {(a) => (
                <li>
                  <button onClick={() => props.onSwitch(a)}>{a}</button>
                </li>
              )}
            </For>
          </ul>
        </div>
        <button class="btn btn-sm btn-soft hover:btn-error" onClick={() => props.onStop()}>
          Stop Action
        </button>
      </div>
      <div class="divider my-2" />
      <div class="grow overflow-hidden">{props.children}</div>
    </div>
  );
}

function SimpleFragment(props: { label: string }) {
  return (
    <div class="size-full flex items-center justify-center text-base-content/50">
      <p>{props.label} — display coming soon.</p>
    </div>
  );
}

const DIRECTIONS = ["Down", "North", "Up", "West", "South", "East"];

function TravelOptions() {
  const [route, setRoute] = createStore<string[]>([]);
  const addDirection = (d: string) => setRoute(route.length, d);

  return (
    <div class="h-full grid grid-cols-2 gap-4">
      <div class="flex flex-col gap-2">
        <div class="grow flex border border-base-300 rounded">
          <p class="m-auto text-center text-base-content/40">imagine a map here</p>
        </div>
        <div class="grid grid-cols-3 grid-rows-2 gap-2">
          <For each={DIRECTIONS}>
            {(d) => (
              <button class="btn btn-sm" onClick={() => addDirection(d)}>
                {d}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="h-full flex flex-col gap-2 overflow-hidden">
        <ul class="grow border border-base-300 rounded overflow-y-auto p-2 space-y-1">
          <Show
            when={route.length > 0}
            fallback={<li class="text-base-content/40 text-sm p-1">No route queued.</li>}
          >
            <For each={route}>
              {(d, idx) => (
                <li class="flex flex-row items-center gap-2">
                  <span class="grow">{d}</span>
                  <button
                    class="btn btn-xs btn-error"
                    onClick={() => setRoute((cur) => cur.filter((_, i) => i !== idx()))}
                  >
                    ✕
                  </button>
                </li>
              )}
            </For>
          </Show>
        </ul>
        <div class="flex flex-row gap-2">
          <button class="btn btn-sm hover:btn-success grow" disabled={route.length === 0}>
            Start
          </button>
          <button class="btn btn-sm hover:btn-error" onClick={() => setRoute([])}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
