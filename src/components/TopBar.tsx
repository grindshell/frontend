import { Show } from "solid-js";
import { actionTarget, useGame } from "../lib/game-context";
import { Icon } from "./Icon";

// The current-action indicator: the in-flight idle action's kind and KC
// progress from the game context (the action itself lives on the Actions
// screen — this bar keeps it visible everywhere).
export function TopBar(props: { showChat: boolean; onToggleChat: () => void }) {
  const game = useGame();
  const action = () => game.world.action;

  return (
    <nav class="navbar w-full bg-base-300 min-h-12 px-4">
      <div class="w-full flex flex-row items-center gap-4">
        <p class="my-auto font-mono text-sm tracking-tight uppercase">
          {action()?.kind ?? "idle"}
        </p>
        <div class="w-full my-auto">
          <progress
            class="progress progress-primary w-full h-1.5"
            max={action()?.kcTarget ?? 100}
            value={action()?.kcDone ?? 0}
          />
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
