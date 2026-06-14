import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { useGame } from "../../lib/game-context";
import { STAT_KEYS } from "../../lib/stats";
import { Icon } from "../../components/Icon";
import { PixelPortrait } from "../../components/PixelPortrait";

// The global rankings leaderboard (rankings.md): compare players' stats, skills,
// and knowledge. Pick a metric — the six stats are stable chips; skills and
// knowledge are reached through the search box — and a descending, paged board
// (10/row) renders on the right. Stat/skill boards are per-unit (a unit + its
// owner's name); knowledge boards are per-account. A player search jumps to
// where a given username sits. Everything is server-authoritative; offline it
// shows a connect-needed state rather than invented standings.

const PAGE_SIZE = 10;

/** The metric's family, derived from its key prefix (mirrors the backend). */
const metricKind = (key: string): "stat" | "skill" | "knowledge" | "metric" => {
  if (key.startsWith("stat:")) return "stat";
  if (key.startsWith("skill:")) return "skill";
  if (key.startsWith("know:")) return "knowledge";
  return "metric";
};

export function Rankings() {
  const game = useGame();
  const [params, setParams] = useSearchParams();

  // Initialise from the URL once (deep-link: ?metric=&page=&player=), then the
  // signals own the state and write back to the URL for shareable links.
  const initialMetric = typeof params.metric === "string" ? params.metric : "stat:str";
  const initialPage = (() => {
    const p = typeof params.page === "string" ? parseInt(params.page, 10) : 0;
    return Number.isFinite(p) && p > 0 ? p : 0;
  })();

  const [metric, setMetric] = createSignal(initialMetric);
  const [page, setPage] = createSignal(initialPage);
  const [metricSearch, setMetricSearch] = createSignal("");
  const [playerQuery, setPlayerQuery] = createSignal(
    typeof params.player === "string" ? params.player : "",
  );

  // Fetch the metric catalog when we come online (fixed for a build; the picker
  // filters it client-side).
  createEffect(() => {
    if (game.online()) game.listRankingMetrics();
  });

  // Pull the board page whenever the metric or page changes (or we reconnect).
  // Depending on `rankingsBucket()` re-fetches when the 15-minute wall-clock
  // window rolls — the server rebuilds the board then, so the cache is dropped
  // and this re-requests the fresh one even while sitting on the page.
  createEffect(() => {
    game.rankingsBucket();
    if (game.online()) game.viewRankings(metric(), page());
  });

  // Reflect the metric/page in the URL (replace, so it doesn't spam history).
  createEffect(() => {
    setParams({ metric: metric(), page: String(page()) }, { replace: true });
  });

  // When a player search resolves to a ranked player on the active board, jump
  // to their page so the highlighted row is visible.
  createEffect(() => {
    const at = game.world.rankings.playerAt;
    if (at && at.found && at.metric === metric() && at.page != null) setPage(at.page);
  });

  // The board for the current (metric, page), straight from the wall-clock
  // cache (`world.rankings.boards`); null until it has been fetched this window.
  const board = () => game.world.rankings.boards[`${metric()}:${page()}`] ?? null;

  const isKnowledge = () => metricKind(metric()) === "knowledge";
  const valueLabel = () => (isKnowledge() ? "Knowledge" : "Level");
  const totalPages = () => Math.max(1, Math.ceil((board()?.total ?? 0) / PAGE_SIZE));

  /** The display name of the active metric — from the loaded board, else the
   * catalog, else the stat chip label, else the raw key. */
  const metricName = () => {
    const b = board();
    if (b) return b.metricName;
    const cat = game.world.rankings.metrics.find((m) => m.key === metric());
    if (cat) return cat.name;
    const stat = STAT_KEYS.find(([k]) => `stat:${k}` === metric());
    return stat ? stat[1] : metric();
  };

  /** Skill + knowledge metrics matching the picker search (stats are chips). */
  const searchMatches = createMemo(() => {
    const q = metricSearch().trim().toLowerCase();
    const all = game.world.rankings.metrics.filter((m) => m.kind !== "stat");
    const list = q
      ? all.filter((m) => m.name.toLowerCase().includes(q) || m.key.toLowerCase().includes(q))
      : all;
    return list.slice(0, 30);
  });

  /** The username to highlight on the board (the last successful find on this
   * metric), lowercased for comparison. */
  const highlightUser = (): string | null => {
    const at = game.world.rankings.playerAt;
    return at && at.found && at.metric === metric() ? at.username.toLowerCase() : null;
  };

  /** A find that resolved to "not ranked here" for the active board. */
  const notFound = () => {
    const at = game.world.rankings.playerAt;
    return at != null && !at.found && at.metric === metric() ? at.username : null;
  };

  const selectMetric = (key: string) => {
    if (key === metric()) return;
    setMetric(key);
    setPage(0);
    setMetricSearch("");
  };

  // Re-run the player search when the metric changes if a query is set, so the
  // "find" follows the board.
  createEffect(
    on(metric, () => {
      const q = playerQuery().trim();
      if (q && game.online()) game.findRankingPlayer(metric(), q);
    }),
  );

  const runFind = () => {
    const q = playerQuery().trim();
    if (q && game.online()) game.findRankingPlayer(metric(), q);
  };

  return (
    <section class="size-full flex flex-col" data-screen-label="Rankings">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Rankings</h1>
        <span class="text-xs text-base-content/45">// compare with everyone on the board</span>
      </header>

      <div class="grow flex flex-col md:flex-row gap-4 overflow-y-auto md:overflow-hidden">
        {/* Metric picker */}
        <aside class="md:w-64 shrink-0 flex flex-col gap-3 md:overflow-y-auto">
          <div class="rounded-box bg-base-200/40 p-3">
            <div class="text-[0.65rem] uppercase tracking-wide text-base-content/50 mb-2">Stats</div>
            <div class="grid grid-cols-3 gap-1.5">
              <For each={STAT_KEYS}>
                {([k, label]) => {
                  const key = `stat:${k}`;
                  return (
                    <button
                      class="btn btn-xs"
                      classList={{ "btn-primary": metric() === key, "btn-ghost": metric() !== key }}
                      onClick={() => selectMetric(key)}
                    >
                      {label}
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          <div class="rounded-box bg-base-200/40 p-3 flex flex-col gap-2 min-h-0">
            <div class="text-[0.65rem] uppercase tracking-wide text-base-content/50">
              Skills &amp; knowledge
            </div>
            <input
              class="input input-sm w-full"
              type="text"
              placeholder="search a skill or zone…"
              value={metricSearch()}
              onInput={(e) => setMetricSearch(e.currentTarget.value)}
            />
            <div class="overflow-y-auto max-h-64 -mx-1">
              <Show
                when={searchMatches().length > 0}
                fallback={
                  <p class="px-2 py-1.5 text-[0.7rem] text-base-content/40">
                    {game.world.rankings.metrics.length === 0
                      ? "Connect to load the metric catalog."
                      : "No matching skill or knowledge entry."}
                  </p>
                }
              >
                <For each={searchMatches()}>
                  {(m) => (
                    <button
                      class="w-full text-left px-2 py-1.5 rounded flex items-center gap-2 hover:bg-base-100/50"
                      classList={{ "bg-primary/15 ring-1 ring-inset ring-primary/40": m.key === metric() }}
                      onClick={() => selectMetric(m.key)}
                    >
                      <span class="min-w-0 grow truncate text-sm">{m.name}</span>
                      <span class="badge badge-xs badge-ghost shrink-0">{m.kind}</span>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </aside>

        {/* Board */}
        <div class="grow min-w-0 flex flex-col gap-3 md:overflow-y-auto pr-1">
          <div class="flex flex-wrap items-baseline gap-2 px-1">
            <h2 class="text-lg font-semibold">{metricName()}</h2>
            <span class="badge badge-sm badge-ghost">{metricKind(metric())}</span>
            <Show when={board()}>
              {(b) => (
                <span class="ml-auto text-xs text-base-content/55 font-mono">
                  {b().total.toLocaleString("en-US")} ranked
                </span>
              )}
            </Show>
          </div>

          {/* Find a player on this board */}
          <div class="flex flex-wrap items-center gap-2 px-1">
            <input
              class="input input-sm grow max-w-xs"
              type="text"
              placeholder="find a player by username…"
              value={playerQuery()}
              onInput={(e) => setPlayerQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && runFind()}
            />
            <button class="btn btn-sm btn-ghost" onClick={runFind} disabled={!playerQuery().trim()}>
              Find
            </button>
            <Show when={notFound()}>
              {(name) => (
                <span class="text-xs text-warning">{name()} is not ranked on this board.</span>
              )}
            </Show>
          </div>

          <Show
            when={game.online()}
            fallback={
              <div class="grow flex flex-col items-center justify-center text-center gap-3 text-base-content/50">
                <Icon name="NumberedList" class="size-10 opacity-40" />
                <p class="max-w-xs text-sm">
                  The rankings stream from the server. Connect to compare your
                  stats, skills, and knowledge with everyone else.
                </p>
              </div>
            }
          >
            <div class="rounded-box bg-base-200/40 overflow-hidden">
              <Show
                when={(board()?.rows.length ?? 0) > 0}
                fallback={
                  <p class="px-3 py-6 text-center text-sm text-base-content/45">
                    No one is ranked here yet.
                  </p>
                }
              >
                <table class="table table-sm">
                  <thead>
                    <tr class="text-base-content/45">
                      <th class="w-12">#</th>
                      <th>Player</th>
                      <Show when={!isKnowledge()}>
                        <th>Unit</th>
                      </Show>
                      <th class="text-right">{valueLabel()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={board()?.rows ?? []}>
                      {(row) => (
                        <tr
                          classList={{
                            "bg-primary/10": row.username.toLowerCase() === highlightUser(),
                          }}
                        >
                          <td class="font-mono text-base-content/55">{row.rank}</td>
                          <td>
                            <div class="flex items-center gap-2 min-w-0">
                              <PixelPortrait
                                seed={row.unitId ? `unit:${row.unitId}` : `acct:${row.accountId}`}
                                class="size-6 rounded shrink-0"
                              />
                              <span class="truncate font-medium">{row.username}</span>
                            </div>
                          </td>
                          <Show when={!isKnowledge()}>
                            <td class="truncate text-base-content/70">{row.unitName ?? "—"}</td>
                          </Show>
                          <td class="text-right font-mono tabular-nums">
                            {row.value.toLocaleString("en-US")}
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>

            {/* Paginator */}
            <Show when={totalPages() > 1}>
              <div class="flex items-center justify-center gap-2">
                <button
                  class="btn btn-xs btn-ghost"
                  disabled={page() === 0}
                  onClick={() => setPage(Math.max(0, page() - 1))}
                >
                  ‹ prev
                </button>
                <span class="font-mono text-xs text-base-content/55 tabular-nums">
                  page {page() + 1}/{totalPages()}
                </span>
                <button
                  class="btn btn-xs btn-ghost"
                  disabled={!board()?.hasMore}
                  onClick={() => setPage(page() + 1)}
                >
                  next ›
                </button>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </section>
  );
}
