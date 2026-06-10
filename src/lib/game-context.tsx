// The game context: the client's single connection to backend state.
//
// Scope today is deliberately narrow and grounded in what the backend actually
// serves: AUTH (a session token) and CHAT (rooms + DMs). No game-state sync
// (inventory/formation/actions/combat/ticks) exists on the wire yet, so this
// layer does not model or fake it — gameplay pages keep their own local
// placeholder data until the backend grows those surfaces.
//
// In `uiDev`/offline mode there is no socket; chat sends echo locally so the UI
// is exercisable without a server.

import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type ParentProps,
} from "solid-js";
import { createStore } from "solid-js/store";
import { authToken, clearAuth } from "./auth";
import { config } from "./config";
import { Connection, type ConnStatus } from "./connection";
import type { ClientData, ServerMessage } from "./protocol";

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
};

const DM_BUCKET = "@dms";

type ChatState = {
  rooms: string[];
  activeRoom: string;
  byRoom: Record<string, ChatEntry[]>;
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
  resync: () => void;
  dmBucket: string;
};

const GameContext = createContext<Game>();

export function GameProvider(props: ParentProps) {
  const [chat, setChat] = createStore<ChatState>({
    rooms: [...BUILTIN_ROOMS],
    activeRoom: "main",
    byRoom: Object.fromEntries([...BUILTIN_ROOMS, DM_BUCKET].map((r) => [r, []])),
  });

  const [status, setStatus] = createSignal<GameStatus>("offline");
  const online = () => status() === "connected";

  let nextId = 1;
  let nonce = 1;
  let conn: Connection | null = null;

  // Mutating requests in flight, keyed by the nonce the server echoes on its
  // Ack/Nack. The client takes action (remove a tab, surface an error in the
  // right room) only when the response arrives — not optimistically. Entries
  // are dropped on disconnect: they can never resolve across a reconnect, and
  // the server's connect-time chatState push re-baselines everything anyway.
  type Pending = { onAck?: () => void; onNack?: (reason?: string) => void };
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
        break;
      }
      case "chatRoomMsg":
        push(msg.room, { room: msg.room, from: msg.from, body: msg.body, at: msg.sentAt, kind: "room" });
        break;
      case "chatDm":
        push(DM_BUCKET, { from: msg.from, body: msg.body, at: msg.sentAt, kind: "dm" });
        break;
      case "chatSystem":
        push(msg.room, { room: msg.room, from: "System", body: msg.body, kind: "system" });
        break;
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
          p.onAck?.();
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

  /** Ask the server for a full state refresh (top-level control message,
   * rate-limited per connection). The server replies with the relevant state
   * push(es) — today, the chat `chatState`. */
  const resync = () => {
    if (online()) send({ t: "requestState" });
  };

  const setActiveRoom = (room: string) => setChat("activeRoom", room);

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

  onMount(() => {
    // A real session token wins, even in uiDev: if the user logged in, connect.
    const token = authToken();
    if (token) {
      conn = new Connection(config.wsEndpoint, token, {
        onStatus: (s) => {
          setStatus(s);
          // In-flight request handlers can't resolve across a reconnect; the
          // connect-time chatState push re-baselines the room state instead.
          if (s !== "connected") pending.clear();
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
    resync,
    dmBucket: DM_BUCKET,
  };

  return <GameContext.Provider value={game}>{props.children}</GameContext.Provider>;
}

export function useGame(): Game {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within a GameProvider");
  return ctx;
}
