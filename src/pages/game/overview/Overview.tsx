import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { useNavigate } from "@solidjs/router";
import { Icon } from "../../../components/Icon";
import { CARDS, CARDS_BY_ID, type Span } from "./cards";

/* ---------------- layout model + persistence ---------------- */

type Layout = { order: string[]; sizes: Record<string, Span> };

const LS_LAYOUT = "grindshell.overview.layout.v2";
const SPACER_SIZE: Span = { col: 2, row: 1 };

const isSpacerId = (id: string) => id.startsWith("spacer-");
let spacerCounter = 0;
const newSpacerId = () => {
  spacerCounter += 1;
  return `spacer-${Date.now().toString(36)}-${spacerCounter}`;
};

const defaultLayout = (): Layout => ({
  order: CARDS.map((c) => c.id),
  sizes: Object.fromEntries(CARDS.map((c) => [c.id, { ...c.defSpan }])),
});

function loadLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_LAYOUT) || "null");
    if (saved && Array.isArray(saved.order) && saved.sizes) {
      const def = defaultLayout();
      const known = (id: string) => !!CARDS_BY_ID[id] || isSpacerId(id);
      const filteredSaved: string[] = saved.order.filter(known);
      // re-append any real cards added since the layout was persisted
      const missing = def.order.filter((id) => !filteredSaved.includes(id));
      const order = [...filteredSaved, ...missing];
      const sizes: Record<string, Span> = { ...def.sizes };
      for (const id of order) {
        if (saved.sizes[id]) sizes[id] = saved.sizes[id];
        else if (isSpacerId(id)) sizes[id] = { ...SPACER_SIZE };
      }
      return { order, sizes };
    }
  } catch {
    /* fall through to default */
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

type Axis = "x" | "y" | "xy";

type DragApi = {
  reorderOn: boolean;
  isDragging: (id: string) => boolean;
  isDropTarget: (id: string) => boolean;
  onDragStart: (id: string, e: DragEvent) => void;
  onDragOver: (id: string, e: DragEvent) => void;
  onDragLeave: (id: string) => void;
  onDrop: (id: string, e: DragEvent) => void;
  onDragEnd: () => void;
  onResizeStart: (id: string, e: MouseEvent, axis: Axis) => void;
};

function spanStyle(span: Span): JSX.CSSProperties {
  return {
    "grid-column": `span ${span.col} / span ${span.col}`,
    "grid-row": `span ${span.row} / span ${span.row}`,
  };
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
  id: string;
  title: string;
  badge?: string;
  route: string;
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
        (a.isDragging(props.id) ? "opacity-40 " : "") +
        (a.isDropTarget(props.id) ? "border-primary " : "border-base-300 ") +
        (a.reorderOn
          ? "ring-1 ring-base-content/10 hover:ring-primary/50"
          : "hover:border-base-content/30")
      }
      style={{ ...spanStyle(props.span), "container-type": "size" }}
      draggable={gripDraggable()}
      data-card-id={props.id}
      onDragStart={(e) => a.onDragStart(props.id, e)}
      onDragOver={(e) => a.onDragOver(props.id, e)}
      onDragLeave={() => a.onDragLeave(props.id)}
      onDrop={(e) => a.onDrop(props.id, e)}
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
        onClick={() => !a.reorderOn && props.onNavigate(props.route)}
        onKeyDown={(e) => {
          if (!a.reorderOn && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            props.onNavigate(props.route);
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
          {props.title}
        </span>
        <Show when={props.badge}>
          <span class="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-base-300 text-base-content/70">
            {props.badge}
          </span>
        </Show>
        <Show when={!a.reorderOn && !props.badge}>
          <span class="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-base-content/40">
            <ArrowOutIcon />
          </span>
        </Show>
        <Show when={a.reorderOn}>
          <span class="ml-auto font-mono text-[10px] text-base-content/40">
            {props.span.col}×{props.span.row}
          </span>
        </Show>
      </header>
      <div class="flex-1 min-h-0 p-3 overflow-hidden">{props.children}</div>

      <Show when={a.reorderOn}>
        <ResizeHandles id={props.id} api={a} tone="hover:bg-primary/60" />
      </Show>
    </div>
  );
}

function SpacerCard(props: { id: string; span: Span; api: DragApi; onRemove: (id: string) => void }) {
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
          (a.isDragging(props.id) ? "opacity-30 " : "") +
          (a.isDropTarget(props.id)
            ? "border-primary bg-primary/5"
            : "border-base-content/15 bg-base-content/[0.02] hover:border-base-content/30")
        }
        style={spanStyle(props.span)}
        draggable={gripDraggable()}
        data-card-id={props.id}
        onDragStart={(e) => a.onDragStart(props.id, e)}
        onDragOver={(e) => a.onDragOver(props.id, e)}
        onDragLeave={() => a.onDragLeave(props.id)}
        onDrop={(e) => a.onDrop(props.id, e)}
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

        <button
          class="absolute top-1.5 right-1.5 w-5 h-5 rounded flex items-center justify-center text-base-content/40 hover:text-error hover:bg-base-300/60 transition-colors z-10"
          title="Remove spacer"
          onClick={(e) => {
            e.stopPropagation();
            props.onRemove(props.id);
          }}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M6 6 18 18M18 6 6 18" stroke-linecap="round" />
          </svg>
        </button>

        <ResizeHandles id={props.id} api={a} tone="hover:bg-primary/60" />
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
    localStorage.setItem(LS_LAYOUT, JSON.stringify({ order: layout.order, sizes: layout.sizes }));
  });

  const rowHeight = () => (density() === "compact" ? 92 : 110);
  const gap = () => (density() === "compact" ? 8 : 12);

  const addSpacer = () => {
    const id = newSpacerId();
    setLayout(
      produce((l) => {
        l.order.push(id);
        l.sizes[id] = { ...SPACER_SIZE };
      }),
    );
  };

  const removeSpacer = (id: string) => {
    setLayout(
      produce((l) => {
        l.order = l.order.filter((x) => x !== id);
        delete l.sizes[id];
      }),
    );
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setLayout(
      produce((l) => {
        const next = l.order.filter((x) => x !== fromId);
        const idx = next.indexOf(toId);
        next.splice(idx, 0, fromId);
        l.order = next;
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
  };

  return (
    <section class="size-full flex flex-col" data-screen-label="Overview">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Overview</h1>
        <span class="text-xs text-base-content/45">// condensed view of all systems</span>
        <div class="ml-auto flex items-center gap-2">
          <Show when={reorderOn()}>
            <button
              onClick={addSpacer}
              class="inline-flex items-center gap-1 text-[11px] text-base-content/60 hover:text-base-content border border-base-300 hover:border-base-content/30 px-2 py-1 rounded-md"
              title="Add a spacer to push cards apart"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14" stroke-linecap="round" />
              </svg>
              <span>spacer</span>
            </button>
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
        <For each={layout.order}>
          {(id) => (
            <Show
              when={!isSpacerId(id)}
              fallback={
                <SpacerCard id={id} span={layout.sizes[id]} api={api} onRemove={removeSpacer} />
              }
            >
              <Card
                id={id}
                title={CARDS_BY_ID[id].title}
                badge={CARDS_BY_ID[id].badge}
                route={CARDS_BY_ID[id].route}
                span={layout.sizes[id]}
                api={api}
                onNavigate={navigate}
              >
                {CARDS_BY_ID[id].Body({ get span() { return layout.sizes[id]; } })}
              </Card>
            </Show>
          )}
        </For>
      </div>
    </section>
  );
}
