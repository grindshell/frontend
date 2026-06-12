// The game context: the client's single connection to backend state.
//
// Scope is grounded in what the backend actually serves: AUTH (a session
// token), CHAT (rooms + DMs), the IDLE-ACTION lifecycle (combat only today):
// the `gameState` slice of the connect-time push, zone enemy listings,
// change/stop action, per-tick `actionTick` deltas, and the final
// `actionRewards`; plus the INVENTORY/roster/effects snapshots (holdings,
// units + gear, formation-scoped Zone Effects) and their equip/use ops, and
// the FORMATION layout (the `formation` snapshot + whole-layout
// `setFormation` edits). Surfaces the backend doesn't serve (travel/area,
// markets) stay unmodeled — those pages keep placeholders until the wire
// grows them.
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
  CombatView,
  CurrenciesView,
  DestinationInfo,
  Direction,
  EffectView,
  EnemyInfo,
  FormationSlotView,
  GearView,
  GeneralResourcesView,
  ItemStackView,
  RewardsView,
  ServerMessage,
  UnitView,
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
  lastRewards: RewardReport | null;
  /** The last combat request, for quick restart. */
  lastCombat: { enemy: string; kc: number } | null;
  /** The last travel request (the chosen direction), for quick restart. */
  lastTravel: { direction: Direction } | null;
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
  /** Request the current zone's travel destinations (answered by
   * `destinationList`). */
  listDestinations: () => void;
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
    destinations: {},
    inventory: null,
    roster: null,
    formation: null,
    effects: [],
    lastRewards: null,
    lastCombat: null,
    lastTravel: null,
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
   * rate-limited per connection). The server fans it to both subsystems: chat
   * re-pushes `chatState`, the game re-pushes `gameState` + `inventory` +
   * `roster` + `formation` + `effects`. */
  const resync = () => {
    if (online()) send({ t: "requestState" });
  };

  const setActiveRoom = (room: string) => setChat("activeRoom", room);

  /* ---- game / idle-action methods ---- */

  const listEnemies = () => {
    if (!online()) return;
    send({ t: "game", gt: "listEnemies" });
  };

  const listDestinations = () => {
    if (!online()) return;
    send({ t: "game", gt: "listDestinations" });
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
    // listEnemies this is a read, so there is no ack to correlate.
    send({ t: "game", gt: "gearPage", page: Math.max(0, Math.floor(page)) });
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
    listDestinations,
    startCombat,
    startTravel,
    stopAction,
    equipGear,
    unequipGear,
    requestGearPage,
    useConsumable,
    setFormation,
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
