import { For, createMemo } from "solid-js";

// Deterministic 8x8 pixel placeholder portraits (content-format.md "Portraits
// and visual identity"): nothing on the wire carries authored portrait art
// yet, so every entity gets a stable sprite derived from its system id — the
// same id always renders the same portrait, across sessions and clients. The
// derivation is the canon-pinned shared one: an FNV-1a-seeded PRNG drives
// per-cell on/off + color rolls over a horizontally-mirrored 4x8 half-grid.
// Callers salt the seed with the entity's type ("unit:<id>", "gear:<template>",
// "skill:<id>") so equal ids of different types still differ.

const SIZE = 8;
const HALF = SIZE / 2;

/** FNV-1a 32-bit string hash — turns the seed string into the PRNG seed. */
const hash32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** mulberry32 — a tiny deterministic PRNG over the hashed seed. */
const mulberry32 = (seed: number) => {
  let a = seed;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Cell = { x: number; y: number; fill: string };

/** Roll the sprite: each left-half cell is empty (~45%) or one of three hues
 * derived from the seed, mirrored to the right half for a figure-like read. */
const sprite = (seed: string): Cell[] => {
  const rnd = mulberry32(hash32(seed));
  const hue = Math.floor(rnd() * 360);
  const main = `hsl(${hue} 60% 55%)`;
  const shade = `hsl(${hue} 60% 38%)`;
  const accent = `hsl(${(hue + 150) % 360} 65% 60%)`;
  const cells: Cell[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < HALF; x++) {
      const r = rnd();
      if (r < 0.45) continue;
      const fill = r < 0.78 ? main : r < 0.93 ? shade : accent;
      cells.push({ x, y, fill });
      cells.push({ x: SIZE - 1 - x, y, fill });
    }
  }
  return cells;
};

export function PixelPortrait(props: { seed: string; class?: string }) {
  const cells = createMemo(() => sprite(props.seed));
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      class={props.class}
      shape-rendering="crispEdges"
      role="img"
      aria-label="generated portrait"
    >
      <For each={cells()}>
        {(c) => <rect x={c.x} y={c.y} width="1" height="1" fill={c.fill} />}
      </For>
    </svg>
  );
}
