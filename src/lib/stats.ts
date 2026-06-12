import type { GearView, UnitStatsView, UnitView } from "./protocol";

// Shared display helpers for the six unit/gear stats (stats.md "Unit and gear
// stats"). Canon deliberately keeps the stats label-free — no flavor text —
// so the hover descriptions state what each stat actually FEEDS: its row of
// the contribution matrix (stats.md "Action stat calculation").

export const STAT_KEYS = [
  ["str", "STR"],
  ["vit", "VIT"],
  ["dex", "DEX"],
  ["agi", "AGI"],
  ["int", "INT"],
  ["wis", "WIS"],
] as const;

export type StatKey = (typeof STAT_KEYS)[number][0];

/** Each stat's contribution-matrix row, for hover text. */
export const STAT_FEEDS: Record<StatKey, string> = {
  str: "Feeds Health ×2, Physical attack ×3, Physical defense ×1.",
  vit: "Feeds Health ×10, Physical defense ×2, Magical defense ×1.",
  dex: "Feeds Physical attack ×1, Magical attack ×1.",
  agi: "Feeds Speed ×1 (formation Speed averages across occupied cells).",
  int: "Feeds Magical attack ×3, Magical defense ×1.",
  wis: "Feeds Physical defense ×1, Magical defense ×2.",
};

/** "+2 STR, +1 INT" — only the nonzero stats of a gear piece. */
export const statsSummary = (s: UnitStatsView): string =>
  STAT_KEYS.filter(([k]) => s[k] !== 0)
    .map(([k, label]) => `${s[k] > 0 ? "+" : ""}${s[k]} ${label}`)
    .join(", ");

/** The cheap stat-check preview (items.md "Gear requirements"): which of the
 * piece's minimums the unit's TRAINED levels fail. The authoritative check —
 * including the eventual `on_gear_equip_check` hook — is the server's. */
export const failingReqs = (g: GearView, unit: UnitView): string[] =>
  STAT_KEYS.filter(([k]) => g.requirements[k] > 0 && unit.trained[k] < g.requirements[k]).map(
    ([k, label]) => `${label} ${g.requirements[k]}`,
  );
