import { For, createSignal } from "solid-js";

type ChatLine = { t: string; c: string; u: string; m: string };

// Preliminary chat box (per the design reference): a channel rail, a send row,
// and a monospace transcript. Static data + a no-op send for now — the real
// client will wire these to the server chat stream.
const CHANNELS = ["Main", "Trade", "LFG", "Help"];

const LINES: ChatLine[] = [
  { t: "14:42", c: "Main", u: "vex", m: "anyone gunning for the ridge node?" },
  { t: "14:42", c: "Main", u: "brigid", m: "i'm on it after restock" },
  { t: "14:41", c: "Trade", u: "marshal", m: "WTB copper @ 86, qty 200" },
  { t: "14:40", c: "Main", u: "random_user", m: "test message" },
];

export function ChatPanel(props: { onCollapse?: () => void }) {
  const [active, setActive] = createSignal(0);
  const [draft, setDraft] = createSignal("");

  return (
    <div class="size-full bg-base-200 border-t border-base-300 flex flex-col">
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-base-300/70 shrink-0">
        <span class="text-[10px] uppercase tracking-[0.18em] font-medium text-base-content/55">
          Chat
        </span>
        {props.onCollapse && (
          <button
            class="ml-auto text-base-content/40 hover:text-base-content w-5 h-5 rounded flex items-center justify-center hover:bg-base-300/60"
            title="Collapse chat"
            onClick={() => props.onCollapse?.()}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14" stroke-linecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div class="flex flex-1 min-h-0">
        <div class="w-40 p-3 border-r border-base-300 shrink-0">
          <div class="text-[10px] uppercase tracking-wider text-base-content/45 mb-2">
            Channels
          </div>
          <ul class="space-y-1 text-sm">
            <For each={CHANNELS}>
              {(ch, i) => (
                <li
                  class={
                    "px-2 py-1 rounded cursor-pointer " +
                    (i() === active()
                      ? "bg-base-300 font-medium"
                      : "hover:bg-base-300/50 text-base-content/70")
                  }
                  onClick={() => setActive(i())}
                >
                  #{ch}
                </li>
              )}
            </For>
          </ul>
        </div>
        <div class="flex-1 p-3 flex flex-col gap-2 min-w-0">
          <form
            class="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setDraft("");
            }}
          >
            <input
              type="text"
              placeholder="Send a chat message or chat command."
              class="input input-sm grow"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
            />
            <button type="submit" class="btn btn-sm" disabled={!draft().trim()}>
              Send
            </button>
          </form>
          <ul class="grow border border-base-300 rounded p-2 overflow-y-auto font-mono text-[12px] leading-relaxed">
            <For each={LINES}>
              {(l) => (
                <li class="text-base-content/85">
                  <span class="text-base-content/35">[{l.t}]</span>{" "}
                  <span class="text-base-content/45">[{l.c}]</span>{" "}
                  <span class="text-primary">{l.u}:</span> <span>{l.m}</span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>
    </div>
  );
}
