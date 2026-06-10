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
// IMPORTANT: today the backend's WebSocket only routes the CHAT data variants;
// non-chat (game) messages are accepted but currently dropped server-side (the
// game engine isn't wired to the socket yet). So only auth + chat are usable
// over the wire. The exact message envelope is owned by the backend/client and
// is not frozen in canon — accounts.md fixes the *behavior* of the connect-time
// state push, not its wire shape — so this mirrors the backend's current
// implementation and moves with it.

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

// Top-level inbound data, tagged on `t`. Chat ops are carried under `t: "chat"`.
// `requestState` is a top-level *control* message — a full state refresh spans
// subsystems (chat subscriptions, and later game/account state), so it is not a
// chat op; the server rate-limits it per connection and replies with the
// relevant state push(es). The engine's `admin`/`shutdown` control variant is
// internal and intentionally not part of the client protocol.
export type ClientData =
  | ({ t: "chat" } & ChatData)
  | { t: "requestState" };

/** The full client → server envelope (`Message`). `nonce` correlates Ack/Nack. */
export type ClientMessage = { nonce: number | null; data: ClientData };

/* ------------------------------------------------------------------ */
/* Server → client                                                    */
/* ------------------------------------------------------------------ */

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
  | { t: "chatState"; rooms: { name: string; builtin: boolean; role?: RoomRole }[] };

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
