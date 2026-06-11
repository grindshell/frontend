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
// surfaces today: auth, chat, and the idle-combat action lifecycle (enemy
// listings, change/stop action, per-tick deltas, rewards). The exact message
// envelope is owned by the backend/client and is not frozen in canon —
// accounts.md fixes the *behavior* of the connect-time state push, not its
// wire shape — so this mirrors the backend's current implementation and moves
// with it.

/** Prefix for the auth subprotocol: `grindshell.auth.<TOKEN>`. */
export const AUTH_PREFIX = "grindshell.auth.";

/** Per-room role (backend `RoomRole`, serialized lowercase). */
export type RoomRole = "admin" | "moderator" | "user" | "muted" | "banned";

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
  | { ct: "report"; messageId: number; reason: string };

// Game-subsystem payloads. Tagged on `gt` (camelCase). Mirrors `GameData`
// (+ the flattened `ActionRequest` under `kind` for `changeAction`).
//
// `changeAction` while an idle action is in flight is an atomic stop-then-start
// (actions.md "Concurrency"): the old action's rewards commit (an
// `actionRewards` push with `stopped: true`) and the new action begins. The
// player's formation is cached server-side and never supplied here.
export type GameData =
  | { gt: "listEnemies" }
  | { gt: "changeAction"; kind: "combat"; enemy: string; kc: number }
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
  | { gt: "useConsumable"; item: string; target: "formation" | "zone" | "world" };

// Top-level inbound data, tagged on `t`. Chat ops are carried under `t: "chat"`
// and game ops under `t: "game"`. `requestState` is a top-level *control*
// message — a full state refresh spans subsystems, so it is not a chat or game
// op; the server rate-limits it per connection and fans it out, and each
// subsystem re-pushes its state slice. The engine's `admin`/`shutdown` control
// variant is internal and intentionally not part of the client protocol.
export type ClientData =
  | ({ t: "chat" } & ChatData)
  | ({ t: "game" } & GameData)
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

/** An idle action's accrued (or final) reward tally (`RewardsView`). Gear
 * drops ride `items` as ordinary stacks (`kind === "gear"`); unique instances
 * are minted server-side when the tally commits. */
export type RewardsView = {
  kills: number;
  currencies: CurrenciesView;
  general: GeneralResourcesView;
  items: ItemStackView[];
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
 * (trained + gear) stats, trained skills, and equipped gear. */
export type UnitView = {
  id: string;
  name: string;
  title?: string;
  isPlayer: boolean;
  trained: UnitStatsView;
  effective: UnitStatsView;
  skills: SkillGrantView[];
  equipment: GearView[];
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
  // The per-tick delta for the in-flight action, batched at the end of the
  // global tick. `phase` is the lifecycle phase this tick executed; absent
  // fields are unchanged and fold over the `gameState` baseline. The delta is
  // a flat union across kinds: `attacks`/`enemy*` are combat's (folding into
  // `ActionView.combat`) and only appear for combat actions.
  | {
      t: "actionTick";
      phase: ActionPhase;
      attacks?: AttackReport[];
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
  | { t: "effects"; effects: EffectView[] };

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
