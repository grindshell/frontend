import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { useNavigate } from "@solidjs/router";
import { Icon } from "../../../components/Icon";
import { CARDS, CARDS_BY_ID, type CardDef, type Span } from "./cards";

/* ---------------- layout model + persistence ----------------

   The layout is a list of *instances* (tiles), each a unique `iid` bound to a
   card type (`card`: a CARDS id, or the literal "spacer"). Instances are
   independent, so the same card can appear multiple times at different sizes,
   any tile can be deleted, and new ones are added from the Arrange dropdown. */

const SPACER = "spacer";
type Tile = { iid: string; card: string };
type Layout = { tiles: Tile[]; sizes: Record<string, Span> };

const LS_LAYOUT = "grindshell.overview.layout.v3";
const LS_LAYOUT_V2 = "grindshell.overview.layout.v2";
const SPACER_SIZE: Span = { col: 2, row: 1 };

let iidCounter = 0;
const newIid = () => `t-${Date.now().toString(36)}-${(iidCounter++).toString(36)}`;

const isSpacer = (card: string) => card === SPACER;
const spanForCard = (card: string): Span =>
  isSpacer(card) ? { ...SPACER_SIZE } : { ...CARDS_BY_ID[card].defSpan };

const defaultLayout = (): Layout => {
  const tiles = CARDS.map((c) => ({ iid: newIid(), card: c.id }));
  const sizes = Object.fromEntries(tiles.map((t) => [t.iid, spanForCard(t.card)]));
  return { tiles, sizes };
};

/** A card id is renderable when it's a known card or the spacer sentinel. */
const knownCard = (card: string) => card === SPACER || !!CARDS_BY_ID[card];

function loadLayout(): Layout {
  // v3: the instance model — read as-is, dropping tiles whose card type no
  // longer exists.
  try {
    const saved = JSON.parse(localStorage.getItem(LS_LAYOUT) || "null");
    if (saved && Array.isArray(saved.tiles) && saved.sizes) {
      const tiles: Tile[] = saved.tiles
        .filter((t: Tile) => t && typeof t.iid === "string" && knownCard(t.card))
        .map((t: Tile) => ({ iid: t.iid, card: t.card }));
      if (tiles.length) {
        const sizes: Record<string, Span> = {};
        for (const t of tiles) sizes[t.iid] = saved.sizes[t.iid] ?? spanForCard(t.card);
        return { tiles, sizes };
      }
    }
  } catch {
    /* fall through */
  }

  // v2 → v3 migration: the old model keyed order/sizes by the card-type id
  // (spacers were "spacer-…" ids). Each entry becomes a fresh instance,
  // preserving its stored size, so an existing arrangement survives the upgrade.
  try {
    const old = JSON.parse(localStorage.getItem(LS_LAYOUT_V2) || "null");
    if (old && Array.isArray(old.order) && old.sizes) {
      const tiles: Tile[] = [];
      const sizes: Record<string, Span> = {};
      for (const id of old.order as string[]) {
        const card = id.startsWith("spacer-") ? SPACER : id;
        if (!knownCard(card)) continue;
        const iid = newIid();
        tiles.push({ iid, card });
        sizes[iid] = old.sizes[id] ?? spanForCard(card);
      }
      if (tiles.length) return { tiles, sizes };
    }
  } catch {
    /* fall through */
  }

  return defaultLayout();
}

/* ---------------- card shell ---------------- */

const GripIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
    <circle cx="9" cy="6" r="1.5" />
    <circle cx="15" cy="6" r="1.5" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="18" r="1.5" />
    <circle cx="15" cy="18" r="1.5" />
  </svg>
);
const ArrowOutIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7M10 7h7v7" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
    <path d="M6 6 18 18M18 6 6 18" stroke-linecap="round" />
  </svg>
);

type Axis = "x" | "y" | "xy";

type DragApi = {
  reorderOn: boolean;
  isDragging: (iid: string) => boolean;
  isDropTarget: (iid: string) => boolean;
  onDragStart: (iid: string, e: DragEvent) => void;
  onDragOver: (iid: string, e: DragEvent) => void;
  onDragLeave: (iid: string) => void;
  onDrop: (iid: string, e: DragEvent) => void;
  onDragEnd: () => void;
  onResizeStart: (iid: string, e: MouseEvent, axis: Axis) => void;
  onRemove: (iid: string) => void;
};

function spanStyle(span: Span): JSX.CSSProperties {
  return {
    "grid-column": `span ${span.col} / span ${span.col}`,
    "grid-row": `span ${span.row} / span ${span.row}`,
  };
}

function RemoveButton(props: { onRemove: () => void; title: string }) {
  return (
    <button
      class="w-5 h-5 rounded flex items-center justify-center text-base-content/40 hover:text-error hover:bg-base-300/60 transition-colors"
      title={props.title}
      onClick={(e) => {
        e.stopPropagation();
        props.onRemove();
      }}
    >
      <CloseIcon />
    </button>
  );
}

function ResizeHandles(props: { id: string; api: DragApi; tone: string }) {
  return (
    <>
      <div
        class={"absolute top-0 right-0 h-full w-1.5 cursor-col-resize transition-colors " + props.tone}
        title="Resize width"
        onMouseDown={(e) => {
          e.stopPropagation();
          props.api.onResizeStart(props.id, e, "x");
        }}
      />
      <div
        class={"absolute bottom-0 left-0 w-full h-1.5 cursor-row-resize transition-colors " + props.tone}
        title="Resize height"
        onMouseDown={(e) => {
          e.stopPropagation();
          props.api.onResizeStart(props.id, e, "y");
        }}
      />
      <div
        class="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize"
        title="Resize"
        onMouseDown={(e) => {
          e.stopPropagation();
          props.api.onResizeStart(props.id, e, "xy");
        }}
      >
        <svg viewBox="0 0 12 12" class="w-full h-full text-base-content/40 hover:text-primary">
          <path d="M11 5 5 11M11 9 9 11" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" />
        </svg>
      </div>
    </>
  );
}

function Card(props: {
  iid: string;
  card: CardDef;
  span: Span;
  api: DragApi;
  onNavigate: (route: string) => void;
  children: JSX.Element;
}) {
  const [gripDraggable, setGripDraggable] = createSignal(false);
  const a = props.api;
  return (
    <div
      class={
        "ov-card group relative flex flex-col bg-base-200 rounded-lg border overflow-hidden " +
        "transition-[border-color,opacity,box-shadow] min-h-0 " +
        (a.isDragging(props.iid) ? "opacity-40 " : "") +
        (a.isDropTarget(props.iid) ? "border-primary " : "border-base-300 ") +
        (a.reorderOn
          ? "ring-1 ring-base-content/10 hover:ring-primary/50"
          : "hover:border-base-content/30")
      }
      style={{ ...spanStyle(props.span), "container-type": "size" }}
      draggable={gripDraggable()}
      data-card-id={props.iid}
      onDragStart={(e) => a.onDragStart(props.iid, e)}
      onDragOver={(e) => a.onDragOver(props.iid, e)}
      onDragLeave={() => a.onDragLeave(props.iid)}
      onDrop={(e) => a.onDrop(props.iid, e)}
      onDragEnd={() => {
        setGripDraggable(false);
        a.onDragEnd();
      }}
    >
      {/* Only the header is the page shortcut — the body is interactive. */}
      <header
        class={
          "flex items-center gap-2 px-3 py-2 border-b border-base-300/70 shrink-0 " +
          (a.reorderOn ? "" : "cursor-pointer hover:bg-base-300/30")
        }
        role={a.reorderOn ? undefined : "button"}
        tabindex={a.reorderOn ? undefined : 0}
        onClick={() => !a.reorderOn && props.onNavigate(props.card.route)}
        onKeyDown={(e) => {
          if (!a.reorderOn && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            props.onNavigate(props.card.route);
          }
        }}
      >
        <Show when={a.reorderOn}>
          <span
            class="text-base-content/50 hover:text-primary cursor-grab active:cursor-grabbing -ml-1 px-0.5 py-0.5"
            aria-label="Drag to reorder"
            onMouseDown={() => setGripDraggable(true)}
            onMouseUp={() => setGripDraggable(false)}
            onMouseLeave={() => setGripDraggable(false)}
            onClick={(e) => e.stopPropagation()}
          >
            <GripIcon />
          </span>
        </Show>
        <span class="text-[11px] uppercase tracking-[0.14em] font-medium text-base-content/60 truncate">
          {props.card.title}
        </span>
        <Show when={props.card.badge && !a.reorderOn}>
          <span class="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-base-300 text-base-content/70">
            {props.card.badge}
          </span>
        </Show>
        <Show when={!a.reorderOn && !props.card.badge}>
          <span class="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-base-content/40">
            <ArrowOutIcon />
          </span>
        </Show>
        <Show when={a.reorderOn}>
          <span class="ml-auto flex items-center gap-1.5">
            <span class="font-mono text-[10px] text-base-content/40">
              {props.span.col}×{props.span.row}
            </span>
            <RemoveButton onRemove={() => a.onRemove(props.iid)} title="Remove card" />
          </span>
        </Show>
      </header>
      <div class="flex-1 min-h-0 p-3 overflow-hidden">{props.children}</div>

      <Show when={a.reorderOn}>
        <ResizeHandles id={props.iid} api={a} tone="hover:bg-primary/60" />
      </Show>
    </div>
  );
}

function SpacerCard(props: { iid: string; span: Span; api: DragApi }) {
  const [gripDraggable, setGripDraggable] = createSignal(false);
  const a = props.api;

  return (
    <Show
      when={a.reorderOn}
      fallback={<div aria-hidden class="ov-spacer" style={spanStyle(props.span)} />}
    >
      <div
        class={
          "ov-spacer relative flex items-center justify-center rounded-lg min-h-0 border-2 border-dashed " +
          "transition-[border-color,opacity] " +
          (a.isDragging(props.iid) ? "opacity-30 " : "") +
          (a.isDropTarget(props.iid)
            ? "border-primary bg-primary/5"
            : "border-base-content/15 bg-base-content/[0.02] hover:border-base-content/30")
        }
        style={spanStyle(props.span)}
        draggable={gripDraggable()}
        data-card-id={props.iid}
        onDragStart={(e) => a.onDragStart(props.iid, e)}
        onDragOver={(e) => a.onDragOver(props.iid, e)}
        onDragLeave={() => a.onDragLeave(props.iid)}
        onDrop={(e) => a.onDrop(props.iid, e)}
        onDragEnd={() => {
          setGripDraggable(false);
          a.onDragEnd();
        }}
      >
        <div class="flex items-center gap-2 text-base-content/35 pointer-events-none">
          <span
            class="cursor-grab active:cursor-grabbing hover:text-base-content/70 pointer-events-auto"
            onMouseDown={() => setGripDraggable(true)}
            onMouseUp={() => setGripDraggable(false)}
            onMouseLeave={() => setGripDraggable(false)}
          >
            <GripIcon />
          </span>
          <span class="text-[10px] uppercase tracking-[0.18em] font-medium">spacer</span>
          <span class="font-mono text-[10px] text-base-content/30">
            {props.span.col}×{props.span.row}
          </span>
        </div>

        <div class="absolute top-1.5 right-1.5 z-10 pointer-events-auto">
          <RemoveButton onRemove={() => a.onRemove(props.iid)} title="Remove spacer" />
        </div>

        <ResizeHandles id={props.iid} api={a} tone="hover:bg-primary/60" />
      </div>
    </Show>
  );
}

/* ---------------- the Overview screen ---------------- */

export function Overview() {
  const navigate = useNavigate();
  // Card density. Fixed for now; a Settings control can bind this later.
  const density = (): "comfy" | "compact" => "comfy";
  const [layout, setLayout] = createStore<Layout>(loadLayout());
  const [reorderOn, setReorderOn] = createSignal(false);
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  let gridEl: HTMLDivElement | undefined;

  createEffect(() => {
    localStorage.setItem(LS_LAYOUT, JSON.stringify({ tiles: layout.tiles, sizes: layout.sizes }));
  });

  const rowHeight = () => (density() === "compact" ? 92 : 110);
  const gap = () => (density() === "compact" ? 8 : 12);

  // Append a new instance (a card or a spacer) at the end of the grid.
  const addTile = (card: string) => {
    const iid = newIid();
    setLayout(
      produce((l) => {
        l.tiles.push({ iid, card });
        l.sizes[iid] = spanForCard(card);
      }),
    );
  };

  const removeTile = (iid: string) => {
    setLayout(
      produce((l) => {
        l.tiles = l.tiles.filter((t) => t.iid !== iid);
        delete l.sizes[iid];
      }),
    );
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setLayout(
      produce((l) => {
        const moving = l.tiles.find((t) => t.iid === fromId);
        if (!moving) return;
        const next = l.tiles.filter((t) => t.iid !== fromId);
        const idx = next.findIndex((t) => t.iid === toId);
        next.splice(idx < 0 ? next.length : idx, 0, moving);
        l.tiles = next;
      }),
    );
  };

  const onResizeStart = (id: string, e: MouseEvent, axis: Axis) => {
    e.preventDefault();
    if (!gridEl) return;
    const gridRect = gridEl.getBoundingClientRect();
    const colGap = gap();
    const cellW = (gridRect.width - colGap * 11) / 12;
    const cellH = rowHeight();
    const start = { x: e.clientX, y: e.clientY };
    const init = { ...layout.sizes[id] };

    const move = (ev: MouseEvent) => {
      let col = init.col;
      let row = init.row;
      if (axis.includes("x")) {
        const dx = ev.clientX - start.x;
        col = Math.max(1, Math.min(12, init.col + Math.round(dx / (cellW + colGap))));
      }
      if (axis.includes("y")) {
        const dy = ev.clientY - start.y;
        row = Math.max(1, Math.min(12, init.row + Math.round(dy / (cellH + colGap))));
      }
      setLayout("sizes", id, { col, row });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = axis === "x" ? "col-resize" : axis === "y" ? "row-resize" : "nwse-resize";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const api: DragApi = {
    get reorderOn() {
      return reorderOn();
    },
    isDragging: (id) => dragId() === id,
    isDropTarget: (id) => dropTarget() === id,
    onDragStart: (id, e) => {
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", id);
      setDragId(id);
    },
    onDragOver: (id, e) => {
      if (!dragId()) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      if (dropTarget() !== id && dragId() !== id) setDropTarget(id);
    },
    onDragLeave: (id) => {
      if (dropTarget() === id) setDropTarget(null);
    },
    onDrop: (id, e) => {
      e.preventDefault();
      const fromId = dragId() || e.dataTransfer!.getData("text/plain");
      if (fromId) reorder(fromId, id);
      setDragId(null);
      setDropTarget(null);
    },
    onDragEnd: () => {
      setDragId(null);
      setDropTarget(null);
    },
    onResizeStart,
    onRemove: removeTile,
  };

  // Close the Arrange "add" dropdown after a pick (it stays open on
  // focus-within otherwise), then append the chosen tile.
  const addAndClose = (card: string) => {
    addTile(card);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  return (
    <section class="size-full flex flex-col" data-screen-label="Overview">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Overview</h1>
        <span class="text-xs text-base-content/45">// condensed view of all systems</span>
        <div class="ml-auto flex items-center gap-2">
          <Show when={reorderOn()}>
            {/* Add any card (or a spacer) from the catalog — appended to the
                end of the grid, where it can be dragged and resized. */}
            <div class="dropdown dropdown-end">
              <div
                tabindex="0"
                role="button"
                class="inline-flex items-center gap-1 text-[11px] text-base-content/60 hover:text-base-content border border-base-300 hover:border-base-content/30 px-2 py-1 rounded-md cursor-pointer"
                title="Add a card or spacer to the grid"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 5v14M5 12h14" stroke-linecap="round" />
                </svg>
                <span>add</span>
              </div>
              <ul
                tabindex="0"
                class="dropdown-content menu menu-sm bg-base-200 rounded-box z-20 mt-1 w-48 p-1 shadow-lg border border-base-300 max-h-80 overflow-y-auto flex-nowrap"
              >
                <For each={CARDS}>
                  {(c) => (
                    <li>
                      <button onClick={() => addAndClose(c.id)}>
                        <span class="truncate">{c.title}</span>
                        <Show when={c.badge}>
                          <span class="ml-auto text-[9px] font-mono text-base-content/40">{c.badge}</span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
                <li class="menu-title text-[10px] pt-1">layout</li>
                <li>
                  <button onClick={() => addAndClose(SPACER)}>Spacer</button>
                </li>
              </ul>
            </div>
            <button
              onClick={() => setLayout(defaultLayout())}
              class="text-[11px] text-base-content/50 hover:text-base-content underline-offset-2 hover:underline px-2 py-1"
            >
              reset layout
            </button>
          </Show>
          <button
            onClick={() => setReorderOn(!reorderOn())}
            class={
              "inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors " +
              (reorderOn()
                ? "bg-primary text-primary-content border-primary"
                : "border-base-300 text-base-content/60 hover:text-base-content hover:border-base-content/30")
            }
            title="Rearrange & resize"
            aria-pressed={reorderOn()}
          >
            <Icon name={reorderOn() ? "Check" : "Squares2X2"} class="size-5" />
            <span>{reorderOn() ? "Done" : "Arrange"}</span>
          </button>
        </div>
      </header>

      <div
        ref={gridEl}
        class="ov-grid grid grid-cols-12 flex-1 overflow-y-auto pr-1"
        style={{
          "grid-auto-rows": `${rowHeight()}px`,
          "grid-auto-flow": "row dense",
          gap: `${gap()}px`,
        }}
      >
        <For each={layout.tiles}>
          {(tile) => (
            <Show
              when={!isSpacer(tile.card)}
              fallback={<SpacerCard iid={tile.iid} span={layout.sizes[tile.iid]} api={api} />}
            >
              <Card
                iid={tile.iid}
                card={CARDS_BY_ID[tile.card]}
                span={layout.sizes[tile.iid]}
                api={api}
                onNavigate={navigate}
              >
                {CARDS_BY_ID[tile.card].Body({ get span() { return layout.sizes[tile.iid]; } })}
              </Card>
            </Show>
          )}
        </For>
      </div>
    </section>
  );
}
