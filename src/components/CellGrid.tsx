// Generic draggable/clickable cell grid over Gridstack — a viewport into an
// unbounded 2D grid of `{ x, y }` items with click, drag-to-move, and drag-pan.
//
// This is the SAME component the editor uses (editor/src/components/CellGrid.tsx).
// Both repos share the implementation so the game map and the editor tile map
// behave identically; keep them in sync — when you change one, change the other
// (per ../CLAUDE.md, the frontend mirrors the editor's Tailwind/DaisyUI stack).

import {
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import type { GridItemHTMLElement } from "gridstack";
import { GridStack } from "gridstack";
import "gridstack/dist/gridstack.min.css";

export interface CellGridItem {
  x: number;
  y: number;
}

export interface CellGridProps<T extends CellGridItem> {
  /** Items to render. Only items inside the viewport are visible. */
  items: T[];
  /** Viewport dimensions in cells. */
  cols: number;
  rows: number;
  /** Viewport top-left in absolute coords. Default 0. */
  offsetX?: number;
  offsetY?: number;
  /** Floor for the auto-computed cell size, in px. Default 28. */
  minCellPx?: number;
  /** Called with absolute coords for any cell click (empty or occupied). */
  onCellClick: (absX: number, absY: number) => void;
  /** Called when an item is dragged to a new absolute position. */
  onItemMove?: (item: T, newAbsX: number, newAbsY: number) => void;
  /** Currently selected cell in absolute coords — highlighted if within viewport. */
  selectedPos?: { x: number; y: number } | null;
  /** Fill the inside of a cell with item-specific content. */
  renderItem: (item: T, container: HTMLDivElement, isSelected: boolean) => void;
  /** When true, items cannot be dragged. Default false. */
  disableDrag?: boolean;
  /** Called with the new absolute viewport offset when the user drags empty
   *  grid background to pan. If omitted, drag-pan is disabled. */
  onPan?: (newOffsetX: number, newOffsetY: number) => void;
  /** When true, left-button drag *anywhere* (including on items) pans the
   *  viewport — item drag is suppressed. Middle-button drag always pans
   *  regardless of this flag. Implies `onPan`. Default false. */
  panMode?: boolean;
}

const DRAG_CLICK_GUARD_MS = 250;
const PAN_THRESHOLD_PX = 4;

export default function CellGrid<T extends CellGridItem>(
  props: CellGridProps<T>,
) {
  const offsetX = () => props.offsetX ?? 0;
  const offsetY = () => props.offsetY ?? 0;
  const minCellPx = () => props.minCellPx ?? 28;

  let outerEl!: HTMLDivElement;
  let gsEl!: HTMLDivElement;
  let gs: GridStack | undefined;
  const itemMap = new Map<Element, T>();
  let highlightEl: HTMLDivElement | undefined;

  const [cellPx, setCellPx] = createSignal(minCellPx());
  const [cursor, setCursor] = createSignal<"pointer" | "grab" | "grabbing">(
    "pointer",
  );

  // Set to performance.now() in dragstop; click handlers suppress events
  // that arrive within DRAG_CLICK_GUARD_MS of it. Covers both the synthetic
  // click on the dragged widget AND the click on whichever widget happens to
  // be under the cursor at drop time (e.g. the swap target after snap-back).
  let lastDragStopAt = 0;

  function visibleItems(): T[] {
    return props.items.filter(
      (t) =>
        t.x >= offsetX() &&
        t.x < offsetX() + props.cols &&
        t.y >= offsetY() &&
        t.y < offsetY() + props.rows,
    );
  }

  function updateHighlight() {
    highlightEl?.remove();
    highlightEl = undefined;
    const pos = props.selectedPos;
    if (!pos) return;
    const vx = pos.x - offsetX();
    const vy = pos.y - offsetY();
    if (vx < 0 || vx >= props.cols || vy < 0 || vy >= props.rows) return;
    const cp = cellPx();
    highlightEl = document.createElement("div");
    highlightEl.style.cssText = [
      "position: absolute;",
      `left: ${vx * cp + 3}px;`,
      `top: ${vy * cp + 3}px;`,
      `width: ${cp - 6}px;`,
      `height: ${cp - 6}px;`,
      "z-index: 5; border-radius: 6px; pointer-events: none;",
      "box-shadow: 0 0 0 2px var(--color-accent);",
    ].join(" ");
    gsEl.appendChild(highlightEl);
  }

  function buildItems() {
    if (!gs) return;
    itemMap.clear();
    gs.removeAll(true);
    // Highlight overlay is a plain child of gsEl, not a Gridstack widget,
    // so removeAll doesn't touch it — clear explicitly.
    highlightEl?.remove();
    highlightEl = undefined;

    gs.batchUpdate(true);
    for (const item of visibleItems()) {
      const outer = document.createElement("div");
      outer.className = "grid-stack-item";

      const inner = document.createElement("div");
      const isSelected =
        props.selectedPos?.x === item.x && props.selectedPos?.y === item.y;
      // TODO 2026-05-19 TY using the TW inset-[3px] doesn't work
      // It gets overridden by another element somehow but directly setting the style works
      inner.style.cssText = "inset: 3px;";
      const itemCursorClass = props.panMode
        ? "cursor-grab"
        : props.disableDrag
          ? "cursor-pointer"
          : "cursor-grab";
      inner.className = [
        "grid-stack-item-content absolute rounded-md p-[6px] overflow-hidden",
        "select-none flex flex-col gap-0.5",
        itemCursorClass,
      ].join(" ");

      props.renderItem(item, inner, isSelected);

      outer.appendChild(inner);
      gsEl.appendChild(outer);

      const widget = gs.makeWidget(outer, {
        x: item.x - offsetX(),
        y: item.y - offsetY(),
        w: 1,
        h: 1,
        noResize: true,
        noMove: !!props.disableDrag || !!props.panMode,
        // Prevent this widget from being shuffled by another widget's drag.
        // Combined with cursor-based dragstop targeting below, this enforces
        // swap-not-push behavior.
        locked: true,
      });
      itemMap.set(widget, item);

      outer.addEventListener("click", (e) => {
        e.stopPropagation();
        if (performance.now() - lastDragStopAt < DRAG_CLICK_GUARD_MS) return;
        props.onCellClick(item.x, item.y);
      });
    }
    gs.batchUpdate(false);

    updateHighlight();
  }

  function initGrid() {
    if (!gsEl) return;
    if (gs) {
      gs.off("dragstop");
      gs.destroy(false);
      gsEl.innerHTML = "";
    }
    itemMap.clear();
    highlightEl = undefined;

    gs = GridStack.init(
      {
        column: props.cols,
        maxRow: props.rows,
        cellHeight: cellPx(),
        margin: 0,
        float: true,
        animate: false,
        disableResize: true,
        disableDrag: !!props.disableDrag || !!props.panMode,
      },
      gsEl,
    );

    gs.on("dragstop", (event: Event, el: GridItemHTMLElement) => {
      lastDragStopAt = performance.now();
      const originalItem = itemMap.get(el);
      if (!originalItem) return;
      // With `locked: true` widgets, gridstack snaps the dragged item back
      // when it can't be placed (target occupied). Read the cursor drop
      // position directly to detect swap intent regardless of the snap.
      const rect = gsEl.getBoundingClientRect();
      const me = event as MouseEvent;
      const cp = cellPx();
      const vx = Math.floor((me.clientX - rect.left) / cp);
      const vy = Math.floor((me.clientY - rect.top) / cp);
      if (vx < 0 || vx >= props.cols || vy < 0 || vy >= props.rows) {
        buildItems();
        return;
      }
      const absX = vx + offsetX();
      const absY = vy + offsetY();
      if (absX === originalItem.x && absY === originalItem.y) {
        buildItems();
        return;
      }
      props.onItemMove?.(originalItem, absX, absY);
    });

    buildItems();
  }

  function recomputeCellPx() {
    if (!outerEl) return;
    // clientWidth/Height include padding; subtract it so the inner grid
    // (positioned absolutely) actually fits inside the content box.
    const cs = getComputedStyle(outerEl);
    const padW =
      (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padH =
      (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const w = outerEl.clientWidth - padW;
    const h = outerEl.clientHeight - padH;
    if (w <= 0 || h <= 0) return;
    const cp = Math.max(
      minCellPx(),
      Math.floor(Math.min(w / props.cols, h / props.rows)),
    );
    setCellPx(cp);
  }

  let ro: ResizeObserver | undefined;
  let panState:
    | {
        startX: number;
        startY: number;
        baseOffsetX: number;
        baseOffsetY: number;
        active: boolean;
        lastDeltaX: number;
        lastDeltaY: number;
      }
    | null = null;

  function onPanMouseMove(e: MouseEvent) {
    if (!panState) return;
    const dx = e.clientX - panState.startX;
    const dy = e.clientY - panState.startY;
    if (
      !panState.active &&
      Math.max(Math.abs(dx), Math.abs(dy)) < PAN_THRESHOLD_PX
    ) {
      return;
    }
    panState.active = true;
    setCursor("grabbing");
    const cp = cellPx();
    const deltaX = Math.round(dx / cp);
    const deltaY = Math.round(dy / cp);
    if (deltaX === panState.lastDeltaX && deltaY === panState.lastDeltaY) {
      return;
    }
    panState.lastDeltaX = deltaX;
    panState.lastDeltaY = deltaY;
    // Inverted: dragging right reveals what was to the left.
    props.onPan?.(
      panState.baseOffsetX - deltaX,
      panState.baseOffsetY - deltaY,
    );
  }

  function onPanMouseUp() {
    if (!panState) return;
    if (panState.active) {
      lastDragStopAt = performance.now();
    }
    panState = null;
    setCursor(props.onPan ? "grab" : "pointer");
  }

  onMount(() => {
    gsEl.addEventListener("mousedown", (e) => {
      if (!props.onPan) return;
      const isMiddle = e.button === 1;
      const isLeft = e.button === 0;
      if (!isMiddle && !isLeft) return;
      // Left button: skip if the user is grabbing a tile, unless panMode
      // turns every drag into a pan. Middle button always pans regardless
      // of what's under the cursor.
      if (isLeft && !props.panMode) {
        const target = e.target as Element | null;
        if (target && target.closest(".grid-stack-item")) return;
      }
      panState = {
        startX: e.clientX,
        startY: e.clientY,
        baseOffsetX: offsetX(),
        baseOffsetY: offsetY(),
        active: false,
        lastDeltaX: 0,
        lastDeltaY: 0,
      };
      // preventDefault on middle-button mousedown suppresses the browser's
      // autoscroll affordance; on left-button it suppresses text-selection.
      e.preventDefault();
    });

    window.addEventListener("mousemove", onPanMouseMove);
    window.addEventListener("mouseup", onPanMouseUp);

    gsEl.addEventListener("click", (e) => {
      if (performance.now() - lastDragStopAt < DRAG_CLICK_GUARD_MS) return;
      const rect = gsEl.getBoundingClientRect();
      const cp = cellPx();
      const vx = Math.floor((e.clientX - rect.left) / cp);
      const vy = Math.floor((e.clientY - rect.top) / cp);
      if (vx < 0 || vx >= props.cols || vy < 0 || vy >= props.rows) return;
      props.onCellClick(vx + offsetX(), vy + offsetY());
    });

    setCursor(props.onPan ? "grab" : "pointer");

    ro = new ResizeObserver(() => recomputeCellPx());
    ro.observe(outerEl);
    recomputeCellPx();

    initGrid();
  });

  // Cols/rows/disableDrag/panMode changes are structural — re-init the Gridstack instance.
  createEffect(
    on(
      [
        () => props.cols,
        () => props.rows,
        () => props.disableDrag,
        () => props.panMode,
      ],
      () => {
        recomputeCellPx();
        initGrid();
      },
      { defer: true },
    ),
  );

  // Cell size changes — let Gridstack rescale, then refresh highlight.
  createEffect(
    on(
      cellPx,
      (cp) => {
        gs?.cellHeight(cp);
        updateHighlight();
      },
      { defer: true },
    ),
  );

  // Keep the resting cursor in sync with whether drag-pan is enabled.
  createEffect(
    on(
      () => props.onPan,
      (op) => {
        if (panState?.active) return;
        setCursor(op ? "grab" : "pointer");
      },
      { defer: true },
    ),
  );

  // Rebuild visual items when data/offset/selection change.
  createEffect(
    on(
      [
        () => props.items,
        () => props.offsetX,
        () => props.offsetY,
        () => props.selectedPos,
      ],
      () => buildItems(),
      { defer: true },
    ),
  );

  onCleanup(() => {
    ro?.disconnect();
    window.removeEventListener("mousemove", onPanMouseMove);
    window.removeEventListener("mouseup", onPanMouseUp);
    gs?.destroy(false);
  });

  return (
    <div
      ref={outerEl}
      class="h-full w-full p-4 flex items-center justify-center"
    >
      <div
        style={`position: relative; width: ${cellPx() * props.cols}px; height: ${cellPx() * props.rows}px;`}
      >
        {/* Backdrop: square outlines for every cell (incl. empty). */}
        <div
          class="absolute inset-0 z-0 grid bg-base-200 pointer-events-none"
          style={`grid-template-columns: repeat(${props.cols}, ${cellPx()}px); grid-template-rows: repeat(${props.rows}, ${cellPx()}px);`}
        >
          <For each={Array.from({ length: props.cols * props.rows })}>
            {() => (
              <div class="border border-solid border-base-content/35 box-border" />
            )}
          </For>
        </div>
        {/* Gridstack root on top — receives clicks and hosts draggable widgets.
            --gs-column-width / --gs-cell-height drive widget sizing in
            Gridstack 12's stylesheet; setting them inline makes the grid
            track cellPx() reactively without relying on Gridstack's own
            cellHeight() side-effects. */}
        <div
          ref={gsEl}
          style={`position: absolute; inset: 0; width: ${cellPx() * props.cols}px; height: ${cellPx() * props.rows}px; cursor: ${cursor()}; z-index: 1; --gs-column-width: ${cellPx()}px; --gs-cell-height: ${cellPx()}px;`}
        />
      </div>
    </div>
  );
}
