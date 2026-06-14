// The game context: the client's single connection to backend state.
//
// Scope is grounded in what the backend actually serves: AUTH (a session
// token), CHAT (rooms + DMs), the IDLE-ACTION lifecycle (combat only today):
// the `gameState` slice of the connect-time push, zone enemy listings,
// change/stop action, per-tick `actionTick` deltas, and the final
// `actionRewards`; plus the INVENTORY/roster/effects snapshots (holdings,
// units + gear, formation-scoped Zone Effects) and their equip/use ops, and
// the FORMATION layout (the `formation` snapshot + whole-layout
// `setFormation` edits); plus TRAVEL (the travel action) and the zone MAP
// (`listMap` → `mapView`, the discovered/frontier gridmap the Area page
// renders). Surfaces the backend doesn't serve (markets, profile/rankings)
// stay unmodeled — those pages keep placeholders until the wire grows them.
//
// In `uiDev`/offline mode there is no socket; chat sends echo locally so the UI
// is exercisable without a server, and actions report that a server is needed.

import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  useContext,
  type ParentProps,
} from "solid-js";
import { createStore } from "solid-js/store";
import { authToken, clearAuth } from "./auth";
import { config } from "./config";
import { Connection, type ConnStatus } from "./connection";
import type {
  ActionView,
  BossOptionView,
  ChatHistoryMessage,
  ClientData,
  CombatLobbyView,
  CombatState,
  CombatView,
  CurrenciesView,
  DestinationInfo,
  Direction,
  EffectView,
  EnemyInfo,
  FormationSlotView,
  GearView,
  GeneralResourcesView,
  GoodInfo,
  ItemStackView,
  MapZoneInfo,
  ModLogEntryView,
  ModRoomMessageView,
  OrderLevel,
  OrderView,
  RankMetricView,
  RankRow,
  ReportView,
  RewardsView,
  ServerMessage,
  UnitView,
  ZonePlayerView,
} from "./protocol";

/** Canonical built-in rooms (knowledge-base/design/chat.md "Built-in rooms"). */
export const BUILTIN_ROOMS = ["global", "main", "help", "trade"] as const;

/** Whether `room` is one of the built-in rooms (auto-subscribed, un-leaveable). */
export const isBuiltin = (room: string): boolean =>
  (BUILTIN_ROOMS as readonly string[]).includes(room);

export type GameStatus = "offline" | ConnStatus | "auth-needed";

export type ChatEntry = {
  id: number;
  /** Room name, or undefined for DMs. */
  room?: string;
  /** Display name of the sender (a username for server messages). */
  from: string;
  body: string;
  /** ISO timestamp, or undefined for locally-generated entries. */
  at?: string;
  kind: "room" | "dm" | "system" | "local";
  /** The server-assigned message id (room messages and DMs) — what report
   * and revoke ops address; absent on local/system lines. */
  messageId?: number;
};

const DM_BUCKET = "@dms";

type ChatState = {
  rooms: string[];
  activeRoom: string;
  byRoom: Record<string, ChatEntry[]>;
  /** Per-room history load state (chat.md "Message history"): an entry exists
   * once the room's backlog has been fetched, and `hasMore` says whether older
   * messages remain to page back to. The DM bucket is never tracked here. */
  history: Record<string, { hasMore: boolean; }>;
};

/** One line of the action log (the Actions screen's right-hand column). */
export type ActionLogEntry = {
  id: number;
  text: string;
  kind: "info" | "combat" | "failure" | "reward" | "local";
};

/** The final reward report of the last ended action, held for the reward view
 * until dismissed or a new action starts. */
export type RewardReport = {
  kind: string;
  /** What the action acted on, by display name (the enemy for combat). */
  targetName: string;
  kcTarget: number;
  kcDone: number;
  stopped: boolean;
  rewards: RewardsView;
};

/** What an action is acting on, by display name (its kind's slice owns it). */
export const actionTarget = (action: ActionView): string =>
  action.combat?.enemyName ?? action.travel?.destinationName ?? action.kind;

/** The committed holdings (the `inventory` push): authoritative server
 * snapshot, replaced wholesale — never accumulated client-side. */
export type InventoryState = {
  currencies: CurrenciesView;
  general: GeneralResourcesView;
  /** Item stacks, sorted by template id server-side. */
  items: ItemStackView[];
  /** The viewed PAGE of unequipped gear instances (the collection is
   * unbounded, the snapshot is not; equipped gear lives on the roster
   * units). Pick the page with `requestGearPage`. */
  gear: GearView[];
  /** The 0-based page `gear` carries (server-clamped). */
  gearPage: number;
  /** Total pages (≥ 1). */
  gearPages: number;
  /** Total unequipped instances across all pages. */
  gearTotal: number;
};

/** The global-market client slice (markets.md): the goods catalog, the order
 * book for the currently-viewed good (replaced per `marketBook` push), and the
 * player's own active orders (replaced per `marketOrders` push). */
export type MarketState = {
  goods: GoodInfo[];
  book: { good: string; bids: OrderLevel[]; asks: OrderLevel[]; yours: OrderView[]; } | null;
  myOrders: OrderView[];
};

/** One cached rankings board page (a `rankingsPage` answer). */
export type RankingsBoard = {
  metric: string;
  metricName: string;
  page: number;
  total: number;
  hasMore: boolean;
  rows: RankRow[];
};

/** The rankings client slice (rankings.md). The server rebuilds the boards on a
 * fixed 15-minute wall-clock cadence, so every board page seen within the
 * current window is **cached** and served instantly; the cache is dropped when
 * the wall-clock window rolls (a new bucket), matching the server's rebuild. */
export type RankingsState = {
  /** The selectable metrics (stats + skills + knowledge); fixed for a build. */
  metrics: RankMetricView[];
  /** The 15-minute wall-clock bucket `boards`/`playerAt` belong to
   * (`floor(epochMs / 15min)`); a change invalidates them. */
  bucket: number;
  /** Cached board pages for the current bucket, keyed `${metric}:${page}`. */
  boards: Record<string, RankingsBoard>;
  /** The last `findRankingPlayer` answer (this bucket), or null. */
  playerAt: {
    metric: string;
    username: string;
    found: boolean;
    rank: number | null;
    page: number | null;
    value: number | null;
  } | null;
};

/** The rankings wall-clock cache period: 15 minutes, matching the backend's
 * board-rebuild cadence (rankings.md "Freshness"). */
export const RANKINGS_BUCKET_MS = 15 * 60 * 1000;

/** The 15-minute wall-clock bucket index for an epoch-ms timestamp. Aligned to
 * the same `:00/:15/:30/:45` boundaries the backend rebuilds on (both bucket
 * off the Unix epoch). */
export const rankingsBucketOf = (epochMs: number): number =>
  Math.floor(epochMs / RANKINGS_BUCKET_MS);

/** Total use-based XP accrued across a tally's `(unit, target)` gains. */
export const totalXp = (r: RewardsView): number =>
  (r.experience ?? []).reduce((sum, e) => sum + e.amount, 0);

/** Total Knowledge accrued across a tally's per-entity gains. */
export const totalKnowledge = (r: RewardsView): number =>
  (r.knowledge ?? []).reduce((sum, k) => sum + k.amount, 0);

/** The level-ups a committed tally produced, as "STR 1→2" labels (progression.md).
 * Only meaningful on the final `actionRewards` — per-tick gains carry level 0. */
export const levelUps = (r: RewardsView): string[] =>
  (r.experience ?? [])
    .filter((e) => e.levelAfter > e.levelBefore)
    .map((e) => `${e.target.toUpperCase()} ${e.levelBefore}→${e.levelAfter}`);

/** A reward tally as one log-friendly line ("2 kills, 9 credits, 1 met, …"). */
export const summarizeRewards = (r: RewardsView): string => {
  const parts = [`${r.kills} kills`, `${r.currencies.credits} credits`];
  if (r.currencies.dust > 0) parts.push(`${r.currencies.dust} dust`);
  if (r.currencies.rousingDevices > 0) parts.push(`${r.currencies.rousingDevices} rousing devices`);
  for (const [id, q] of Object.entries(r.general)) if (q > 0) parts.push(`${q} ${id}`);
  for (const s of r.items) parts.push(`${s.qty}× ${s.name}`);
  const xp = totalXp(r);
  if (xp > 0) parts.push(`${xp} xp`);
  const kn = totalKnowledge(r);
  if (kn > 0) parts.push(`${kn} knowledge`);
  return parts.join(", ");
};

/** The game-engine slice of client state: zone, the in-flight idle action
 * (baseline from `gameState`, folded with `actionTick` deltas), the per-zone
 * enemy roster cache, and the action log. */
type WorldState = {
  zone: string;
  action: ActionView | null;
  /** Zone ("x,y,z") → its knowledge-filtered enemy roster, cached per server
   * push (the server expects the client to cache these). */
  enemies: Record<string, EnemyInfo[]>;
  /** Zone ("x,y,z") → its legal travel destinations (adjacent authored
   * zones), cached per server push like the enemy roster. */
  destinations: Record<string, DestinationInfo[]>;
  /** The player's zone map (the `mapView` push): the discovered zones plus
   * their one-step frontier (zones-and-travel.md "Map visibility"),
   * authoritative and replaced wholesale. `current` is the zone the player
   * stands in. Null until the first push (offline mode). */
  map: { current: string; zones: MapZoneInfo[]; } | null;
  /** The global market (markets.md): the tradeable-goods catalog, the order
   * book for the currently-viewed good (replaced wholesale per `viewMarket`),
   * and the player's own active orders across all goods. Null until the first
   * `marketGoods` push (offline mode). */
  market: MarketState | null;
  /** The global rankings (rankings.md): the metric catalog, the board page in
   * view, and the last player-search answer. The catalog is empty and the
   * board/playerAt null until requested (offline mode). */
  rankings: RankingsState;
  /** Committed holdings; null until the first server push (offline mode). */
  inventory: InventoryState | null;
  /** Owned units (the `roster` push); null until the first server push. */
  roster: UnitView[] | null;
  /** The formation layout (the `formation` push): every occupied cell of the
   * 5x5 grid, authoritative and replaced wholesale; null until the first
   * server push. An in-flight action keeps its cached Preparation-walk stats,
   * so mid-action this can legitimately disagree with `action`. */
  formation: FormationSlotView[] | null;
  /** Active formation-scoped Zone Effects (the `effects` push); authoritative,
   * replaced wholesale. Empty until the first push. */
  effects: EffectView[];
  /** Whether this connection's account is a designated admin (the `adminStatus`
   * push, server-status.md). UI hint for showing the admin surface; the server
   * re-checks the sudoers designation on every command. False until pushed /
   * offline. */
  isAdmin: boolean;
  /** Whether this connection's account is a designated player moderator
   * (chat.md "Moderator designation"); same push, same UI-hint caveats. */
  isModerator: boolean;
  /** The last `chatProfile` answer (chat.md "Player profiles"): the looked-up
   * player's username (null for the requester's own guest account), live online
   * flag, and account id — present only where the requester may see it (their
   * own always, anyone's when staff), null otherwise. Null until a lookup
   * answers / after a new lookup starts. */
  profile: { username: string | null; online: boolean; accountId: number | null; } | null;
  /** The current page of the enforcement log (the moderation view; staff
   * only). Replaced per `modLogPage` push; null until requested. */
  modLog: { page: number; hasMore: boolean; entries: ModLogEntryView[]; } | null;
  /** The current page of the pending report queue (staff only). Replaced per
   * `modReportsPage` push; null until requested. */
  modReports: { page: number; hasMore: boolean; reports: ReportView[]; } | null;
  /** The current page of the moderation room-message browser (chat.md
   * "Logging"; staff only): the room being viewed and its newest-first page.
   * Replaced per `modRoomMessagesPage` push; null until requested. */
  modRoomMessages: {
    room: string;
    page: number;
    hasMore: boolean;
    messages: ModRoomMessageView[];
  } | null;
  /** The designated player moderators (admin UI; the `moderators` push).
   * Null until requested. */
  moderators: string[] | null;
  lastRewards: RewardReport | null;
  /** The players present in the current zone (the `zonePlayers` push, combat.md
   * "Active combat" / zones-and-travel.md co-presence). Replaced wholesale;
   * empty until requested / offline. */
  zonePlayers: ZonePlayerView[];
  /** The open active-combat lobbies in the current zone (the `combatList`
   * push). Replaced wholesale; empty until requested / offline. */
  zoneCombat: CombatLobbyView[];
  /** The bosses that can be roused in the current zone — the available
   * active-combat actions (the `zoneBosses` push). Empty until requested. */
  zoneBosses: BossOptionView[];
  /** The active-combat instance the player is currently in (the `combatState`
   * push), or null when not in a fight. Cleared on `combatClosed`. */
  combat: CombatState | null;
  lastActionKind: string | null;
  /** The last combat request, for quick restart. */
  lastCombat: { enemy: string; kc: number; } | null;
  /** The last travel request (the chosen direction), for quick restart. */
  lastTravel: { direction: Direction; } | null;
  log: ActionLogEntry[];
};

export type Game = {
  status: () => GameStatus;
  online: () => boolean;
  chat: ChatState;
  setActiveRoom: (room: string) => void;
  sendRoom: (room: string, body: string) => void;
  sendDm: (to: string, body: string) => void;
  joinRoom: (room: string, password?: string) => void;
  leaveRoom: (room: string) => void;
  /** Send a raw "/command …" line (chat.md "Chat commands") with the room it
   * was typed in (null from the DM view). The server parses, authorizes, and
   * dispatches it; the result (an ack's result line or a nack's reason) is
   * surfaced as a system line where the command was typed. `/logout`'s ack
   * additionally signs the client out. */
  sendChatCommand: (room: string | null, body: string) => void;
  /** Append a client-local system line to a room's transcript (null = the DM
   * view) — UI feedback like "report filed", never sent anywhere. */
  chatNotice: (room: string | null, body: string) => void;
  /** Report a message by its server id (chat.md "Reporting"); `dm` says which
   * message log the id addresses. */
  reportMessage: (
    messageId: number,
    reason: string,
    dm: boolean,
    handlers?: { onSuccess?: () => void; onError?: (reason?: string) => void; },
  ) => void;
  /** Revoke a room message (moderators/admins only — chat.md "Enforcement"):
   * the server marks it and broadcasts the hide instruction to everyone. */
  revokeMessage: (
    messageId: number,
    handlers?: { onSuccess?: () => void; onError?: (reason?: string) => void; },
  ) => void;
  /** Look up a player's minimal profile (username + online); null = own.
   * Answered via `world.profile`. */
  requestProfile: (username: string | null, onError?: (reason?: string) => void) => void;
  /** Request a page of the enforcement log (staff only; → `world.modLog`). */
  requestModLog: (page: number) => void;
  /** Request a page of the pending report queue (staff only; →
   * `world.modReports`). */
  requestModReports: (page: number) => void;
  /** Page further back through the active room's history (chat.md "Message
   * history"), using the oldest loaded message as the cursor. */
  loadOlderHistory: (room: string) => void;
  /** Whether a room has older history left to page back to. */
  historyHasMore: (room: string) => boolean;
  /** Browse a page of any room's full message history (staff only; →
   * `world.modRoomMessages`). */
  requestModRoomMessages: (room: string, page: number) => void;
  /** Resolve (dismiss) a pending report (staff only). */
  resolveReport: (
    reportId: number,
    handlers?: { onSuccess?: () => void; onError?: (reason?: string) => void; },
  ) => void;
  /** Designate / un-designate a player moderator (admin command, sudoers-
   * gated server-side — only surface to `world.isAdmin`). */
  setModerator: (
    username: string,
    moderator: boolean,
    handlers?: { onSuccess?: (msg?: string) => void; onError?: (reason?: string) => void; },
  ) => void;
  /** Request the current moderator list (admin command; → `world.moderators`). */
  listModerators: () => void;
  resync: () => void;
  dmBucket: string;
  world: WorldState;
  /** Request the current zone's selectable enemies (answered by `enemyList`). */
  listEnemies: () => void;
  /** Request the current zone's travel destinations (answered by
   * `destinationList`). */
  listDestinations: () => void;
  /** Request the player's zone map (answered by `mapView`). */
  listMap: () => void;
  /** Start (or replace — atomic stop-then-start) an idle-combat action. */
  startCombat: (enemyId: string, kc: number) => void;
  /** Start (or replace — atomic stop-then-start) a travel action toward the
   * adjacent zone in `direction`. */
  startTravel: (direction: Direction) => void;
  /** Manually stop the in-flight idle action, committing accrued rewards. */
  stopAction: () => void;
  /** Equip an unequipped gear instance onto a roster unit; the server acks
   * with fresh inventory + roster snapshots or nacks with the reason
   * (`onError`). */
  equipGear: (unit: string, instanceId: number, onError?: (reason?: string) => void) => void;
  /** Unequip a gear instance (by id) back into the inventory. */
  unequipGear: (unit: string, instanceId: number, onError?: (reason?: string) => void) => void;
  /** Select the page of unequipped gear the inventory snapshots carry
   * (answered with a fresh `inventory` push; out-of-range pages clamp). */
  requestGearPage: (page: number) => void;
  /** Use a consumable on the player's own formation (items.md "Consumables");
   * the server acks with fresh inventory + effects snapshots or nacks
   * (`onError`). */
  useConsumable: (item: string, onError?: (reason?: string) => void) => void;
  /** Replace the formation layout as a whole (formations.md "Editing the
   * formation"); the server validates atomically and acks with the fresh
   * `formation` snapshot or nacks with the reason (`onError`). Nothing is
   * applied optimistically. */
  setFormation: (slots: FormationSlotView[], onError?: (reason?: string) => void) => void;
  /** Set the message of the day (an admin command, server-status.md). Gated
   * server-side against the `sudoers` designation; a non-admin sender is
   * disconnected, so only surface this when `world.isAdmin`. `onSuccess` fires
   * on the ack, `onError` on a nack. */
  setMotd: (
    body: string,
    handlers?: { onSuccess?: () => void; onError?: (reason?: string) => void; },
  ) => void;
  /** Hot-reload the server's authored content catalogs (an admin command,
   * content-format.md "Hot reload"). Sudoers-gated server-side like
   * `setMotd` — only surface when `world.isAdmin`. Each reload leaks the
   * superseded catalog generation, so the caller should confirm first.
   * `onSuccess` fires on the ack, `onError` on a nack. */
  reloadContent: (handlers?: {
    onSuccess?: (msg?: string) => void;
    onError?: (reason?: string) => void;
  }) => void;
  /** Force the rankings board to recompute now (an admin command, rankings.md
   * "Freshness"), off the normal 15-minute wall-clock cadence. Sudoers-gated
   * server-side like `setMotd` — only surface when `world.isAdmin`. `onSuccess`
   * fires on the ack, `onError` on a nack. */
  rebuildRankings: (handlers?: {
    onSuccess?: (msg?: string) => void;
    onError?: (reason?: string) => void;
  }) => void;
  /** Request the global-market goods catalog (answered by `marketGoods`). */
  listMarketGoods: () => void;
  /** Request one good's order book (answered by `marketBook`). */
  viewMarket: (good: string) => void;
  /** Request the player's active orders across all goods (answered by
   * `marketOrders`). */
  listMyOrders: () => void;
  /** Place a resting limit buy order; the ack rides with fresh inventory +
   * book + orders snapshots, or nacks with the reason (`onError`). */
  placeBuyOrder: (good: string, qty: number, price: number, onError?: (reason?: string) => void) => void;
  /** Place a resting limit sell order (escrows goods, charges the listing
   * fee); acks with fresh snapshots or nacks (`onError`). */
  placeSellOrder: (good: string, qty: number, price: number, onError?: (reason?: string) => void) => void;
  /** Buy directly off the sell book up to `qty` at a per-unit `maxPrice`
   * ceiling; acks with fresh snapshots or nacks (`onError`). */
  buyDirect: (good: string, qty: number, maxPrice: number, onError?: (reason?: string) => void) => void;
  /** Cancel one of the player's resting orders by id (refunds the escrow);
   * acks with fresh snapshots or nacks (`onError`). */
  cancelOrder: (orderId: number, onError?: (reason?: string) => void) => void;
  /** Fetch the rankable-metric catalog (stats + skills + knowledge; answered by
   * `rankingMetrics`). Fixed for a build — the picker filters it client-side. */
  listRankingMetrics: () => void;
  /** Request one descending page of a rankings board (answered by
   * `rankingsPage` into the `world.rankings.boards` wall-clock cache). A cache
   * hit for the current window is served without a request. */
  viewRankings: (metric: string, page: number) => void;
  /** Locate a player on a board by username (answered by `rankingPlayerAt`
   * into `world.rankings.playerAt`). */
  findRankingPlayer: (metric: string, username: string) => void;
  /** The current 15-minute wall-clock rankings bucket (rankings.md), advancing
   * at each boundary. Depend on it to refresh a board when the server rebuilds;
   * `world.rankings.boards` is the cache for the active bucket. */
  rankingsBucket: () => number;
  /** Dismiss the reward view. */
  clearRewards: () => void;
  /** Append a local (client-only) line to the action log. */
  logLocal: (text: string) => void;
  // --- Active combat (combat.md "Active combat") ---
  /** Request the players present in the current zone (answered by
   * `zonePlayers`). */
  listZonePlayers: () => void;
  /** Request the open active-combat lobbies in the current zone (answered by
   * `combatList`). */
  listZoneCombat: () => void;
  /** Request the bosses that can be roused in the current zone — the available
   * active-combat actions (answered by `zoneBosses`). */
  listZoneBosses: () => void;
  /** Rouse a boss in the current zone, paying its entry cost and becoming host;
   * acks with a `combatState` or nacks with the reason (`onError`). */
  openCombat: (boss: string, onError?: (reason?: string) => void) => void;
  /** Join an open lobby by instance id; acks with a `combatState` or nacks. */
  joinCombat: (instance: number, onError?: (reason?: string) => void) => void;
  /** Take the formation's Attack turn (rate-limited 1s server-side); a too-fast
   * input nacks via `onError`. */
  combatAttack: (instance: number, onError?: (reason?: string) => void) => void;
  /** Withdraw from a fight (forfeits loot). */
  leaveCombat: (instance: number, onError?: (reason?: string) => void) => void;
};

const GameContext = createContext<Game>();

export function GameProvider(props: ParentProps) {
  const [chat, setChat] = createStore<ChatState>({
    rooms: [...BUILTIN_ROOMS],
    activeRoom: "main",
    byRoom: Object.fromEntries([...BUILTIN_ROOMS, DM_BUCKET].map((r) => [r, []])),
    history: {},
  });

  const [world, setWorld] = createStore<WorldState>({
    zone: "0,0,0",
    action: null,
    enemies: {},
    destinations: {},
    map: null,
    market: null,
    rankings: { metrics: [], bucket: rankingsBucketOf(Date.now()), boards: {}, playerAt: null },
    inventory: null,
    roster: null,
    formation: null,
    effects: [],
    isAdmin: false,
    isModerator: false,
    profile: null,
    modLog: null,
    modReports: null,
    modRoomMessages: null,
    moderators: null,
    lastRewards: null,
    zonePlayers: [],
    zoneCombat: [],
    zoneBosses: [],
    combat: null,
    lastActionKind: null,
    lastCombat: null,
    lastTravel: null,
    log: [],
  });

  const [status, setStatus] = createSignal<GameStatus>("offline");
  const online = () => status() === "connected";

  // The current 15-minute wall-clock rankings bucket, advanced by a timer at
  // each boundary so a view sitting on a board re-fetches when the server
  // rebuilds (rankings.md "Freshness"). Reactive — the Rankings page depends on
  // it to trigger the refresh.
  const [rankingsBucket, setRankingsBucket] = createSignal(rankingsBucketOf(Date.now()));
  onMount(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = Date.now();
      const nextBoundary = (rankingsBucketOf(now) + 1) * RANKINGS_BUCKET_MS;
      // A small cushion past the boundary so the server's rebuild has landed
      // before the client re-requests.
      timer = setTimeout(() => {
        setRankingsBucket(rankingsBucketOf(Date.now()));
        schedule();
      }, nextBoundary - now + 2000);
    };
    schedule();
    onCleanup(() => clearTimeout(timer));
  });

  let nextId = 1;
  let nonce = 1;
  let conn: Connection | null = null;

  const pushLog = (text: string, kind: ActionLogEntry["kind"]) =>
    setWorld("log", (ls) => [...ls.slice(-199), { id: nextId++, text, kind }]);

  // Mutating requests in flight, keyed by the nonce the server echoes on its
  // Ack/Nack. The client takes action (remove a tab, surface an error in the
  // right room) only when the response arrives — not optimistically. Entries
  // are dropped on disconnect: they can never resolve across a reconnect, and
  // the server's connect-time chatState push re-baselines everything anyway.
  // `onAck` receives the ack's optional result line (chat commands answer
  // with e.g. "troll banned for 3600s").
  type Pending = { onAck?: (msg?: string) => void; onNack?: (reason?: string) => void; };
  const pending = new Map<number, Pending>();

  const ensureRoom = (room: string) => {
    if (!chat.byRoom[room]) setChat("byRoom", room, []);
    if (room !== DM_BUCKET && !chat.rooms.includes(room)) {
      setChat("rooms", (rs) => [...rs, room]);
    }
  };

  const push = (room: string, entry: Omit<ChatEntry, "id">) => {
    ensureRoom(room);
    setChat("byRoom", room, (es) => [...es, { ...entry, id: nextId++ }]);
  };

  const send = (data: ClientData, p?: Pending): boolean => {
    if (!conn) return false;
    const n = nonce++;
    const ok = conn.send({ nonce: n, data });
    if (ok && p) pending.set(n, p);
    return ok;
  };

  // Read-request throttle. Informational (non-mutating) requests are answered
  // by authoritative pushes the stores already hold, so re-sending an
  // identical one moments later can't change what renders — it only burns the
  // connection's inbound rate budget (the server drops frames, chat included,
  // past WS_INBOUND_RATE_LIMIT_MAX). Rapid sidebar switching (Overview ↔ Area
  // ↔ Market ↔ …) re-fires the same mount-time reads; within the window the
  // already-held answer stands in. Keys carry whatever makes the answer
  // differ (the zone, the good, the page), so e.g. arriving in a new zone
  // always sends. `holds` covers single-slot stores that keep only the LATEST
  // answer (the market book, the gear page): when the slot has since been
  // overwritten by a different answer, the cached one is gone and the request
  // must go out regardless of the window. Mutations never come through here.
  const READ_TTL_MS = 10_000;
  const recentReads = new Map<string, number>();
  const sendRead = (key: string, data: ClientData, holds: () => boolean = () => true) => {
    const now = Date.now();
    const last = recentReads.get(key);
    if (last != null && now - last < READ_TTL_MS && holds()) return;
    for (const [k, t] of recentReads) if (now - t >= READ_TTL_MS) recentReads.delete(k);
    if (send(data)) recentReads.set(key, now);
  };

  /* ---- chat history (chat.md "Message history") ---- */

  /** Merge a history page into a room's transcript, de-duplicating against
   * messages already present (live deliveries can race the history fetch) and
   * keeping the room in message-id order — ids are monotonic with send order,
   * so sorting by id is chronological; id-less entries (local echoes, system
   * notices) sort to the newest end. Records the room as loaded and whether
   * older messages remain. */
  const mergeRoomHistory = (room: string, msgs: ChatHistoryMessage[], hasMore: boolean) => {
    ensureRoom(room);
    setChat("byRoom", room, (existing) => {
      const seen = new Set(existing.filter((e) => e.messageId != null).map((e) => e.messageId));
      const additions: ChatEntry[] = msgs
        .filter((m) => !seen.has(m.messageId))
        .map((m) => ({
          id: nextId++,
          room,
          from: m.from,
          body: m.body,
          at: m.sentAt,
          kind: "room" as const,
          messageId: m.messageId,
        }));
      if (additions.length === 0) return existing;
      return [...additions, ...existing].sort((a, b) => {
        if (a.messageId == null && b.messageId == null) return 0;
        if (a.messageId == null) return 1;
        if (b.messageId == null) return -1;
        return a.messageId - b.messageId;
      });
    });
    setChat("history", room, { hasMore });
  };

  /** The smallest message id currently loaded in a room — the cursor for
   * paging further back. Null when the room holds no server messages yet. */
  const oldestRoomMessageId = (room: string): number | null => {
    let min: number | null = null;
    for (const e of chat.byRoom[room] ?? []) {
      if (e.messageId != null && (min == null || e.messageId < min)) min = e.messageId;
    }
    return min;
  };

  /** Request a room's history. `before` (a message id) pages further back; its
   * absence fetches the latest page. The initial fetch is throttled and yields
   * once the room is loaded (a reconnect clears the throttle, so it re-fetches
   * the active room); a load-older request is user-initiated and always sent.
   * The DM bucket has no room history. */
  const requestRoomHistory = (room: string, before?: number) => {
    if (!online() || room === DM_BUCKET) return;
    if (before != null) {
      send({ t: "chat", ct: "roomHistory", room, before });
      return;
    }
    untrack(() =>
      sendRead(`roomHistory:${room}`, { t: "chat", ct: "roomHistory", room }, () => !!chat.history[room]),
    );
  };

  /* ---- inbound handling ---- */
  const onMessage = (msg: ServerMessage) => {
    switch (msg.t) {
      case "chatState": {
        // Authoritative baseline pushed on every (re)connect (and on resync):
        // the rooms this connection is subscribed to. Built-ins are
        // auto-subscribed server-side; player rooms appear when we're a member.
        // Replace the room list rather than merging into it.
        const names = msg.rooms.map((r) => r.name);
        for (const name of names) if (!chat.byRoom[name]) setChat("byRoom", name, []);
        setChat("rooms", names);
        if (chat.activeRoom !== DM_BUCKET && !names.includes(chat.activeRoom)) {
          setChat("activeRoom", names.includes("main") ? "main" : (names[0] ?? "main"));
        }
        // Prepopulate the room the player is currently viewing with its recent
        // history (chat.md "Message history"); other rooms load when opened.
        // The throttle was cleared on disconnect, so this re-fetches on every
        // (re)connect even if the room was loaded in a prior session.
        if (chat.activeRoom !== DM_BUCKET) requestRoomHistory(chat.activeRoom);
        break;
      }
      case "chatRoomMsg":
        push(msg.room, {
          room: msg.room,
          from: msg.from,
          body: msg.body,
          at: msg.sentAt,
          kind: "room",
          messageId: msg.messageId,
        });
        break;
      case "chatDm":
        push(DM_BUCKET, {
          from: msg.from,
          body: msg.body,
          at: msg.sentAt,
          kind: "dm",
          messageId: msg.messageId,
        });
        break;
      case "chatSystem":
        push(msg.room, { room: msg.room, from: "System", body: msg.body, kind: "system" });
        break;
      case "chatRevoke": {
        // A moderator revoked a room message (chat.md "Enforcement"): drop it
        // from every rendered transcript. DM entries keep their ids in a
        // separate log, so only room entries match.
        for (const room of Object.keys(chat.byRoom)) {
          if (chat.byRoom[room].some((e) => e.kind === "room" && e.messageId === msg.messageId)) {
            setChat("byRoom", room, (es) =>
              es.filter((e) => !(e.kind === "room" && e.messageId === msg.messageId)),
            );
          }
        }
        // The moderation room-message browser keeps revoked messages visible
        // (flagged), so flip the flag in place rather than dropping the row —
        // this reflects a revoke issued from the browser itself with no refetch.
        if (world.modRoomMessages?.messages.some((m) => m.messageId === msg.messageId)) {
          setWorld(
            "modRoomMessages",
            "messages",
            (m) => m.messageId === msg.messageId,
            "revoked",
            true,
          );
        }
        break;
      }
      case "chatProfile":
        setWorld("profile", {
          username: msg.username ?? null,
          online: msg.online,
          accountId: msg.accountId ?? null,
        });
        break;
      case "chatRoomHistory":
        // Recent backlog for a room (chat.md "Message history"): merge it into
        // the transcript, de-duped and ordered.
        mergeRoomHistory(msg.room, msg.messages, msg.hasMore);
        break;
      case "modRoomMessagesPage":
        setWorld("modRoomMessages", {
          room: msg.room,
          page: msg.page,
          hasMore: msg.hasMore,
          messages: msg.messages,
        });
        break;
      case "modLogPage":
        setWorld("modLog", { page: msg.page, hasMore: msg.hasMore, entries: msg.entries });
        break;
      case "modReportsPage":
        setWorld("modReports", { page: msg.page, hasMore: msg.hasMore, reports: msg.reports });
        break;
      case "moderators":
        setWorld("moderators", msg.usernames);
        break;
      case "gameState": {
        // The game half of the state push: replace, don't merge.
        setWorld("zone", msg.zone);
        setWorld("action", msg.action ?? null);
        if (msg.action) {
          // A fresh start also pushes this baseline; only call it a resume
          // when the action already has progress.
          const verb = msg.action.kcDone > 0 ? "Resumed" : "Started";
          if (msg.action.kind === "travel") {
            pushLog(`${verb}: travel to ${actionTarget(msg.action)}.`, "info");
          } else {
            pushLog(
              `${verb}: ${msg.action.kind} vs ${actionTarget(msg.action)} ` +
              `(KC ${msg.action.kcDone}/${msg.action.kcTarget}).`,
              "info",
            );
          }
        }
        break;
      }
      case "enemyList":
        setWorld("enemies", msg.zone, msg.enemies);
        break;
      case "destinationList":
        setWorld("destinations", msg.from, msg.destinations);
        break;
      case "mapView":
        // Authoritative snapshot: replace the whole map.
        setWorld("map", { current: msg.current, zones: msg.zones });
        break;
      // --- Active combat (combat.md "Active combat") ---
      case "zonePlayers":
        setWorld("zonePlayers", msg.players);
        break;
      case "combatList":
        setWorld("zoneCombat", msg.instances);
        break;
      case "zoneBosses":
        setWorld("zoneBosses", msg.bosses);
        break;
      case "combatState":
        // Authoritative instance snapshot (replace) — the tag carries the same
        // fields as the stored `CombatState`.
        setWorld("combat", {
          instance: msg.instance,
          boss: msg.boss,
          host: msg.host ?? null,
          participants: msg.participants,
          youAreHost: msg.youAreHost,
          yourFormationHp: msg.yourFormationHp,
          yourFormationMaxHp: msg.yourFormationMaxHp,
          yourContribution: msg.yourContribution,
          youDowned: msg.youDowned,
        });
        break;
      case "combatEvent":
        pushLog(msg.line, "combat");
        break;
      case "combatClosed": {
        const verb =
          msg.outcome === "defeated"
            ? "The boss is defeated"
            : msg.outcome === "wiped"
              ? "Your party was wiped"
              : "You withdrew from the fight";
        pushLog(`${verb}.`, msg.outcome === "wiped" ? "failure" : "reward");
        // Only clear if this close is for the fight we're tracking.
        if (world.combat?.instance === msg.instance) setWorld("combat", null);
        break;
      }
      case "inventory":
        // Authoritative snapshot: replace, never merge or accumulate.
        setWorld("inventory", {
          currencies: msg.currencies,
          general: msg.general,
          items: msg.items,
          gear: msg.gear,
          gearPage: msg.gearPage,
          gearPages: msg.gearPages,
          gearTotal: msg.gearTotal,
        });
        break;
      case "roster":
        // Authoritative snapshot: replace.
        setWorld("roster", msg.units);
        break;
      case "formation":
        // Authoritative snapshot: replace the layout.
        setWorld("formation", msg.slots);
        break;
      case "adminStatus":
        // Connect-time admin/moderator designation (server-status.md /
        // chat.md "Moderator designation"). UI hints only.
        setWorld("isAdmin", msg.isAdmin);
        setWorld("isModerator", msg.isModerator);
        break;
      case "marketGoods":
        // The goods catalog — fixed for a build. Seed/replace the market slice,
        // preserving any already-loaded book / order list.
        setWorld("market", (m) => ({
          goods: msg.goods,
          book: m?.book ?? null,
          myOrders: m?.myOrders ?? [],
        }));
        break;
      case "marketBook":
        // Authoritative book for one good: replace it wholesale.
        setWorld("market", (m) => ({
          goods: m?.goods ?? [],
          book: { good: msg.good, bids: msg.bids, asks: msg.asks, yours: msg.yours },
          myOrders: m?.myOrders ?? [],
        }));
        break;
      case "marketOrders":
        // Authoritative order list: replace.
        setWorld("market", (m) => ({
          goods: m?.goods ?? [],
          book: m?.book ?? null,
          myOrders: msg.orders,
        }));
        break;
      case "rankingMetrics":
        // The metric catalog (fixed for a build): the picker filters it locally.
        setWorld("rankings", "metrics", msg.metrics);
        break;
      case "rankingsPage":
        // Cache the board page for this wall-clock window, keyed by metric+page
        // (the server's rebuild cadence makes it valid until the bucket rolls).
        setWorld("rankings", "boards", `${msg.metric}:${msg.page}`, {
          metric: msg.metric,
          metricName: msg.metricName,
          page: msg.page,
          total: msg.total,
          hasMore: msg.hasMore,
          rows: msg.rows,
        });
        break;
      case "rankingPlayerAt":
        setWorld("rankings", "playerAt", {
          metric: msg.metric,
          username: msg.username,
          found: msg.found,
          rank: msg.rank ?? null,
          page: msg.page ?? null,
          value: msg.value ?? null,
        });
        break;
      case "effects":
        // Authoritative snapshot: replace the active-effect set.
        setWorld("effects", msg.effects);
        break;
      case "actionTick": {
        const act = world.action;
        if (act) {
          // Fold the delta over the baseline; absent fields are unchanged.
          const patch: Partial<ActionView> = { phase: msg.phase };
          // Travel learns its engine-computed KC at Preparation; combat's was
          // already known but re-sending is harmless.
          if (msg.kcTarget != null) patch.kcTarget = msg.kcTarget;
          if (msg.kcDone != null) patch.kcDone = msg.kcDone;
          if (msg.formationHp != null) patch.formationHp = msg.formationHp;
          if (msg.formationMaxHp != null) patch.formationMaxHp = msg.formationMaxHp;
          if (msg.formationStats) patch.formationStats = msg.formationStats;
          if (msg.modifier) patch.modifier = msg.modifier;
          if (msg.tally) patch.tally = msg.tally;
          setWorld("action", patch);

          // Combat's delta fields fold into the nested combat slice.
          if (act.combat) {
            const combat: Partial<CombatView> = {};
            if (msg.enemyHp != null) combat.enemyHp = msg.enemyHp;
            if (msg.enemyMaxHp != null) combat.enemyMaxHp = msg.enemyMaxHp;
            if (msg.enemyStats) combat.enemyStats = msg.enemyStats;
            if (Object.keys(combat).length > 0) setWorld("action", "combat", combat);
          }
        }
        // Narrate the tick into the action log — travel and combat read very
        // differently, so branch on the kind.
        if (act?.kind === "travel") {
          const dest = act.travel?.destinationName ?? "the next zone";
          switch (msg.phase) {
            case "preparation":
              pushLog(`Course plotted to ${dest} — ${act.kcTarget} ticks out.`, "info");
              break;
            case "execution":
              if (msg.kcDone != null) {
                pushLog(`En route to ${dest}… (${msg.kcDone}/${act.kcTarget})`, "info");
              }
              break;
            default:
              break;
          }
        } else {
          const name = act?.combat?.enemyName ?? "the enemy";
          switch (msg.phase) {
            case "preparation":
              pushLog(`Preparation complete — engaging ${name}.`, "info");
              break;
            case "execution":
              for (const a of msg.attacks ?? []) {
                if (a.actor === "formation") {
                  pushLog(`You hit ${name} for ${a.damage}.${a.defeated ? " It falls!" : ""}`, "combat");
                } else {
                  pushLog(
                    `${name} hits you for ${a.damage}.${a.defeated ? " Your formation is wiped!" : ""}`,
                    a.defeated ? "failure" : "combat",
                  );
                }
              }
              if (msg.kcDone != null && act) {
                pushLog(`Kill ${msg.kcDone}/${act.kcTarget}.`, "info");
              }
              break;
            case "downtime":
              pushLog("Downtime — the formation reels. (burns 1 KC)", "failure");
              break;
            case "regroup":
              pushLog("Regroup — formation health restored; resuming. (burns 1 KC)", "info");
              break;
            case "resolution":
              break;
          }
        }
        break;
      }
      case "actionRewards": {
        setWorld("action", null);
        setWorld("lastRewards", {
          kind: msg.kind,
          targetName: msg.targetName,
          kcTarget: msg.kcTarget,
          kcDone: msg.kcDone,
          stopped: msg.stopped,
          rewards: msg.rewards,
        });
        if (msg.kind === "travel") {
          // Travel's only loot is arrival (or, when stopped, no movement at
          // all), but it banks use-based XP and zone Knowledge along the way
          // (progression.md / knowledge.md).
          const xp = totalXp(msg.rewards);
          const kn = totalKnowledge(msg.rewards);
          const arrival = msg.stopped
            ? `Abandoned the journey to ${msg.targetName}.`
            : `Arrived at ${msg.targetName}.`;
          const bits: string[] = [];
          if (xp > 0) bits.push(`+${xp} xp`);
          if (kn > 0) bits.push(`+${kn} ${msg.targetName} knowledge`);
          pushLog(bits.length ? `${arrival} (${bits.join(", ")})` : arrival, "reward");
        } else {
          pushLog(
            `${msg.stopped ? "Stopped" : "Finished"} ${msg.kind} vs ${msg.targetName}: ` +
            `${summarizeRewards(msg.rewards)}.`,
            "reward",
          );
        }
        // Any kind can level a stat or skill; call those out (progression.md).
        for (const up of levelUps(msg.rewards)) {
          pushLog(`Level up — ${up}.`, "reward");
        }
        break;
      }
      case "nack": {
        const p = msg.nonce != null ? pending.get(msg.nonce) : undefined;
        if (p) {
          pending.delete(msg.nonce!);
          if (p.onNack) {
            p.onNack(msg.msg ?? undefined);
            break;
          }
        }
        // Uncorrelated (or handler-less) nack: surface it where the user is.
        if (msg.msg) push(chat.activeRoom, { from: "System", body: `✗ ${msg.msg}`, kind: "system" });
        break;
      }
      case "ack": {
        const p = msg.nonce != null ? pending.get(msg.nonce) : undefined;
        if (p) {
          pending.delete(msg.nonce!);
          p.onAck?.(msg.msg ?? undefined);
        }
        break;
      }
    }
  };

  /* ---- public methods ---- */
  const sendRoom = (room: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const rejected = (reason?: string) =>
      push(room, { from: "System", body: `✗ ${reason ?? "message rejected"}`, kind: "system" });
    if (online() && send({ t: "chat", ct: "sendRoom", room, body: trimmed }, { onNack: rejected })) {
      // The server echoes the message back to the room (we're a member), so we
      // don't optimistically insert — avoids duplicates. A rejection surfaces
      // in the room it was sent to, not wherever the user has clicked since.
      return;
    }
    // Offline / not connected: echo locally so the box is demonstrable.
    push(room, { room, from: "you", body: trimmed, kind: "local" });
  };

  const sendDm = (to: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const rejected = (reason?: string) =>
      push(DM_BUCKET, { from: "System", body: `✗ ${reason ?? "message rejected"}`, kind: "system" });
    if (online() && send({ t: "chat", ct: "sendDm", to, body: trimmed }, { onNack: rejected })) return;
    push(DM_BUCKET, { from: `you → ${to}`, body: trimmed, kind: "local" });
  };

  const joinRoom = (room: string, password?: string) => {
    // Built-in rooms are auto-subscribed by the server and are not joined by
    // hand; only player-created rooms are. (The server would reject a built-in
    // join anyway.)
    if (isBuiltin(room)) return;
    if (!online()) {
      // Offline mode: rooms are purely local, so "joining" is just a tab.
      ensureRoom(room);
      return;
    }
    // The tab appears only once the server confirms the join.
    send(
      { t: "chat", ct: "joinRoom", room, password: password ?? null },
      {
        onAck: () => ensureRoom(room),
        onNack: (reason) =>
          push(chat.activeRoom, { from: "System", body: `✗ ${reason ?? `could not join ${room}`}`, kind: "system" }),
      },
    );
  };

  const leaveRoom = (room: string) => {
    // Built-in rooms cannot be left; hiding one would be a local-only choice.
    if (isBuiltin(room)) return;
    const remove = () => {
      setChat("rooms", (rs) => rs.filter((r) => r !== room));
      if (chat.activeRoom === room) setChat("activeRoom", "main");
    };
    if (!online()) {
      remove();
      return;
    }
    // The server can refuse a leave (e.g. Muted/Banned members cannot leave),
    // so the tab is removed only on its Ack — not optimistically.
    send(
      { t: "chat", ct: "leaveRoom", room },
      {
        onAck: remove,
        onNack: (reason) =>
          push(room, { from: "System", body: `✗ ${reason ?? "could not leave the room"}`, kind: "system" }),
      },
    );
  };

  const sendChatCommand = (room: string | null, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    // Result lines land where the command was typed (the DM view shows them
    // in the DM bucket).
    const surface = room ?? DM_BUCKET;
    if (!online()) {
      push(surface, { from: "System", body: "✗ commands need a server connection", kind: "system" });
      return;
    }
    const isLogout = /^\/logout\b/i.test(trimmed);
    send(
      { t: "chat", ct: "command", room, body: trimmed },
      {
        onAck: (msg) => {
          if (msg) push(surface, { from: "System", body: `✓ ${msg}`, kind: "system" });
          // The server has already invalidated every session and severed the
          // connection; flip the client back to the auth gate too.
          if (isLogout) clearAuth();
        },
        onNack: (reason) =>
          push(surface, { from: "System", body: `✗ ${reason ?? "command failed"}`, kind: "system" }),
      },
    );
  };

  const chatNotice = (room: string | null, body: string) => {
    push(room ?? DM_BUCKET, { from: "System", body, kind: "system" });
  };

  /** The shared shape of the fire-and-ack moderation/admin ops: a friendly
   * offline error when disconnected, otherwise send with the handlers wired
   * to the ack/nack. `offlineMsg` is the full offline reason. */
  const sendOp = (
    data: ClientData,
    offlineMsg: string,
    handlers?: { onSuccess?: (msg?: string) => void; onError?: (reason?: string) => void; },
  ) => {
    if (!online()) {
      handlers?.onError?.(offlineMsg);
      return;
    }
    send(data, { onAck: (msg) => handlers?.onSuccess?.(msg), onNack: handlers?.onError });
  };

  const reportMessage = (
    messageId: number,
    reason: string,
    dm: boolean,
    handlers?: { onSuccess?: () => void; onError?: (reason?: string) => void; },
  ) =>
    sendOp(
      { t: "chat", ct: "report", messageId, reason, dm },
      "offline — reporting needs a server connection",
      handlers,
    );

  // The server broadcasts the `chatRevoke`, which is what removes the entry
  // locally too — nothing is removed optimistically.
  const revokeMessage = (
    messageId: number,
    handlers?: { onSuccess?: () => void; onError?: (reason?: string) => void; },
  ) =>
    sendOp(
      { t: "chat", ct: "revokeMessage", messageId },
      "offline — moderation needs a server connection",
      handlers,
    );

  const requestProfile = (username: string | null, onError?: (reason?: string) => void) => {
    // Clear the previous answer so the page shows a fresh lookup, not a stale
    // player.
    setWorld("profile", null);
    sendOp({ t: "chat", ct: "profile", username }, "offline — profiles need a server connection", {
      onError,
    });
  };

  const requestModLog = (page: number) => {
    if (!online()) return;
    // A read with a single-page slot, like the gear page: throttled, yielding
    // when a different page has since landed.
    const p = Math.max(0, Math.floor(page));
    untrack(() =>
      sendRead(`modLog:${p}`, { t: "chat", ct: "modLog", page: p }, () => world.modLog?.page === p),
    );
  };

  const requestModReports = (page: number) => {
    if (!online()) return;
    const p = Math.max(0, Math.floor(page));
    untrack(() =>
      sendRead(`modReports:${p}`, { t: "chat", ct: "modReports", page: p }, () => world.modReports?.page === p),
    );
  };

  const resolveReport = (
    reportId: number,
    handlers?: { onSuccess?: () => void; onError?: (reason?: string) => void; },
  ) =>
    sendOp(
      { t: "chat", ct: "resolveReport", reportId },
      "offline — moderation needs a server connection",
      handlers,
    );

  // Sudoers-gated server-side like setMotd; only surfaced to world.isAdmin.
  const setModerator = (
    username: string,
    moderator: boolean,
    handlers?: { onSuccess?: (msg?: string) => void; onError?: (reason?: string) => void; },
  ) =>
    sendOp(
      { t: "adminCmd", tt: "setModerator", username, moderator },
      "offline — admin commands need a server connection",
      handlers,
    );

  const listModerators = () => {
    if (!online()) return;
    untrack(() =>
      sendRead("listModerators", { t: "adminCmd", tt: "listModerators" }, () => world.moderators != null),
    );
  };

  // Sudoers-gated server-side like setMotd; only surfaced to world.isAdmin.
  // The server acks once the reload is queued (it runs at the next tick
  // boundary, fire-and-forget).
  const reloadContent = (handlers?: {
    onSuccess?: (msg?: string) => void;
    onError?: (reason?: string) => void;
  }) =>
    sendOp(
      { t: "adminCmd", tt: "reloadContent" },
      "offline — admin commands need a server connection",
      handlers,
    );

  // Sudoers-gated server-side like setMotd; only surfaced to world.isAdmin.
  // The server acks once the rebuild is queued (the manager re-resolves the
  // eligible set and recomputes the board off-cadence, fire-and-forget).
  const rebuildRankings = (handlers?: {
    onSuccess?: (msg?: string) => void;
    onError?: (reason?: string) => void;
  }) =>
    sendOp(
      { t: "adminCmd", tt: "rebuildRankings" },
      "offline — admin commands need a server connection",
      handlers,
    );

  /** Ask the server for a full state refresh (top-level control message,
   * rate-limited per connection). The server fans it to both subsystems: chat
   * re-pushes `chatState`, the game re-pushes `gameState` + `inventory` +
   * `roster` + `formation` + `effects`. */
  const resync = () => {
    if (online()) send({ t: "requestState" });
  };

  const setActiveRoom = (room: string) => {
    setChat("activeRoom", room);
    // Opening a room loads its backlog the first time (chat.md "Message
    // history"); the throttle makes a repeat open a no-op once loaded.
    if (room !== DM_BUCKET) requestRoomHistory(room);
  };

  /** Page further back through a room's history (chat.md "Message history"),
   * using the oldest loaded message as the cursor. A no-op when there's nothing
   * older or the room holds no server messages yet. */
  const loadOlderHistory = (room: string) => {
    const before = oldestRoomMessageId(room);
    if (before != null) requestRoomHistory(room, before);
  };

  /** Whether a room has older history to page back to (chat.md "Message
   * history") — drives the "load older" affordance. */
  const historyHasMore = (room: string): boolean => !!chat.history[room]?.hasMore;

  /** Browse a page of any room's full message history (staff only; chat.md
   * "Logging" — the moderation view). Answered into `world.modRoomMessages`. */
  const requestModRoomMessages = (room: string, page: number) => {
    if (!online() || !room) return;
    const p = Math.max(0, Math.floor(page));
    untrack(() =>
      sendRead(
        `modRoomMessages:${room}:${p}`,
        { t: "chat", ct: "modRoomMessages", room, page: p },
        () => world.modRoomMessages?.room === room && world.modRoomMessages?.page === p,
      ),
    );
  };

  /* ---- game / idle-action methods ---- */

  // The reads below go through the sendRead throttle, with their store reads
  // untracked so calling one inside an effect adds no dependencies the caller
  // didn't opt into.

  const listEnemies = () => {
    if (!online()) return;
    untrack(() =>
      sendRead(`listEnemies:${world.zone}`, { t: "game", gt: "listEnemies" }, () => !!world.enemies[world.zone]),
    );
  };

  const listDestinations = () => {
    if (!online()) return;
    untrack(() =>
      sendRead(
        `listDestinations:${world.zone}`,
        { t: "game", gt: "listDestinations" },
        () => !!world.destinations[world.zone],
      ),
    );
  };

  const listMap = () => {
    if (!online()) return;
    untrack(() =>
      sendRead(`listMap:${world.zone}`, { t: "game", gt: "listMap" }, () => world.map?.current === world.zone),
    );
  };

  const startCombat = (enemyId: string, kc: number) => {
    if (!online()) {
      pushLog("Offline — actions need a server connection.", "local");
      return;
    }
    setWorld("lastCombat", { enemy: enemyId, kc });
    setWorld("lastRewards", null);
    // The server acks and pushes the fresh gameState baseline (and, when an
    // action was already in flight, the old action's stopped rewards first).
    send(
      { t: "game", gt: "changeAction", kind: "combat", enemy: enemyId, kc },
      { onNack: (reason) => pushLog(`✗ ${reason ?? "could not start the action"}`, "failure") },
    );
  };

  const startTravel = (direction: Direction) => {
    if (!online()) {
      pushLog("Offline — actions need a server connection.", "local");
      return;
    }
    setWorld("lastTravel", { direction });
    setWorld("lastRewards", null);
    // Like combat, the server acks and pushes the fresh gameState baseline (and
    // any stopped rewards if an action was already in flight). The journey is
    // priced server-side at the next Preparation tick.
    send(
      { t: "game", gt: "changeAction", kind: "travel", direction },
      { onNack: (reason) => pushLog(`✗ ${reason ?? "could not start traveling"}`, "failure") },
    );
  };

  const stopAction = () => {
    if (!online()) return;
    send(
      { t: "game", gt: "stopAction" },
      { onNack: (reason) => pushLog(`✗ ${reason ?? "could not stop the action"}`, "failure") },
    );
  };

  /* ---- active combat (combat.md "Active combat") ---- */

  const listZonePlayers = () => {
    if (!online()) return;
    untrack(() =>
      sendRead(`listZonePlayers:${world.zone}`, { t: "game", gt: "listZonePlayers" }),
    );
  };

  const listZoneCombat = () => {
    if (!online()) return;
    untrack(() => sendRead(`listZoneCombat:${world.zone}`, { t: "game", gt: "listZoneCombat" }));
  };

  const listZoneBosses = () => {
    if (!online()) return;
    untrack(() =>
      sendRead(
        `listZoneBosses:${world.zone}`,
        { t: "game", gt: "listZoneBosses" },
        () => world.zoneBosses.length > 0,
      ),
    );
  };

  const openCombat = (boss: string, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — combat needs a server connection");
      return;
    }
    // The ack rides with the post-charge inventory + the instance state.
    send({ t: "game", gt: "openCombat", boss }, { onNack: onError });
  };

  const joinCombat = (instance: number, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — combat needs a server connection");
      return;
    }
    send({ t: "game", gt: "joinCombat", instance }, { onNack: onError });
  };

  const combatAttack = (instance: number, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — combat needs a server connection");
      return;
    }
    // Rate-limited server-side (1s); a too-fast input nacks.
    send({ t: "game", gt: "combatAttack", instance }, { onNack: onError });
  };

  const leaveCombat = (instance: number, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — combat needs a server connection");
      return;
    }
    send({ t: "game", gt: "leaveCombat", instance }, { onNack: onError });
  };

  const equipGear = (unit: string, instanceId: number, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — gear needs a server connection");
      return;
    }
    // The ack rides with fresh inventory + roster snapshots; nothing is
    // applied optimistically.
    send({ t: "game", gt: "equipGear", unit, instanceId }, { onNack: onError });
  };

  const unequipGear = (unit: string, instanceId: number, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — gear needs a server connection");
      return;
    }
    send({ t: "game", gt: "unequipGear", unit, instanceId }, { onNack: onError });
  };

  const requestGearPage = (page: number) => {
    if (!online()) return;
    // The server clamps and answers with a fresh inventory push; like
    // listEnemies this is a read, so there is no ack to correlate. The
    // snapshot carries only one page, so the throttle yields whenever a
    // different page has since landed.
    const p = Math.max(0, Math.floor(page));
    untrack(() =>
      sendRead(`gearPage:${p}`, { t: "game", gt: "gearPage", page: p }, () => world.inventory?.gearPage === p),
    );
  };

  const useConsumable = (item: string, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — consumables need a server connection");
      return;
    }
    // Formation scope is the only one the server implements today; the ack
    // rides with fresh inventory + effects snapshots (nothing optimistic).
    send({ t: "game", gt: "useConsumable", item, target: "formation" }, { onNack: onError });
  };

  const setFormation = (slots: FormationSlotView[], onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — formation editing needs a server connection");
      return;
    }
    // The whole layout, validated atomically server-side; the ack rides with
    // the fresh formation snapshot (nothing optimistic).
    send({ t: "game", gt: "setFormation", slots }, { onNack: onError });
  };

  const setMotd = (
    body: string,
    handlers?: { onSuccess?: () => void; onError?: (reason?: string) => void; },
  ) => {
    if (!online()) {
      handlers?.onError?.("offline — admin commands need a server connection");
      return;
    }
    // Gated server-side against the sudoers designation; acks on success, nacks
    // on a server error. A non-admin sender is disconnected (the UI only shows
    // this to admins, so that path is for forged frames).
    send(
      { t: "adminCmd", tt: "setMotd", body },
      { onAck: handlers?.onSuccess, onNack: handlers?.onError },
    );
  };

  const listMarketGoods = () => {
    if (!online()) return;
    // The catalog is fixed for a build, so the held answer never goes stale.
    untrack(() =>
      sendRead("listMarketGoods", { t: "game", gt: "listMarketGoods" }, () => !!world.market?.goods.length),
    );
  };

  const viewMarket = (good: string) => {
    if (!online()) return;
    // The book slot holds one good at a time; selecting A → B → A back within
    // the window must re-request (B overwrote A's book).
    untrack(() =>
      sendRead(`viewMarket:${good}`, { t: "game", gt: "viewMarket", good }, () => world.market?.book?.good === good),
    );
  };

  const listMyOrders = () => {
    if (!online()) return;
    // No parameters, so the held order list can't be overwritten by a
    // different answer — and every market mutation acks with a fresh one.
    untrack(() => sendRead("listMyOrders", { t: "game", gt: "listMyOrders" }));
  };

  const placeBuyOrder = (good: string, qty: number, price: number, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — the market needs a server connection");
      return;
    }
    // The ack rides with fresh inventory + book + orders snapshots; nothing is
    // applied optimistically.
    send({ t: "game", gt: "placeBuyOrder", good, qty, price }, { onNack: onError });
  };

  const placeSellOrder = (good: string, qty: number, price: number, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — the market needs a server connection");
      return;
    }
    send({ t: "game", gt: "placeSellOrder", good, qty, price }, { onNack: onError });
  };

  const buyDirect = (good: string, qty: number, maxPrice: number, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — the market needs a server connection");
      return;
    }
    send({ t: "game", gt: "buyDirect", good, qty, maxPrice }, { onNack: onError });
  };

  const cancelOrder = (orderId: number, onError?: (reason?: string) => void) => {
    if (!online()) {
      onError?.("offline — the market needs a server connection");
      return;
    }
    send({ t: "game", gt: "cancelOrder", orderId }, { onNack: onError });
  };

  /* ---- rankings (rankings.md) ---- */

  // The boards are a 15-minute wall-clock cache, matching the server's rebuild
  // cadence: when the window rolls, drop the cached boards + the player lookup
  // so the next request fetches the freshly rebuilt board. Returns the current
  // bucket so the caller can key its request by window.
  const rollRankingsBucket = (): number => {
    const bucket = rankingsBucketOf(Date.now());
    untrack(() => {
      if (world.rankings.bucket !== bucket) {
        setWorld("rankings", "bucket", bucket);
        setWorld("rankings", "boards", {});
        setWorld("rankings", "playerAt", null);
      }
    });
    return bucket;
  };

  const listRankingMetrics = () => {
    if (!online()) return;
    // The catalog is fixed for a build (like the market goods): fetch it once
    // (the empty-query full set) and let the picker filter it client-side.
    untrack(() =>
      sendRead(
        "rankingMetrics",
        { t: "game", gt: "searchRankingMetrics", query: "" },
        () => world.rankings.metrics.length > 0,
      ),
    );
  };

  const viewRankings = (metric: string, page: number) => {
    if (!online()) return;
    const p = Math.max(0, Math.floor(page));
    const bucket = rollRankingsBucket();
    // Served straight from the cache for the rest of this wall-clock window —
    // re-visiting a (metric, page) already seen this window is instant, no
    // request. Only a cache miss (new page, or a rolled window) hits the wire.
    if (untrack(() => world.rankings.boards[`${metric}:${p}`])) return;
    untrack(() =>
      sendRead(`rankings:${bucket}:${metric}:${p}`, { t: "game", gt: "viewRankings", metric, page: p }),
    );
  };

  const findRankingPlayer = (metric: string, username: string) => {
    if (!online()) return;
    const u = username.trim();
    if (!u) return;
    const bucket = rollRankingsBucket();
    // The answer slot holds one (metric, username) for the window; the key is
    // bucketed so a new window re-looks-up against the rebuilt board.
    untrack(() =>
      sendRead(
        `findRankingPlayer:${bucket}:${metric}:${u.toLowerCase()}`,
        { t: "game", gt: "findRankingPlayer", metric, username: u },
        () =>
          world.rankings.playerAt?.metric === metric &&
          world.rankings.playerAt?.username.toLowerCase() === u.toLowerCase(),
      ),
    );
  };

  const clearRewards = () => setWorld("lastRewards", null);

  const logLocal = (text: string) => pushLog(text, "local");

  /* ---- lifecycle ---- */

  // The WebSocket API hides the HTTP status of a rejected upgrade, so a dead
  // network and a rejected/expired session token look identical (the socket
  // closes before `open`). Disambiguate by probing the REST surface: any HTTP
  // response — even a 4xx — means the server is reachable, so the repeated
  // websocket rejections are almost certainly the token. Then sign out so the
  // auth gate comes back instead of retrying forever.
  let probing = false;
  const probeAuthFailure = async () => {
    if (probing) return;
    probing = true;
    try {
      await fetch(`${config.apiEndpoint}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      // Network/server unreachable — an outage, not an auth problem. Keep the
      // backoff loop running.
      probing = false;
      return;
    }
    conn?.close();
    setStatus("auth-needed");
    clearAuth(); // flips the App gate back to the login screen
  };

  // Reflect the in-flight action's remaining KC in the document title, so a
  // backgrounded tab shows progress. Derived from world.action, so it covers
  // every transition (tick / start / end / reconnect) in one place.
  createEffect(() => {
    const act = world.action;
    document.title =
      act && act.kcTarget != null
        ? `${act.kcTarget - act.kcDone} left · Grindshell`
        : "Grindshell";
  });

  onMount(() => {
    // A real session token wins, even in uiDev: if the user logged in, connect.
    const token = authToken();
    if (token) {
      conn = new Connection(config.wsEndpoint, token, {
        onStatus: (s) => {
          setStatus(s);
          // In-flight request handlers can't resolve across a reconnect; the
          // connect-time chatState push re-baselines the room state instead.
          // Throttle stamps are dropped too, so the pages' online-tracking
          // effects can refresh request-answered slices the connect-time push
          // doesn't carry (map, destinations, market).
          if (s !== "connected") {
            pending.clear();
            recentReads.clear();
          }
        },
        onMessage,
        onHandshakeFailure: (consecutive) => {
          // Give transient blips a chance; probe on every third failure.
          if (consecutive % 3 === 0) void probeAuthFailure();
        },
      });
      conn.connect();
      return;
    }
    if (config.uiDev) {
      setStatus("offline");
      push("main", { room: "main", from: "System", body: "Offline dev mode — chat is local only.", kind: "system" });
      return;
    }
    // Gated by the App auth screen, so this is a safety fallback only.
    setStatus("auth-needed");
    push("main", { room: "main", from: "System", body: "Not signed in — no chat connection.", kind: "system" });
  });

  onCleanup(() => conn?.close());

  const game: Game = {
    status,
    online,
    chat,
    setActiveRoom,
    sendRoom,
    sendDm,
    joinRoom,
    leaveRoom,
    sendChatCommand,
    chatNotice,
    reportMessage,
    revokeMessage,
    requestProfile,
    requestModLog,
    requestModReports,
    loadOlderHistory,
    historyHasMore,
    requestModRoomMessages,
    resolveReport,
    setModerator,
    listModerators,
    resync,
    dmBucket: DM_BUCKET,
    world,
    listEnemies,
    listDestinations,
    listMap,
    startCombat,
    startTravel,
    stopAction,
    equipGear,
    unequipGear,
    requestGearPage,
    useConsumable,
    setFormation,
    setMotd,
    reloadContent,
    rebuildRankings,
    listMarketGoods,
    viewMarket,
    listMyOrders,
    placeBuyOrder,
    placeSellOrder,
    buyDirect,
    cancelOrder,
    listRankingMetrics,
    viewRankings,
    findRankingPlayer,
    rankingsBucket,
    clearRewards,
    logLocal,
    listZonePlayers,
    listZoneCombat,
    listZoneBosses,
    openCombat,
    joinCombat,
    combatAttack,
    leaveCombat,
  };

  return <GameContext.Provider value={game}>{props.children}</GameContext.Provider>;
}

export function useGame(): Game {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within a GameProvider");
  return ctx;
}
