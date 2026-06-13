import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import { useGame } from "../../lib/game-context";
import type { Direction, MapZoneInfo } from "../../lib/protocol";
import { Icon } from "../../components/Icon";
import { CellGrid } from "@grindshell/ui-components";

// The zone map (zones-and-travel.md "Map visibility"): the discovered region of
// the 3D gridmap plus its one-step frontier, streamed from the backend
// (`listMap` → `mapView`). Rendered on the shared Gridstack `CellGrid` (the same
// component the editor's tile map uses), one X/Y plane at a time with a Z
// toggle. Clicking a zone SELECTS it — its details surface in the side panel,
// with a Travel button when the zone is an adjacent destination. The map click
// never starts travel itself; the side panel also lists every legal destination
// (including up/down) as explicit buttons. The map needs live server state, so
// offline it shows an empty state rather than invented zones (frontend CLAUDE.md §6).

const COLS = 9;
const ROWS = 9;

type Vec3 = { x: number; y: number; z: number };

const parsePos = (s: string): Vec3 => {
  const [x, y, z] = s.split(",").map(Number);
  return { x, y, z };
};

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
type MapItem = { x: number; y: number; zone: MapZoneInfo };

/** A small danger badge class by level (1 safe → 5 lethal). */
const dangerClass = (d: number): string =>
  d <= 1 ? "badge-success" : d <= 3 ? "badge-warning" : "badge-error";

export function Area() {
  const game = useGame();

  const map = () => game.world.map;
  const currentKey = () => map()?.current ?? game.world.zone;
  const current = (): Vec3 => parsePos(currentKey());
  const destinations = () => game.world.destinations[currentKey()] ?? [];

  // Ask the server for the map + travel destinations whenever the player's zone
  // changes (arrival re-pushes gameState, which moves `world.zone`). Depends on
  // zone + online only — never on `map()` — so it can't loop on its own answer.
  createEffect(() => {
    void game.world.zone; // track: re-request when the player's zone changes
    if (game.online()) {
      game.listMap();
      game.listDestinations();
    }
  });

  const [viewZ, setViewZ] = createSignal(current().z);
  const [offsetX, setOffsetX] = createSignal(current().x - Math.floor(COLS / 2));
  const [offsetY, setOffsetY] = createSignal(current().y - Math.floor(ROWS / 2));
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);

  const recenter = () => {
    const c = current();
    setViewZ(c.z);
    setOffsetX(c.x - Math.floor(COLS / 2));
    setOffsetY(c.y - Math.floor(ROWS / 2));
  };

  // Re-center the viewport (and follow Z) whenever the player moves to a new
  // zone; a fresh zone also clears any now-stale selection.
  createEffect(
    on(currentKey, () => {
      recenter();
      setSelectedKey(null);
    }),
  );

  const items = createMemo<MapItem[]>(() => {
    const m = map();
    if (!m) return [];
    return m.zones
      .filter((z) => parsePos(z.pos).z === viewZ())
      .map((z) => {
        const p = parsePos(z.pos);
        return { x: p.x, y: p.y, zone: z };
      });
  });

  const selectedZone = (): MapZoneInfo | null => {
    const k = selectedKey();
    if (!k) return null;
    return map()?.zones.find((z) => z.pos === k) ?? null;
  };

  // The inspected zone's display position, for the accent highlight — only when
  // it sits on the plane currently in view.
  const selectedPos = () => {
    const z = selectedZone();
    if (!z) return null;
    const p = parsePos(z.pos);
    if (p.z !== viewZ()) return null;
    return { x: p.x, y: p.y };
  };

  /** The legal travel destination at `key`, if that zone is an adjacent
   *  authored neighbour of the current zone. */
  const destinationAt = (key: string) =>
    destinations().find((d) => d.position === key);

  const renderZone = (item: MapItem, container: HTMLDivElement) => {
    const z = item.zone;
    const isCurrent = z.pos === currentKey();
    if (isCurrent) {
      container.classList.add("bg-primary", "text-primary-content", "font-semibold");
    } else if (z.discovered) {
      container.classList.add("bg-base-300", "text-base-content");
    } else {
      // Frontier: visible but unexplored — dimmed with a dashed outline.
      container.classList.add(
        "bg-base-100",
        "text-base-content/60",
        "border",
        "border-dashed",
        "border-base-content/40",
      );
    }

    const name = document.createElement("div");
    name.className =
      "text-[0.7rem] font-medium leading-tight overflow-hidden text-ellipsis";
    name.textContent = z.name;

    const danger = document.createElement("div");
    danger.className = "text-[0.6rem] mt-auto opacity-80";
    danger.textContent = `⚠ ${z.danger}`;

    container.appendChild(name);
    container.appendChild(danger);
  };

  const onCellClick = (absX: number, absY: number) => {
    const key = `${absX},${absY},${viewZ()}`;
    const z = map()?.zones.find((zz) => zz.pos === key);
    // Clicking only SELECTS a zone — its details (and a Travel button, when the
    // zone is an adjacent destination) surface in the side panel. Clicking empty
    // space clears the selection. Travel never fires from the map click itself.
    setSelectedKey(z ? key : null);
  };

  const inFlightTravel = () =>
    game.world.action?.kind === "travel"
      ? game.world.action.travel?.destinationName
      : null;

  return (
    <section class="size-full flex flex-col" data-screen-label="Area">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Area</h1>
        <span class="text-xs text-base-content/45">// the zone map</span>
        <div class="ml-auto flex items-center gap-2">
          <div class="join">
            <button
              class="btn btn-xs join-item"
              title="Up a level (+z)"
              onClick={() => setViewZ((v) => v + 1)}
            >
              ▲
            </button>
            <span class="btn btn-xs join-item no-animation pointer-events-none font-mono">
              z {viewZ()}
            </span>
            <button
              class="btn btn-xs join-item"
              title="Down a level (−z)"
              onClick={() => setViewZ((v) => v - 1)}
            >
              ▼
            </button>
          </div>
          <button class="btn btn-xs btn-ghost" onClick={recenter}>
            Recenter
          </button>
        </div>
      </header>

      <Show
        when={map()}
        fallback={
          <div class="grow flex flex-col items-center justify-center text-center gap-3 text-base-content/50">
            <Icon name="MapPin" class="size-10 opacity-40" />
            <p class="max-w-xs text-sm">
              The map streams from the server. Connect to chart the zones around
              you — discovered ground and the frontier just beyond it.
            </p>
          </div>
        }
      >
        <div class="grow flex gap-4 overflow-hidden">
          {/* The grid plane. `panMode`: zones aren't rearrangeable, so a
              left-drag anywhere — including on a zone tile — pans the viewport
              (a plain `disableDrag` would let pan start only on empty cells,
              and dragging a zone would do nothing). A click without a drag
              still selects, gated by CellGrid's pan threshold. */}
          <div class="grow rounded-box bg-base-200/40 overflow-hidden min-w-0">
            <CellGrid
              items={items()}
              cols={COLS}
              rows={ROWS}
              offsetX={offsetX()}
              offsetY={offsetY()}
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

          {/* Side panel: where you are, what you're inspecting, where you can go */}
          <aside class="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">
            <Show when={inFlightTravel()}>
              {(dest) => (
                <div class="alert alert-info py-2 text-xs">
                  <span>En route to {dest()}…</span>
                </div>
              )}
            </Show>

            <div class="rounded-box bg-base-200 p-3">
              <div class="text-[0.65rem] uppercase tracking-wide text-base-content/50">
                You are here
              </div>
              <div class="font-semibold">
                {map()?.zones.find((z) => z.pos === currentKey())?.name ??
                  "Unknown"}
              </div>
              <div class="text-xs text-base-content/60 font-mono">
                ({current().x}, {current().y}, {current().z})
              </div>
            </div>

            <Show when={selectedZone()} keyed>
              {(z) => {
                const isHere = () => z.pos === currentKey();
                return (
                  <div class="rounded-box bg-base-200 p-3 flex flex-col gap-2 ring-1 ring-primary/40">
                    <div class="flex items-center justify-between">
                      <span class="text-[0.65rem] uppercase tracking-wide text-base-content/50">
                        Selected ·{" "}
                        {isHere() ? "Current" : z.discovered ? "Discovered" : "Unexplored"}
                      </span>
                      <span class={`badge badge-sm ${dangerClass(z.danger)}`}>
                        danger {z.danger}
                      </span>
                    </div>
                    <div class="font-semibold leading-tight">{z.name}</div>
                    <div class="text-xs text-base-content/60 font-mono">{z.pos}</div>
                    <Show
                      when={!isHere()}
                      fallback={
                        <p class="text-[0.7rem] text-base-content/45">You are standing here.</p>
                      }
                    >
                      <Show
                        when={destinationAt(z.pos)}
                        fallback={
                          <p class="text-[0.7rem] text-base-content/45">
                            {z.discovered
                              ? "Not adjacent — travel one zone at a time."
                              : "On the frontier. Reach a neighbour first."}
                          </p>
                        }
                      >
                        {(dest) => (
                          <button
                            class="btn btn-sm btn-primary"
                            onClick={() => game.startTravel(dest().direction)}
                          >
                            Travel {DIR_LABEL[dest().direction].toLowerCase()} →
                          </button>
                        )}
                      </Show>
                    </Show>
                  </div>
                );
              }}
            </Show>

            <div class="rounded-box bg-base-200 p-3">
              <div class="text-[0.65rem] uppercase tracking-wide text-base-content/50 mb-2">
                Travel
              </div>
              <Show
                when={destinations().length > 0}
                fallback={
                  <p class="text-[0.7rem] text-base-content/45">
                    Nowhere to travel from here.
                  </p>
                }
              >
                <div class="flex flex-col gap-1.5">
                  <For each={destinations()}>
                    {(d) => (
                      <button
                        class="btn btn-sm btn-outline justify-between"
                        onClick={() => game.startTravel(d.direction)}
                      >
                        <span class="truncate">
                          {DIR_LABEL[d.direction]} · {d.name}
                        </span>
                        <span class={`badge badge-xs ${dangerClass(d.danger)}`}>
                          {d.danger}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* Legend */}
            <div class="rounded-box bg-base-200/60 p-3 text-[0.7rem] text-base-content/60 flex flex-col gap-1.5 mt-auto">
              <div class="flex items-center gap-2">
                <span class="inline-block size-3 rounded bg-primary" /> You are here
              </div>
              <div class="flex items-center gap-2">
                <span class="inline-block size-3 rounded bg-base-300" /> Discovered
              </div>
              <div class="flex items-center gap-2">
                <span class="inline-block size-3 rounded border border-dashed border-base-content/40" />{" "}
                Frontier (unexplored)
              </div>
            </div>
          </aside>
        </div>
      </Show>
    </section>
  );
}
