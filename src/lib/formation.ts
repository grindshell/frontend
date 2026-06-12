// Formation-grid constants and formulas shared by the Formation editor and
// the unit detail view (formations.md "Layout" / "Formation size and
// diminishing returns").

/** The formation grid is 5x5 (formations.md "Layout"). */
export const GRID = 5;

/** The soft cap on occupied cells; beyond it the size penalty applies
 * (formations.md "Formation size and diminishing returns"). */
export const SOFT_CAP = 5;

/** The canon size multiplier for `n` occupied cells: 1 − 0.75·(excess/20)². */
export const sizeMultiplier = (n: number): number => {
  const excess = Math.max(0, n - SOFT_CAP);
  return 1 - 0.75 * (excess / 20) ** 2;
};

/** The processing-order number of cell (x, y): top-to-bottom, right-to-left —
 * cell 1 is (4, 0), cell 25 is (0, 4) (formations.md "Layout"). */
export const cellNumber = (x: number, y: number): number => (GRID - 1 - x) * GRID + y + 1;
