import { For, Show, createEffect, createSignal } from "solid-js";
import { useGame } from "../../lib/game-context";
import type { ModLogEntryView, ModRoomMessageView, ReportView } from "../../lib/protocol";

/**
 * The moderation view (chat.md "Logging" / "Reporting"): the pending report
 * queue and the paged, newest-first enforcement log. Visible to player
 * moderators and server admins; the sidebar entry is gated the same way, and
 * the server re-authorizes every request, so a direct visit as a regular
 * player just shows the notice.
 */
export function Moderator() {
  const game = useGame();
  const isStaff = () => game.world.isAdmin || game.world.isModerator;
  const [note, setNote] = createSignal<{ ok: boolean; text: string }>();

  // Load both surfaces once connected (and on promotion mid-session).
  createEffect(() => {
    if (game.online() && isStaff()) {
      game.requestModReports(0);
      game.requestModLog(0);
    }
  });

  const reports = () => game.world.modReports;
  const log = () => game.world.modLog;
  const browse = () => game.world.modRoomMessages;

  const refreshReports = () => game.requestModReports(reports()?.page ?? 0);
  const fail = (r?: string) => setNote({ ok: false, text: r ?? "action failed" });

  // The room-message browser (chat.md "Logging"): page through any room's full
  // history, including revoked messages (flagged).
  const [roomQuery, setRoomQuery] = createSignal("");
  const browseRoom = (page = 0) => {
    const r = roomQuery().trim();
    if (r) game.requestModRoomMessages(r, page);
  };
  // Revoking from the browser: the server's chatRevoke broadcast flips the
  // message's flag in place (no refetch needed).
  const revokeBrowsed = (m: ModRoomMessageView) => {
    setNote(undefined);
    game.revokeMessage(m.messageId, {
      onSuccess: () => setNote({ ok: true, text: `message ${m.messageId} revoked` }),
      onError: fail,
    });
  };

  const dismiss = (report: ReportView) => {
    setNote(undefined);
    game.resolveReport(report.id, {
      onSuccess: () => {
        setNote({ ok: true, text: `report #${report.id} dismissed` });
        refreshReports();
        game.requestModLog(log()?.page ?? 0);
      },
      onError: fail,
    });
  };

  const revoke = (report: ReportView) => {
    setNote(undefined);
    game.revokeMessage(report.messageId, {
      onSuccess: () => {
        setNote({ ok: true, text: `message ${report.messageId} revoked` });
        refreshReports();
        game.requestModLog(log()?.page ?? 0);
      },
      onError: fail,
    });
  };

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  const Pager = (p: { page: number; hasMore: boolean; go: (page: number) => void }) => (
    <div class="flex items-center gap-2 text-xs text-base-content/55">
      <button class="btn btn-xs" disabled={p.page === 0} onClick={() => p.go(p.page - 1)}>
        ‹ Prev
      </button>
      <span>page {p.page + 1}</span>
      <button class="btn btn-xs" disabled={!p.hasMore} onClick={() => p.go(p.page + 1)}>
        Next ›
      </button>
    </div>
  );

  const LogRow = (p: { e: ModLogEntryView }) => (
    <tr>
      <td class="whitespace-nowrap text-base-content/45">{when(p.e.createdAt)}</td>
      <td class="font-mono">{p.e.moderator}</td>
      <td>
        <span class="badge badge-sm badge-ghost font-mono">{p.e.action}</span>
      </td>
      <td class="font-mono">{p.e.target ?? "—"}</td>
      <td>{p.e.room ? `#${p.e.room}` : "—"}</td>
      <td class="text-base-content/60 max-w-60 truncate" title={p.e.note}>
        {p.e.note ?? ""}
      </td>
    </tr>
  );

  return (
    <section class="size-full flex flex-col gap-4 overflow-y-auto" data-screen-label="Moderator">
      <header class="flex items-baseline gap-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Moderator</h1>
        <span class="text-xs text-base-content/45">// reports & the enforcement log</span>
        <Show when={note()}>
          {(n) => (
            <span class={"text-sm " + (n().ok ? "text-success" : "text-error")}>{n().text}</span>
          )}
        </Show>
      </header>

      <Show
        when={isStaff()}
        fallback={
          <div class="p-3 border border-base-300 rounded-xl bg-base-200 text-sm text-base-content/60 max-w-2xl">
            This area is for player moderators and server admins.
          </div>
        }
      >
        <Show
          when={game.online()}
          fallback={
            <div class="p-3 border border-base-300 rounded-xl bg-base-200 text-sm text-base-content/60 max-w-2xl">
              Offline — moderation needs a server connection.
            </div>
          }
        >
          {/* The pending report queue (chat.md "Reporting"). */}
          <div class="p-3 border border-base-300 rounded-xl bg-base-200">
            <div class="flex items-center gap-3 mb-2">
              <h2 class="font-mono text-sm uppercase tracking-wider text-base-content/55">
                Report queue
              </h2>
              <Show when={reports()}>
                {(r) => <Pager page={r().page} hasMore={r().hasMore} go={game.requestModReports} />}
              </Show>
            </div>
            <Show
              when={(reports()?.reports.length ?? 0) > 0}
              fallback={<div class="text-sm text-base-content/40">No pending reports.</div>}
            >
              <ul class="space-y-2">
                <For each={reports()!.reports}>
                  {(r) => (
                    <li class="p-2 rounded-lg bg-base-100 border border-base-300/60 text-sm">
                      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-base-content/50">
                        <span>#{r.id}</span>
                        <span>{when(r.createdAt)}</span>
                        <span>
                          reported by <span class="font-mono text-base-content/80">{r.reporter}</span>
                        </span>
                        <span>{r.dm ? "DM" : r.room ? `#${r.room}` : "room"}</span>
                        <Show when={r.revoked}>
                          <span class="badge badge-xs badge-error badge-outline">revoked</span>
                        </Show>
                      </div>
                      <div class="mt-1 font-mono text-[13px]">
                        <span class="text-primary">{r.sender}:</span> {r.body}
                      </div>
                      <div class="mt-1 text-xs text-base-content/60 italic">“{r.reason}”</div>
                      <div class="mt-2 flex gap-2">
                        <Show when={!r.dm}>
                          <button
                            class="btn btn-xs btn-error btn-outline"
                            disabled={r.revoked}
                            onClick={() => revoke(r)}
                          >
                            Revoke message
                          </button>
                        </Show>
                        <button class="btn btn-xs" onClick={() => dismiss(r)}>
                          Dismiss
                        </button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>

          {/* Browse any room's full message history (chat.md "Logging"). */}
          <div class="p-3 border border-base-300 rounded-xl bg-base-200">
            <div class="flex items-center gap-3 mb-2 flex-wrap">
              <h2 class="font-mono text-sm uppercase tracking-wider text-base-content/55">
                Room messages
              </h2>
              <form
                class="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  browseRoom(0);
                }}
              >
                <input
                  type="text"
                  class="input input-xs w-40"
                  placeholder="room name"
                  value={roomQuery()}
                  onInput={(e) => setRoomQuery(e.currentTarget.value)}
                />
                <button type="submit" class="btn btn-xs" disabled={!roomQuery().trim()}>
                  Browse
                </button>
              </form>
              <Show when={browse()}>
                {(b) => (
                  <Pager
                    page={b().page}
                    hasMore={b().hasMore}
                    go={(p) => game.requestModRoomMessages(b().room, p)}
                  />
                )}
              </Show>
            </div>
            <Show
              when={browse()}
              fallback={
                <div class="text-sm text-base-content/40">
                  Enter a room name to browse its messages, including revoked ones.
                </div>
              }
            >
              {(b) => (
                <Show
                  when={b().messages.length > 0}
                  fallback={<div class="text-sm text-base-content/40">No messages in #{b().room}.</div>}
                >
                  <div class="text-xs text-base-content/45 mb-1">#{b().room}</div>
                  <ul class="space-y-1">
                    <For each={b().messages}>
                      {(m) => (
                        <li class="p-1.5 rounded bg-base-100 border border-base-300/60 text-sm flex items-baseline gap-2">
                          <span class="text-base-content/40 text-xs whitespace-nowrap">
                            {when(m.sentAt)}
                          </span>
                          <span class="font-mono text-[13px] min-w-0">
                            <span class={m.revoked ? "text-base-content/40 line-through" : "text-primary"}>
                              {m.sender}:
                            </span>{" "}
                            <span class={m.revoked ? "text-base-content/40 line-through" : ""}>{m.body}</span>
                          </span>
                          <Show
                            when={!m.revoked}
                            fallback={
                              <span class="badge badge-xs badge-error badge-outline ml-auto shrink-0">
                                revoked
                              </span>
                            }
                          >
                            <button
                              class="btn btn-xs btn-error btn-outline ml-auto shrink-0"
                              onClick={() => revokeBrowsed(m)}
                            >
                              Revoke
                            </button>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              )}
            </Show>
          </div>

          {/* The enforcement log (chat.md "Logging"), newest first. */}
          <div class="p-3 border border-base-300 rounded-xl bg-base-200">
            <div class="flex items-center gap-3 mb-2">
              <h2 class="font-mono text-sm uppercase tracking-wider text-base-content/55">
                Moderation log
              </h2>
              <Show when={log()}>
                {(l) => <Pager page={l().page} hasMore={l().hasMore} go={game.requestModLog} />}
              </Show>
            </div>
            <Show
              when={(log()?.entries.length ?? 0) > 0}
              fallback={<div class="text-sm text-base-content/40">No enforcement actions yet.</div>}
            >
              <div class="overflow-x-auto">
                <table class="table table-xs">
                  <thead>
                    <tr class="text-base-content/45">
                      <th>When</th>
                      <th>Moderator</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Room</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={log()!.entries}>{(e) => <LogRow e={e} />}</For>
                  </tbody>
                </table>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </section>
  );
}
