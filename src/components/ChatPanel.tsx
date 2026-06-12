import { For, Show, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
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

/** The username popup's anchor: the clicked entry plus where to render. */
type Menu = { entry: ChatEntry; x: number; y: number; mode: "menu" | "report" };

export function ChatPanel(props: { onCollapse?: () => void }) {
  const game = useGame();
  const navigate = useNavigate();
  const [draft, setDraft] = createSignal("");
  const [menu, setMenu] = createSignal<Menu | null>(null);
  const [reportReason, setReportReason] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  const isDms = () => game.chat.activeRoom === game.dmBucket;
  const entries = () => game.chat.byRoom[game.chat.activeRoom] ?? [];
  const isStaff = () => game.world.isAdmin || game.world.isModerator;
  /** The room context commands/notices ride: null in the DM view. */
  const roomCtx = () => (isDms() ? null : game.chat.activeRoom);

  /** Handle a typed "/command …" line (chat.md "Chat commands"): /whois is
   * client-local navigation; /leave-room and /close-room autofill the active
   * room when the argument is omitted; everything else goes to the server
   * raw, with the room context. */
  const runCommand = (body: string) => {
    const tokens = body.split(/\s+/);
    const cmd = tokens[0].toLowerCase();

    if (cmd === "/whois") {
      if (tokens[1]) {
        navigate(`/profile/${encodeURIComponent(tokens[1])}`);
      } else {
        game.chatNotice(roomCtx(), "✗ usage: /whois <username>");
      }
      return;
    }
    let line = body;
    if ((cmd === "/leave-room" || cmd === "/close-room") && tokens.length === 1 && !isDms()) {
      line = `${cmd} ${game.chat.activeRoom}`;
    }
    game.sendChatCommand(roomCtx(), line);
  };

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    const body = draft().trim();
    if (!body) return;
    if (body.startsWith("/")) {
      runCommand(body);
    } else if (isDms()) {
      // Plain messages need a room; DMs are addressed by command.
      game.chatNotice(null, "Use /w <username> <message> to send a direct message.");
      return; // keep the draft so it can be prefixed
    } else {
      game.sendRoom(game.chat.activeRoom, body);
    }
    setDraft("");
  };

  /** Open the username popup for a clicked sender. */
  const openMenu = (entry: ChatEntry, e: MouseEvent) => {
    setReportReason("");
    setMenu({ entry, x: e.clientX, y: e.clientY, mode: "menu" });
  };

  const closeMenu = () => setMenu(null);

  const viewProfile = (entry: ChatEntry) => {
    closeMenu();
    navigate(`/profile/${encodeURIComponent(entry.from)}`);
  };

  const prefillDm = (entry: ChatEntry) => {
    closeMenu();
    setDraft(`/w ${entry.from} `);
    inputRef?.focus();
  };

  const submitReport = (entry: ChatEntry) => {
    const reason = reportReason().trim();
    if (!reason || entry.messageId == null) return;
    const surface = roomCtx();
    game.reportMessage(entry.messageId, reason, entry.kind === "dm", {
      onSuccess: () => game.chatNotice(surface, "✓ report filed"),
      onError: (r) => game.chatNotice(surface, `✗ ${r ?? "could not file the report"}`),
    });
    closeMenu();
  };

  const revoke = (entry: ChatEntry) => {
    if (entry.messageId == null) return;
    const surface = roomCtx();
    // The removal itself arrives as the server's chatRevoke broadcast.
    game.revokeMessage(entry.messageId, {
      onError: (r) => game.chatNotice(surface, `✗ ${r ?? "could not revoke the message"}`),
    });
    closeMenu();
  };

  const label = (room: string) => (room === game.dmBucket ? "DMs" : `#${room}`);

  /** Whether an entry's sender is a clickable player name (not System/local). */
  const clickable = (m: ChatEntry) => m.kind === "room" || m.kind === "dm";

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
              ref={inputRef}
              type="text"
              placeholder={
                isDms()
                  ? "/w <username> <message> — or /commands"
                  : `Message ${label(game.chat.activeRoom)}… (/ for commands)`
              }
              class="input input-sm grow"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
            />
            <button type="submit" class="btn btn-sm" disabled={!draft().trim()}>
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
                    <Show
                      when={clickable(m)}
                      fallback={<span class={fromTone(m.kind)}>{m.from}:</span>}
                    >
                      <button
                        class={fromTone(m.kind) + " hover:underline cursor-pointer"}
                        title={`About ${m.from}…`}
                        onClick={(e) => openMenu(m, e)}
                      >
                        {m.from}:
                      </button>
                    </Show>{" "}
                    <span>{m.body}</span>
                  </li>
                )}
              </For>
            </Show>
          </ul>
        </div>
      </div>

      {/* The username popup: profile / DM / report (+ revoke for staff). */}
      <Show when={menu()}>
        {(m) => (
          <>
            <div class="fixed inset-0 z-40" onClick={closeMenu} />
            <div
              class="fixed z-50 w-56 bg-base-100 border border-base-300 rounded-lg shadow-lg p-1 text-sm"
              style={{
                left: `${Math.min(m().x, window.innerWidth - 240)}px`,
                top: `${Math.min(m().y, window.innerHeight - 200)}px`,
              }}
            >
              <div class="px-2 py-1 text-xs text-base-content/45 border-b border-base-300/60 mb-1 truncate">
                {m().entry.from}
              </div>
              <Show
                when={m().mode === "menu"}
                fallback={
                  <form
                    class="p-1 flex flex-col gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitReport(m().entry);
                    }}
                  >
                    <input
                      type="text"
                      class="input input-xs w-full"
                      placeholder="Reason (required)"
                      maxLength={500}
                      value={reportReason()}
                      onInput={(e) => setReportReason(e.currentTarget.value)}
                    />
                    <div class="flex gap-1.5">
                      <button type="submit" class="btn btn-xs btn-warning grow" disabled={!reportReason().trim()}>
                        File report
                      </button>
                      <button type="button" class="btn btn-xs btn-ghost" onClick={closeMenu}>
                        Cancel
                      </button>
                    </div>
                  </form>
                }
              >
                <ul class="menu menu-sm p-0 w-full [&_button]:rounded">
                  <li>
                    <button onClick={() => viewProfile(m().entry)}>View profile</button>
                  </li>
                  <li>
                    <button onClick={() => prefillDm(m().entry)}>Send DM</button>
                  </li>
                  <Show when={m().entry.messageId != null}>
                    <li>
                      <button onClick={() => setMenu({ ...m(), mode: "report" })}>
                        Report message
                      </button>
                    </li>
                  </Show>
                  <Show when={isStaff() && m().entry.kind === "room" && m().entry.messageId != null}>
                    <li>
                      <button class="text-error" onClick={() => revoke(m().entry)}>
                        Revoke message
                      </button>
                    </li>
                  </Show>
                </ul>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
