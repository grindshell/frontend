import { For, Show, createSignal } from "solid-js";
import { useGame, type ChatEntry, type GameStatus } from "../lib/game-context";

const STATUS_LABEL: Record<GameStatus, string> = {
  offline: "offline",
  connecting: "connecting…",
  connected: "online",
  closed: "disconnected",
  error: "error",
  "auth-needed": "signed out",
};
const STATUS_DOT: Record<GameStatus, string> = {
  offline: "bg-base-content/40",
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  closed: "bg-warning",
  error: "bg-error",
  "auth-needed": "bg-base-content/40",
};

function hhmm(at?: string): string {
  if (!at) return "··:··";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "··:··";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fromTone(kind: ChatEntry["kind"]): string {
  switch (kind) {
    case "system":
      return "text-base-content/45 italic";
    case "local":
      return "text-accent";
    case "dm":
      return "text-info";
    default:
      return "text-primary";
  }
}

export function ChatPanel(props: { onCollapse?: () => void }) {
  const game = useGame();
  const [draft, setDraft] = createSignal("");

  const isDms = () => game.chat.activeRoom === game.dmBucket;
  const entries = () => game.chat.byRoom[game.chat.activeRoom] ?? [];

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    const body = draft().trim();
    if (!body || isDms()) return;
    game.sendRoom(game.chat.activeRoom, body);
    setDraft("");
  };

  const label = (room: string) => (room === game.dmBucket ? "DMs" : `#${room}`);

  return (
    <div class="size-full bg-base-200 border-t border-base-300 flex flex-col">
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-base-300/70 shrink-0">
        <span class="text-[10px] uppercase tracking-[0.18em] font-medium text-base-content/55">
          Chat
        </span>
        <span class="flex items-center gap-1.5 text-[10px] text-base-content/45">
          <span class={"inline-block w-1.5 h-1.5 rounded-full " + STATUS_DOT[game.status()]} />
          {STATUS_LABEL[game.status()]}
        </span>
        <Show when={props.onCollapse}>
          <button
            class="ml-auto text-base-content/40 hover:text-base-content w-5 h-5 rounded flex items-center justify-center hover:bg-base-300/60"
            title="Collapse chat"
            onClick={() => props.onCollapse?.()}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14" stroke-linecap="round" />
            </svg>
          </button>
        </Show>
      </div>

      <div class="flex flex-1 min-h-0">
        <div class="w-40 p-3 border-r border-base-300 shrink-0 overflow-y-auto">
          <div class="text-[10px] uppercase tracking-wider text-base-content/45 mb-2">Channels</div>
          <ul class="space-y-1 text-sm">
            <For each={game.chat.rooms}>
              {(room) => (
                <li
                  class={
                    "px-2 py-1 rounded cursor-pointer truncate " +
                    (room === game.chat.activeRoom
                      ? "bg-base-300 font-medium"
                      : "hover:bg-base-300/50 text-base-content/70")
                  }
                  onClick={() => game.setActiveRoom(room)}
                >
                  {label(room)}
                </li>
              )}
            </For>
            <li
              class={
                "px-2 py-1 rounded cursor-pointer mt-2 border-t border-base-300/60 pt-2 " +
                (isDms() ? "font-medium text-base-content" : "hover:bg-base-300/50 text-base-content/70")
              }
              onClick={() => game.setActiveRoom(game.dmBucket)}
            >
              Direct messages
            </li>
          </ul>
        </div>

        <div class="flex-1 p-3 flex flex-col gap-2 min-w-0">
          <form class="flex gap-2" onSubmit={submit}>
            <input
              type="text"
              placeholder={
                isDms() ? "Select a channel to chat." : `Message ${label(game.chat.activeRoom)}…`
              }
              class="input input-sm grow"
              value={draft()}
              disabled={isDms()}
              onInput={(e) => setDraft(e.currentTarget.value)}
            />
            <button type="submit" class="btn btn-sm" disabled={isDms() || !draft().trim()}>
              Send
            </button>
          </form>
          <ul class="grow border border-base-300 rounded p-2 overflow-y-auto font-mono text-[12px] leading-relaxed">
            <Show
              when={entries().length > 0}
              fallback={<li class="text-base-content/35">No messages yet.</li>}
            >
              <For each={entries()}>
                {(m) => (
                  <li class="text-base-content/85">
                    <span class="text-base-content/35">[{hhmm(m.at)}]</span>{" "}
                    <span class={fromTone(m.kind)}>{m.from}:</span> <span>{m.body}</span>
                  </li>
                )}
              </For>
            </Show>
          </ul>
        </div>
      </div>
    </div>
  );
}
