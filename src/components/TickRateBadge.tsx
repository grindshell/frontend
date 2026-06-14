import { Show } from "solid-js";
import { useGame } from "../lib/game-context";
import type { TickTrend } from "../lib/protocol";

// The global tick-cadence / rate-limit status (overview.md "Ticks" + "Dilation
// under load"), live from the server's `tickRate` push. The interval is the
// "expected idle tick time" (3s at the floor, longer when the server dilates
// under load); the trend says whether rate limiting is increasing, easing, or
// steady. Shared by the Overview Effects card and the Inventory page so the two
// always read the same.

const TREND: Record<TickTrend, { label: string; tone: string; arrow: string }> = {
  rising: { label: "rate limiting increasing", tone: "text-warning", arrow: "↑" },
  falling: { label: "rate limiting easing", tone: "text-success", arrow: "↓" },
  steady: { label: "steady", tone: "text-base-content/55", arrow: "→" },
};

/** The tick interval in seconds, one decimal (e.g. "3.0s"). */
export const tickSeconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function TickRateBadge(props: { condensed?: boolean }) {
  const game = useGame();
  const tr = () => game.world.tickRate;

  return (
    <Show
      when={tr()}
      fallback={
        <span class="text-[11px] text-base-content/40">
          {game.online() ? "measuring cadence…" : "offline"}
        </span>
      }
    >
      {(t) => {
        const meta = () => TREND[t().trend];
        // Above the floor means the tick has dilated — work is being throttled.
        const dilated = () => t().intervalMs > t().floorMs;
        return (
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="font-mono text-sm tabular-nums shrink-0"
              classList={{ "text-warning": dilated() }}
              title={`expected idle tick time (floor ${tickSeconds(t().floorMs)})`}
            >
              {tickSeconds(t().intervalMs)}
              <span class="text-[10px] text-base-content/40 ml-0.5">/ tick</span>
            </span>
            <Show
              when={!props.condensed}
              fallback={<span class={"text-sm " + meta().tone}>{meta().arrow}</span>}
            >
              <span class={"text-[10px] uppercase tracking-wider truncate " + meta().tone}>
                {meta().arrow} {meta().label}
              </span>
            </Show>
          </div>
        );
      }}
    </Show>
  );
}
