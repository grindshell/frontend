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
  | { gt: "stopAction" };

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

/** An idle action's accrued (or final) reward tally (`RewardsView`). */
export type RewardsView = {
  kills: number;
  credits: number;
  /** Resource id → quantity. */
  resources: Record<string, number>;
};

/** One attack within an idle-combat round (`AttackReport`), reported in actual
 * Speed order — the first entry struck first. */
export type AttackReport = {
  actor: "formation" | "enemy";
  damage: number;
  defeated: boolean;
};

/** The full snapshot of an in-flight idle action (`ActionView`), pushed in the
 * `gameState` slice; `actionTick` deltas fold over it. */
export type ActionView = {
  kind: string;
  enemyId: string;
  enemyName: string;
  kcTarget: number;
  kcDone: number;
  phase: ActionPhase;
  formationHp: number;
  formationMaxHp: number;
  enemyHp: number;
  enemyMaxHp: number;
  formationStats: ActionStatsView;
  enemyStats: ActionStatsView;
  modifier: ActionStatsView;
  tally: RewardsView;
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
  // fields are unchanged and fold over the `gameState` baseline.
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
      enemyName: string;
      kcTarget: number;
      kcDone: number;
      stopped: boolean;
      rewards: RewardsView;
    };

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
