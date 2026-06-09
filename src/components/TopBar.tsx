import { createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "./Icon";

// The current-travel indicator. The animated tick is placeholder telemetry —
// it stands in for the server-driven travel progress the real client will bind.
export function TopBar(props: { showChat: boolean; onToggleChat: () => void }) {
  const [progress, setProgress] = createSignal(34);

  onMount(() => {
    const t = setInterval(() => setProgress((p) => (p + 1) % 100), 240);
    onCleanup(() => clearInterval(t));
  });

  return (
    <nav class="navbar w-full bg-base-300 min-h-12 px-4">
      <div class="w-full flex flex-row items-center gap-4">
        <p class="my-auto font-mono text-sm tracking-tight">TRAVEL</p>
        <div class="w-full my-auto">
          <progress
            class="progress progress-primary w-full h-1.5"
            max="100"
            value={progress()}
          />
        </div>
        <span class="font-mono text-xs text-base-content/55 shrink-0">
          tick {progress().toString().padStart(3, "0")}
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
