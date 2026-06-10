// The game context: the client's single connection to backend state.
//
// Scope is grounded in what the backend actually serves: AUTH (a session
// token), CHAT (rooms + DMs), and the IDLE-ACTION lifecycle (combat only
// today): the `gameState` slice of the connect-time push, zone enemy listings,
// change/stop action, per-tick `actionTick` deltas, and the final
// `actionRewards`. Surfaces the backend doesn't serve (inventory, formation,
// area, markets) stay unmodeled — gameplay pages keep local placeholders until
// the wire grows them.
//
// In `uiDev`/offline mode there is no socket; chat sends echo locally so the UI
// is exercisable without a server, and actions report that a server is needed.

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
import type {
  ActionView,
  ClientData,
  EnemyInfo,
  RewardsView,
  ServerMessage,
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
};

const DM_BUCKET = "@dms";

type ChatState = {
  rooms: string[];
  activeRoom: string;
  byRoom: Record<string, ChatEntry[]>;
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
  enemyName: string;
  kcTarget: number;
  kcDone: number;
  stopped: boolean;
  rewards: RewardsView;
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
  lastRewards: RewardReport | null;
  /** The last combat request, for quick restart. */
  lastCombat: { enemy: string; kc: number } | null;
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
  resync: () => void;
  dmBucket: string;
  world: WorldState;
  /** Request the current zone's selectable enemies (answered by `enemyList`). */
  listEnemies: () => void;
  /** Start (or replace — atomic stop-then-start) an idle-combat action. */
  startCombat: (enemyId: string, kc: number) => void;
  /** Manually stop the in-flight idle action, committing accrued rewards. */
  stopAction: () => void;
  /** Dismiss the reward view. */
  clearRewards: () => void;
  /** Append a local (client-only) line to the action log. */
  logLocal: (text: string) => void;
};

const GameContext = createContext<Game>();

export function GameProvider(props: ParentProps) {
  const [chat, setChat] = createStore<ChatState>({
    rooms: [...BUILTIN_ROOMS],
    activeRoom: "main",
    byRoom: Object.fromEntries([...BUILTIN_ROOMS, DM_BUCKET].map((r) => [r, []])),
  });

  const [world, setWorld] = createStore<WorldState>({
    zone: "0,0,0",
    action: null,
    enemies: {},
    lastRewards: null,
    lastCombat: null,
    log: [],
  });

  const [status, setStatus] = createSignal<GameStatus>("offline");
  const online = () => status() === "connected";

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
      case "gameState": {
        // The game half of the state push: replace, don't merge.
        setWorld("zone", msg.zone);
        setWorld("action", msg.action ?? null);
        if (msg.action) {
          // A fresh start also pushes this baseline; only call it a resume
          // when the action already has progress.
          pushLog(
            `${msg.action.kcDone > 0 ? "Resumed" : "Started"}: ${msg.action.kind} vs ` +
              `${msg.action.enemyName} (KC ${msg.action.kcDone}/${msg.action.kcTarget}).`,
            "info",
          );
        }
        break;
      }
      case "enemyList":
        setWorld("enemies", msg.zone, msg.enemies);
        break;
      case "actionTick": {
        const act = world.action;
        if (act) {
          // Fold the delta over the baseline; absent fields are unchanged.
          const patch: Partial<ActionView> = { phase: msg.phase };
          if (msg.kcDone != null) patch.kcDone = msg.kcDone;
          if (msg.formationHp != null) patch.formationHp = msg.formationHp;
          if (msg.formationMaxHp != null) patch.formationMaxHp = msg.formationMaxHp;
          if (msg.enemyHp != null) patch.enemyHp = msg.enemyHp;
          if (msg.enemyMaxHp != null) patch.enemyMaxHp = msg.enemyMaxHp;
          if (msg.formationStats) patch.formationStats = msg.formationStats;
          if (msg.enemyStats) patch.enemyStats = msg.enemyStats;
          if (msg.modifier) patch.modifier = msg.modifier;
          if (msg.tally) patch.tally = msg.tally;
          setWorld("action", patch);
        }
        // Narrate the tick into the action log.
        const name = act?.enemyName ?? "the enemy";
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
            pushLog("Regroup — formation health restored; resuming.", "info");
            break;
          case "resolution":
            break;
        }
        break;
      }
      case "actionRewards": {
        setWorld("action", null);
        setWorld("lastRewards", {
          kind: msg.kind,
          enemyName: msg.enemyName,
          kcTarget: msg.kcTarget,
          kcDone: msg.kcDone,
          stopped: msg.stopped,
          rewards: msg.rewards,
        });
        const r = msg.rewards;
        const resources = Object.entries(r.resources)
          .map(([id, q]) => `${q} ${id}`)
          .join(", ");
        pushLog(
          `${msg.stopped ? "Stopped" : "Finished"} ${msg.kind} vs ${msg.enemyName}: ` +
            `${r.kills} kills, ${r.credits} credits${resources ? `, ${resources}` : ""}.`,
          "reward",
        );
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

  /* ---- game / idle-action methods ---- */

  const listEnemies = () => {
    if (!online()) return;
    send({ t: "game", gt: "listEnemies" });
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

  const stopAction = () => {
    if (!online()) return;
    send(
      { t: "game", gt: "stopAction" },
      { onNack: (reason) => pushLog(`✗ ${reason ?? "could not stop the action"}`, "failure") },
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
    world,
    listEnemies,
    startCombat,
    stopAction,
    clearRewards,
    logLocal,
  };

  return <GameContext.Provider value={game}>{props.children}</GameContext.Provider>;
}

export function useGame(): Game {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within a GameProvider");
  return ctx;
}
