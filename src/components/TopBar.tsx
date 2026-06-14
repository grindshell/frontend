import { Show, createEffect } from "solid-js";
import { actionTarget, useGame } from "../lib/game-context";
import { tickPulseEnabled } from "../lib/prefs";
import { Icon } from "./Icon";

// The current-action indicator: the in-flight idle action's kind and KC
// progress from the game context (the action itself lives on the Actions
// screen — this bar keeps it visible everywhere).
export function TopBar(props: {
  showChat: boolean;
  onToggleChat: () => void;
  onOpenNav?: () => void;
}) {
  const game = useGame();
  const action = () => game.world.action;
  // The tick-cadence glow period: the live expected tick interval (overview.md
  // "Ticks"), 3s at the floor and longer when the server dilates under load.
  const tickMs = () => game.world.tickRate?.intervalMs ?? 3000;

  // Re-sync the glow sweep to the server tick: each `actionTick` bumps
  // `world.tickAt`, and restarting the CSS animation here realigns the sweep so
  // it crosses the bar once per idle tick rather than drifting from a
  // free-running clock.
  let glowEl: HTMLDivElement | undefined;
  createEffect(() => {
    game.world.tickAt; // dependency: a tick just landed
    const el = glowEl;
    if (!el) return;
    el.style.animation = "none";
    void el.offsetWidth; // force reflow so the animation restarts
    el.style.animation = "";
  });

  return (
    <nav class="navbar w-full bg-base-300 min-h-12 px-4">
      <div class="w-full flex flex-row items-center gap-4">
        {/* Mobile-only: open the off-canvas nav drawer (the rail is hidden). */}
        <button
          class="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md border border-base-content/15 text-base-content/70 hover:text-base-content hover:border-base-content/30 md:hidden"
          title="Open menu"
          onClick={() => props.onOpenNav?.()}
        >
          <Icon name="Bars3" class="size-5" />
        </button>
        <p class="my-auto font-mono text-sm tracking-tight uppercase">
          {action()?.kind ?? "idle"}
        </p>
        <div class="w-full my-auto">
          {/* The bar plus a clipped overlay carrying the left→right tick sweep. */}
          <div class="relative w-full overflow-hidden rounded-full">
            <progress
              class="progress progress-primary w-full h-1.5 block"
              max={action()?.kcTarget ?? 100}
              value={action()?.kcDone ?? 0}
            />
            <Show when={action() && tickPulseEnabled()}>
              <div ref={glowEl} class="tick-glow" style={{ "--tick-ms": `${tickMs()}ms` }} />
            </Show>
          </div>
        </div>
        <span class="font-mono text-xs text-base-content/55 shrink-0">
          <Show when={action()} fallback={"no action"}>
            {(a) => (
              <>
                {actionTarget(a())} · KC {a().kcDone}/{a().kcTarget}
              </>
            )}
          </Show>
        </span>
        <button
          class={
            "shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md border transition-colors " +
            (props.showChat
              ? "bg-primary text-primary-content border-primary"
              : "border-base-content/15 text-base-content/55 hover:text-base-content hover:border-base-content/30")
          }
          title={props.showChat ? "Hide chat" : "Show chat"}
          aria-pressed={props.showChat}
          onClick={() => props.onToggleChat()}
        >
          <Icon name="ChatBubble" class="size-4" />
        </button>
      </div>
    </nav>
  );
}
