// Wire protocol for talking to the Grindshell backend.
//
// These types MIRROR the backend's real serde definitions — do not invent
// fields. Sources of truth:
//   - backend/crates/common/src/message/inbound.rs   (client → server)
//   - backend/crates/common/src/message/outbound.rs  (server → client)
//   - backend/crates/server/src/ws.rs                (handshake)
//   - backend/crates/server/src/api.rs               (REST login/register)
//   - backend/crates/common/src/chat.rs              (RoomRole)
//
// The backend routes CHAT variants to the chat handler and GAME variants (plus
// the game's share of `requestState`) to the game engine. Live gameplay
// surfaces today: auth, chat, the idle-combat action lifecycle (enemy
// listings, change/stop action, per-tick deltas, rewards), inventory/gear
// (holdings snapshots, gear paging, equip/unequip), the unit roster (including
// each unit's resolved merged skill list for the build inspector, skills.md
// §"Player visibility"), consumables + formation-scoped zone effects, and
// formation editing (the layout snapshot + the whole-layout `setFormation`
// op), and the zone map (`listMap` → `mapView`, the discovered/frontier
// gridmap). The exact message
// envelope is owned by the backend/client and is not frozen in canon —
// accounts.md fixes the *behavior* of the connect-time state push, not its
// wire shape — so this mirrors the backend's current implementation and moves
// with it.

/** Prefix for the auth subprotocol: `grindshell.auth.<TOKEN>`. */
export const AUTH_PREFIX = "grindshell.auth.";

/** Per-room role (backend `RoomRole`, serialized lowercase). */
export type RoomRole = "admin" | "moderator" | "user" | "muted" | "banned";

/** A grid direction (backend `Direction`, serialized lowercase) — the six
 * cardinal axes a travel action can move along. */
export type Direction = "north" | "south" | "east" | "west" | "up" | "down";

/**
 * The pre-login status payload from `GET /api/status` (backend
 * `StatusResponse` in crates/server/src/state.rs; design: server-status.md).
 * An unauthenticated, coarsely-cached bundle shown on the login screen.
 */
export type ServerStatus = {
  /** The current message of the day; empty string when none is set. */
  motd: string;
  /** ISO-8601 timestamp of the last MOTD change, or null when no MOTD is set. */
  motdUpdatedAt: string | null;
  /** Unique accounts connected to chat (coarse, ~15-min cached). */
  playersOnline: number;
};

/* ------------------------------------------------------------------ */
/* Client → server                                                    */
/* ------------------------------------------------------------------ */

// Chat-subsystem payloads. Tagged on `ct` (camelCase). Mirrors `ChatData`.
//
// Players are addressed by STRING identifiers: `room`/`name`/`to` are room names
// or usernames, and `target` (moderation/block) is the target's username. The
// client never sends raw account or room ids. `messageId` is the opaque id the
// client received on a `chatRoomMsg`/`chatDm` and echoes back to report it.
export type ChatData =
  | { ct: "sendRoom"; room: string; body: string }
  | { ct: "joinRoom"; room: string; password?: string | null }
  | { ct: "leaveRoom"; room: string }
  | { ct: "createRoom"; name: string; password?: string | null }
  | { ct: "setRoomPassword"; room: string; password?: string | null }
  | { ct: "setRoomRole"; room: string; target: string; role: RoomRole }
  | { ct: "kickFromRoom"; room: string; target: string }
  | { ct: "closeRoom"; room: string }
  | { ct: "sendDm"; to: string; body: string }
  | { ct: "block"; target: string }
  | { ct: "unblock"; target: string }
  // `dm` says which message log the id addresses — room messages and DMs are
  // stored (and numbered) separately server-side.
  | { ct: "report"; messageId: number; reason: string; dm: boolean }
  // A chat command line (chat.md "Chat commands"): the raw "/command …" text
  // plus the room it was typed in (null outside any room, e.g. the DM view).
  // Parsed and dispatched server-side; unauthorized/malformed commands nack
  // politely with a usage message.
  | { ct: "command"; room?: string | null; body: string }
  // Revoke a room message by id (moderators/admins only) — marks it
  // server-side and broadcasts a `chatRevoke` to every connected client.
  | { ct: "revokeMessage"; messageId: number }
  // One page of the enforcement log (moderators/admins only) → `modLogPage`.
  | { ct: "modLog"; page: number }
  // One page of the pending report queue (moderators/admins only) →
  // `modReportsPage`.
  | { ct: "modReports"; page: number }
  // Resolve (dismiss) a pending report (moderators/admins only).
  | { ct: "resolveReport"; reportId: number }
  // A player's minimal profile (username + online); omitted username = own.
  // Answered with a `chatProfile` push.
  | { ct: "profile"; username?: string | null };

// Game-subsystem payloads. Tagged on `gt` (camelCase). Mirrors `GameData`
// (+ the flattened `ActionRequest` under `kind` for `changeAction`).
//
// `changeAction` while an idle action is in flight is an atomic stop-then-start
// (actions.md "Concurrency"): the old action's rewards commit (an
// `actionRewards` push with `stopped: true`) and the new action begins. The
// player's formation is cached server-side and never supplied here.
export type GameData =
  | { gt: "listEnemies" }
  // The legal travel destinations from the current zone (the adjacent authored
  // neighbours). Answered with a `destinationList` push, cached per zone like
  // `listEnemies`.
  | { gt: "listDestinations" }
  // The player's zone map (zones-and-travel.md "Map visibility"): the discovered
  // zones plus their one-step frontier. Answered with a `mapView` push.
  | { gt: "listMap" }
  | { gt: "changeAction"; kind: "combat"; enemy: string; kc: number }
  // Travel to the adjacent zone in `direction` (zones-and-travel.md "Travel").
  // Unlike combat it takes no KC — the engine computes the tick cost from the
  // formation's Speed and the destination's danger. Nacks when no authored
  // zone lies that way.
  | { gt: "changeAction"; kind: "travel"; direction: Direction }
  | { gt: "stopAction" }
  // Equip an unequipped gear instance onto a roster unit. The slot comes from
  // the gear's template (occupied single slots swap back to the inventory,
  // trinkets append); stat requirements are checked server-side against the
  // unit's TRAINED levels only (items.md "Gear requirements") — a failure
  // nacks with the failing stats.
  | { gt: "equipGear"; unit: string; instanceId: number }
  // Unequip by instance id (unique across slots and trinkets). Never refused
  // for a worn piece — requirements gate equipping only.
  | { gt: "unequipGear"; unit: string; instanceId: number }
  // Select the page of unequipped gear the inventory snapshot carries (the
  // inventory is unbounded; the wire snapshot is not). Answered with a fresh
  // `inventory` push (no ack); out-of-range pages clamp to the last one. The
  // choice sticks for this connection's later snapshots and resets to 0 on
  // reconnect.
  | { gt: "gearPage"; page: number }
  // Use a consumable (items.md "Consumables"): consumes one and applies its
  // Zone Effect at `target` scope. The server implements `formation`; `zone`
  // and `world` nack as not-yet-available. Nacks when the item is absent or
  // not a consumable.
  | { gt: "useConsumable"; item: string; target: "formation" | "zone" | "world" }
  // Replace the formation layout as a whole (formations.md "Editing the
  // formation"): `slots` is the complete new set of occupied cells — the same
  // shape the `formation` snapshot carries. Validated atomically server-side
  // (in-grid cells, roster units only, no cell or unit twice) and nacked in
  // full on any violation, leaving the previous layout standing. An empty
  // layout is valid (it just can't start actions). Always allowed, including
  // mid-action: the in-flight action keeps its cached Preparation-walk stats
  // and the new layout takes effect at the next Preparation. The ack rides
  // with the fresh `formation` snapshot.
  | { gt: "setFormation"; slots: FormationSlotView[] }
  // Request the catalog of tradeable goods on the global market (markets.md
  // "Tradeable goods"). Answered with a `marketGoods` push the client caches.
  | { gt: "listMarketGoods" }
  // Request the order book for one good (markets.md "Order book mechanics").
  // Answered with a `marketBook` push (depth + the player's own orders).
  | { gt: "viewMarket"; good: string }
  // Request the player's own active global-market orders across every good
  // (markets.md "Order limits"). Answered with a `marketOrders` push.
  | { gt: "listMyOrders" }
  // Place a resting limit buy: escrows `qty × price` credits, matches crossing
  // asks at the maker price, rests the remainder. Buyers pay no fee. The ack
  // rides with fresh inventory + book + orders snapshots; nacks on an
  // unknown/untradeable good, non-positive qty/price, the order cap, or
  // insufficient credits.
  | { gt: "placeBuyOrder"; good: string; qty: number; price: number }
  // Place a resting limit sell: escrows the goods, charges the 1% listing fee,
  // matches crossing bids at the maker price, rests the remainder; each fill
  // charges the seller 4%. Nacks on an unknown/untradeable good, non-positive
  // qty/price, the order cap, or insufficient goods/credits (listing fee).
  | { gt: "placeSellOrder"; good: string; qty: number; price: number }
  // Buy directly off the front of the sell book (markets.md "Direct buying"):
  // an immediate taker buy up to `qty` and a per-unit `maxPrice`, paying each
  // resting ask at its price. Nothing rests. Nacks on an unknown/untradeable
  // good or a non-positive qty.
  | { gt: "buyDirect"; good: string; qty: number; maxPrice: number }
  // Cancel one of the player's resting orders by id: refunds the escrow (but
  // not the listing fee). Nacks when the order is missing or not the player's.
  | { gt: "cancelOrder"; orderId: number };

// Top-level inbound data, tagged on `t`. Chat ops are carried under `t: "chat"`
// and game ops under `t: "game"`. `requestState` is a top-level *control*
// message — a full state refresh spans subsystems, so it is not a chat or game
// op; the server rate-limits it per connection and fans it out, and each
// subsystem re-pushes its state slice. The engine's `admin`/`shutdown` control
// variant is internal and intentionally not part of the client protocol.
export type ClientData =
  | ({ t: "chat" } & ChatData)
  | ({ t: "game" } & GameData)
  // A client-originated admin command, gated server-side against the `sudoers`
  // designation (server-status.md "Admin commands"). A non-designated requestor
  // is disconnected, so the client only surfaces these to admins (`world.isAdmin`).
  | { t: "adminCmd"; tt: "setMotd"; body: string }
  // Designate / un-designate a player moderator (chat.md "Moderator
  // designation"); also reachable as the /promote and /unpromote chat commands.
  | { t: "adminCmd"; tt: "setModerator"; username: string; moderator: boolean }
  // List the current player moderators → a `moderators` push.
  | { t: "adminCmd"; tt: "listModerators" }
  | { t: "requestState" };

/** The full client → server envelope (`Message`). `nonce` correlates Ack/Nack. */
export type ClientMessage = { nonce: number | null; data: ClientData };

/* ------------------------------------------------------------------ */
/* Server → client                                                    */
/* ------------------------------------------------------------------ */

/** The idle-action lifecycle phase a tick executed (`ActionPhase`). */
export type ActionPhase = "preparation" | "execution" | "downtime" | "regroup" | "resolution";

/** The six action stats as the server reports them (`ActionStatsView`). */
export type ActionStatsView = {
  health: number;
  physicalAttack: number;
  magicalAttack: number;
  physicalDefense: number;
  magicalDefense: number;
  speed: number;
};

/** One selectable enemy of the current zone (`EnemyInfo`), knowledge-filtered
 * server-side. `drops` is presentational (display names of potential drops). */
export type EnemyInfo = {
  id: string;
  name: string;
  descriptions: string[];
  drops: string[];
};

/** One legal travel destination of the current zone (`DestinationInfo`): an
 * adjacent authored zone, with the direction it lies in (the value sent back in
 * a travel `changeAction`). The tick cost is not previewed — it depends on the
 * formation walk that only runs at Preparation. */
export type DestinationInfo = {
  direction: Direction;
  /** The neighbour's grid position ("x,y,z"). */
  position: string;
  name: string;
  danger: number;
};

/** One zone on the player's map (`MapZoneInfo`, zones-and-travel.md "Map
 * visibility"). A `discovered` zone is one the player has Knowledge of (or is
 * standing in / their spawn); a non-discovered entry is a **frontier** zone —
 * an authored neighbour of a discovered zone, shown so the player can see there
 * is somewhere to go but flagged as not-yet-explored. */
export type MapZoneInfo = {
  /** The zone's grid position ("x,y,z"). */
  pos: string;
  name: string;
  danger: number;
  discovered: boolean;
  /** The player's banked Knowledge of this zone (knowledge.md); 0 for a
   * frontier zone or a discovered anchor with no banked Knowledge yet. */
  knowledge: number;
};

/** The three numeric currencies (`CurrenciesView`, resources.md "Resource
 * classes"), shared between the reward tally and the inventory snapshot. */
export type CurrenciesView = {
  credits: number;
  dust: number;
  rousingDevices: number;
};

/** The four bulk general resources (`GeneralResourcesView`). */
export type GeneralResourcesView = {
  bio: number;
  met: number;
  ele: number;
  liq: number;
};

/** One fungible item stack (`ItemStackView`): an item-resource or consumable
 * quantity with its display fields resolved server-side. `category` is the
 * general-resource grouping of item resources (absent on consumables). */
export type ItemStackView = {
  id: string;
  name: string;
  kind: string;
  category?: string;
  qty: number;
};

/** One accrued unit of experience (`XpGainView`, progression.md): the running
 * total banked toward a `(unit, target)` pair, where `target` is a stat id
 * (`"str"`..`"wis"`) or a skill id. `levelBefore`/`levelAfter` are `0` in the
 * per-tick running tally and carry the unit's trained level on either side of
 * the Resolution commit, so the client can call out level-ups. */
export type XpGainView = {
  unitId: string;
  target: string;
  amount: number;
  levelBefore: number;
  levelAfter: number;
};

/** One accrued unit of Knowledge (`KnowledgeGainView`, knowledge.md): the
 * running total the action built toward a content entity, keyed by a namespaced
 * id (`"zone:1,0,0"`) with a player-facing `label` (the zone name). Account-
 * level, so one entry per entity (not per unit). */
export type KnowledgeGainView = {
  key: string;
  label: string;
  amount: number;
};

/** An idle action's accrued (or final) reward tally (`RewardsView`). Gear
 * drops ride `items` as ordinary stacks (`kind === "gear"`); unique instances
 * are minted server-side when the tally commits. `experience` is the use-based
 * XP accrued this action; `knowledge` is the account-level Knowledge it built
 * (today: travel's destination-zone knowledge). Both omitted while empty. */
export type RewardsView = {
  kills: number;
  currencies: CurrenciesView;
  general: GeneralResourcesView;
  items: ItemStackView[];
  experience?: XpGainView[];
  knowledge?: KnowledgeGainView[];
};

/** The six unit/gear stats (`UnitStatsView`, stats.md "Unit and gear stats"). */
export type UnitStatsView = {
  str: number;
  vit: number;
  dex: number;
  agi: number;
  int: number;
  wis: number;
};

/** A skill grant: name + flat value (`SkillGrantView`). On a unit it is the
 * trained level; on gear it is the value granted while equipped. */
export type SkillGrantView = {
  name: string;
  value: number;
};

/** One entry of a unit's resolved merged skill list (`ResolvedSkillView`,
 * skills.md "The merged skill list" / §"Player visibility"): a skill the unit
 * actually dispatches, presented IN PROCESSING ORDER (the `resolvedSkills`
 * array is ordered, highest effective priority first). Canon requires the
 * client surface this per unit, in order, with override conflicts called out. */
export type ResolvedSkillView = {
  /** Stable skill id / registry key. */
  id: string;
  /** Player-facing display name (falls back to the id when unregistered). */
  name: string;
  /** Player-facing description of what the skill does ("" / absent until authored). */
  description?: string;
  /** Effective value (trained + gear grants); always > 0 (the dispatch gate). */
  value: number;
  /** No registry entry — still dispatches, but last in order. */
  unregistered: boolean;
  /** Disagreeing priority overrides forced a fallback to the registry default
   * (skills.md "Override conflicts") — canon requires this be surfaced. */
  conflict: boolean;
};

/** One owned gear instance (`GearView`, items.md "Gear instances and
 * templates"), display fields resolved server-side. `requirements` are
 * per-stat minimums vs a unit's TRAINED levels (0 = none) — sent so the
 * client can preview equippability with the cheap stat check only. */
export type GearView = {
  /** Stable per-instance id (the backend `gear` table's autoincrement id). */
  instanceId: number;
  template: string;
  name: string;
  /** "headwear" | "torso" | "legs" | "mainHand" | "offHand" | "trinket" */
  slot: string;
  stats: UnitStatsView;
  requirements: UnitStatsView;
  skills?: SkillGrantView[];
  gearScore: number;
  enhancement: number;
};

/** One roster unit (`UnitView`, units.md): identity, trained vs effective
 * (trained + gear) stats, trained skills, the resolved merged skill list, and
 * equipped gear. */
export type UnitView = {
  id: string;
  name: string;
  title?: string;
  isPlayer: boolean;
  trained: UnitStatsView;
  effective: UnitStatsView;
  skills: SkillGrantView[];
  /** The resolved merged skill list, in processing order (skills.md
   * §"Player visibility"). Absent/empty for a unit with no non-zero skills. */
  resolvedSkills?: ResolvedSkillView[];
  equipment: GearView[];
};

/** One occupied formation cell (`FormationSlotView`, formations.md "Layout"):
 * a roster unit id at its grid position, both coordinates in 0..5. Shared by
 * the `formation` snapshot and the `setFormation` op. The grid's processing
 * order is top-to-bottom, right-to-left — cell 1 is (4, 0) — and the
 * right-most column is the visually leading side (formations.md "Visual
 * presentation"). */
export type FormationSlotView = {
  /** The roster-unique unit id (`UnitView.id`). */
  unit: string;
  x: number;
  y: number;
};

/** One active formation-scoped Zone Effect (`EffectView`, zone-effects.md
 * "Scope": formation). `remainingSecs` is the server-authoritative countdown
 * baseline at snapshot time; the client counts down locally from there. */
export type EffectView = {
  id: string;
  name: string;
  /** Modifier kind tag — "dropRate" today. */
  kind: string;
  /** One-line human summary (e.g. "Drop rate up 25×3"). */
  summary: string;
  /** Scope — only "formation" is implemented. */
  scope: string;
  remainingSecs: number;
};

/** One attack within an idle-combat round (`AttackReport`), reported in actual
 * Speed order — the first entry struck first. */
export type AttackReport = {
  actor: "formation" | "enemy";
  damage: number;
  defeated: boolean;
};

/** The combat-specific slice of an `ActionView` (`CombatView`); other kinds
 * carry their own slices as they land. */
export type CombatView = {
  enemyId: string;
  enemyName: string;
  enemyHp: number;
  enemyMaxHp: number;
  enemyStats: ActionStatsView;
};

/** The travel-specific slice of an `ActionView` (`TravelView`): where the
 * journey is headed. Progress rides the kind-agnostic `kcTarget`/`kcDone` (the
 * engine-computed tick count and ticks elapsed). */
export type TravelView = {
  direction: Direction;
  /** The destination zone's grid position ("x,y,z"). */
  destination: string;
  destinationName: string;
  /** The destination's danger level (a travel-cost input). */
  danger: number;
};

/** The full snapshot of an in-flight idle action (`ActionView`), pushed in the
 * `gameState` slice; `actionTick` deltas fold over it. The lifecycle fields are
 * kind-agnostic; the kind-specific slice nests under its key (`combat` iff
 * `kind === "combat"`). */
export type ActionView = {
  kind: string;
  kcTarget: number;
  kcDone: number;
  phase: ActionPhase;
  formationHp: number;
  formationMaxHp: number;
  formationStats: ActionStatsView;
  modifier: ActionStatsView;
  tally: RewardsView;
  combat?: CombatView;
  /** The travel slice; present iff `kind === "travel"`. */
  travel?: TravelView;
};

/** One tradeable good in the global-market catalog (`GoodInfo`, markets.md
 * "Tradeable goods"). `kind` groups it for display: `currency` (dust / rousing
 * devices), `general` (bio / met / ele / liq), `resource` (item resources), or
 * `consumable`. `category` is the general-resource grouping of item resources
 * (absent otherwise). Credits and gear are not tradeable here. */
export type GoodInfo = {
  id: string;
  name: string;
  kind: string;
  category?: string;
};

/** One aggregated price level of an order book (`OrderLevel`): the total
 * resting quantity at `price`. Public depth is shown as levels (no foreign
 * order ids). */
export type OrderLevel = {
  price: number;
  qty: number;
};

/** One of the player's own resting orders (`OrderView`), addressable by `id`
 * (so the client can cancel it). `qty` is the remaining quantity; `side` is
 * `"buy"` or `"sell"`. */
export type OrderView = {
  id: number;
  good: string;
  side: string;
  price: number;
  qty: number;
};

/** One entry of the enforcement log (`ModLogEntryView`, chat.md "Logging"),
 * actors resolved to usernames server-side (`#<id>` for nameless accounts). */
export type ModLogEntryView = {
  id: number;
  /** The acting player moderator / server admin. */
  moderator: string;
  /** The action tag ("global_ban", "revoke_message", "kick", …). */
  action: string;
  /** The sanctioned/affected player, when the action had one. */
  target?: string;
  /** The room the action applied to, when room-scoped. */
  room?: string;
  /** The moderator's optional free-text note. */
  note?: string;
  createdAt: string;
};

/** One pending report (`ReportView`, chat.md "Reporting"), with the reported
 * message joined in so the queue is reviewable without further lookups. */
export type ReportView = {
  id: number;
  reporter: string;
  messageId: number;
  /** Whether the reported message is a DM (true) or a room message (false). */
  dm: boolean;
  sender: string;
  /** The room the message was posted in (absent for DMs). */
  room?: string;
  /** The reported body — preserved even if since revoked. */
  body: string;
  reason: string;
  sentAt: string;
  createdAt: string;
  /** Already revoked (room messages only). */
  revoked: boolean;
};

// Tagged on `t` (camelCase). Mirrors `Outbound`. `from` is the sender's
// USERNAME; `sentAt` is an RFC3339 / ISO-8601 timestamp string. `messageId` is
// a backend i64 (safe as a JS number for any realistic message count).
export type ServerMessage =
  | { t: "ack"; nonce?: number | null; msg?: string | null }
  | { t: "nack"; nonce?: number | null; msg?: string | null }
  | { t: "chatRoomMsg"; room: string; messageId: number; from: string; body: string; sentAt: string }
  | { t: "chatDm"; messageId: number; from: string; body: string; sentAt: string }
  | { t: "chatSystem"; room: string; body: string }
  // Whether this connection's account is a designated admin (server-status.md
  // "Admin commands") and/or a player moderator (chat.md "Moderator
  // designation"). Pushed once at connect; a UI hint for showing the
  // admin/moderation surfaces (the server re-authorizes every command).
  | { t: "adminStatus"; isAdmin: boolean; isModerator: boolean }
  // A room message was revoked (chat.md "Enforcement": Message revocation):
  // remove the room message with this id from the rendered transcript.
  // Broadcast to every connected client; ignore ids never seen.
  | { t: "chatRevoke"; messageId: number }
  // The answer to a `profile` request: the username (absent for the
  // requester's own guest account) and whether the player is connected.
  | { t: "chatProfile"; username?: string | null; online: boolean }
  // One page of the enforcement log, newest first (the moderation view).
  | { t: "modLogPage"; page: number; hasMore: boolean; entries: ModLogEntryView[] }
  // One page of the pending report queue, newest first.
  | { t: "modReportsPage"; page: number; hasMore: boolean; reports: ReportView[] }
  // The current player moderators (the `listModerators` admin command's answer).
  | { t: "moderators"; usernames: string[] }
  // The chat half of the connect-time state push (accounts.md "State
  // synchronization"): the authoritative set of rooms this connection is
  // subscribed to. Sent on every (re)connect and in reply to `requestState`.
  // Built-in rooms (`builtin: true`) are auto-subscribed and cannot be left.
  // The client REPLACES its room set from this, it does not merge.
  | { t: "chatState"; rooms: { name: string; builtin: boolean; role?: RoomRole }[] }
  // The game half of the connect-time state push: the player's zone (an
  // "x,y,z" string) and their in-flight idle action, if any. The client
  // REPLACES its game state from this. Also re-pushed on `requestState`.
  | { t: "gameState"; zone: string; action?: ActionView }
  // The answer to `listEnemies`: the knowledge-filtered roster of `zone`.
  // Cached client-side per zone.
  | { t: "enemyList"; zone: string; enemies: EnemyInfo[] }
  // The answer to `listDestinations`: the adjacent authored zones reachable
  // from `from`. Cached client-side per zone.
  | { t: "destinationList"; from: string; destinations: DestinationInfo[] }
  // The answer to `listMap`: the player's zone map (zones-and-travel.md "Map
  // visibility"). `current` is the zone the player stands in; `zones` is every
  // visible zone — the discovered region plus its one-step frontier — each
  // flagged `discovered`. The client REPLACES its map from this.
  | { t: "mapView"; current: string; zones: MapZoneInfo[] }
  // The per-tick delta for the in-flight action, batched at the end of the
  // global tick. `phase` is the lifecycle phase this tick executed; absent
  // fields are unchanged and fold over the `gameState` baseline. The delta is
  // a flat union across kinds: `attacks`/`enemy*` are combat's (folding into
  // `ActionView.combat`) and only appear for combat actions.
  | {
      t: "actionTick";
      phase: ActionPhase;
      attacks?: AttackReport[];
      /** The KC goal — present when it (re)computes, i.e. on the Preparation
       * tick. Combat's is already known; travel's engine-computed tick count is
       * learned here. */
      kcTarget?: number;
      kcDone?: number;
      formationHp?: number;
      formationMaxHp?: number;
      enemyHp?: number;
      enemyMaxHp?: number;
      formationStats?: ActionStatsView;
      enemyStats?: ActionStatsView;
      modifier?: ActionStatsView;
      tally?: RewardsView;
    }
  // The action ended (KC reached, or stopped/replaced): the final committed
  // rewards. The client clears its in-flight action and shows the reward view.
  | {
      t: "actionRewards";
      kind: string;
      /** What the action acted on, by display name (the enemy for combat). */
      targetName: string;
      kcTarget: number;
      kcDone: number;
      stopped: boolean;
      rewards: RewardsView;
    }
  // The authoritative inventory snapshot (inventory.md): committed holdings,
  // pushed at connect, on `requestState`, after every mutation (a commit, an
  // equip/unequip), and in answer to a `gearPage` op. The client REPLACES its
  // inventory from this — per-tick tallies are narration, never client-side
  // accumulation. `items` is sorted by template id; `gear` is ONE PAGE of the
  // unequipped instances in acquire order (the collection is unbounded, the
  // snapshot is not — equipped gear lives on the roster units): `gearPage` is
  // the 0-based page carried (requests beyond the end clamp to the last
  // page), `gearPages` the total page count (≥ 1), `gearTotal` the total
  // unequipped count across all pages.
  | {
      t: "inventory";
      currencies: CurrenciesView;
      general: GeneralResourcesView;
      items: ItemStackView[];
      gear: GearView[];
      gearPage: number;
      gearPages: number;
      gearTotal: number;
    }
  // The authoritative roster snapshot (units.md): every owned unit with
  // trained/effective stats and equipped gear. Pushed at connect, on
  // `requestState`, and after every equip/unequip. The client REPLACES.
  | { t: "roster"; units: UnitView[] }
  // The authoritative active-effects snapshot (zone-effects.md): the player's
  // active formation-scoped Zone Effects. Pushed at connect, on `requestState`,
  // after a consumable is used, and when an effect expires. Client REPLACES.
  | { t: "effects"; effects: EffectView[] }
  // The authoritative formation snapshot (formations.md "Editing the
  // formation"): the single active layout — every occupied cell. Pushed at
  // connect, on `requestState`, and after a successful `setFormation`. The
  // client REPLACES its layout from this. An edit never touches an in-flight
  // action's cached stats, so this and the action view can legitimately
  // disagree mid-action.
  | { t: "formation"; slots: FormationSlotView[] }
  // The answer to `listMarketGoods`: the catalog of tradeable goods. Fixed for
  // a server build, so the client may cache it.
  | { t: "marketGoods"; goods: GoodInfo[] }
  // The answer to `viewMarket` (and the push riding every order mutation's
  // ack): one good's order book — aggregated `bids`/`asks` depth (best price
  // first) plus `yours`, the player's own resting orders for it. The client
  // replaces its book for `good` from this.
  | { t: "marketBook"; good: string; bids: OrderLevel[]; asks: OrderLevel[]; yours: OrderView[] }
  // The answer to `listMyOrders`: every active order the player holds, across
  // all goods. The client replaces its order list from this.
  | { t: "marketOrders"; orders: OrderView[] };

/**
 * Parse a raw WebSocket text frame into typed `ServerMessage`s.
 *
 * Every server frame is a JSON **array** of `Outbound` (the backend serializes
 * `[msg]` / `Vec<Outbound>` per send), so a single frame can carry zero or more
 * messages. Unrecognized entries are dropped; a malformed frame yields `[]`.
 */
export function parseServerFrame(raw: string): ServerMessage[] {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter(
    (m): m is ServerMessage => !!m && typeof (m as { t?: unknown }).t === "string",
  );
}
