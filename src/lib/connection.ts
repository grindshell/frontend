// WebSocket connection manager for the backend `/ws` endpoint.
//
// Handshake (backend/crates/server/src/ws.rs): the client offers two
// subprotocols — `grindshell.auth.<TOKEN>` and a per-attempt `<NONCE>`. On a
// valid token the server upgrades and echoes the nonce back as the selected
// subprotocol. The client MUST verify the echoed protocol matches its nonce and
// sever otherwise (accounts.md anti-hijack rule).

import { AUTH_PREFIX, parseServerFrame, type ClientMessage, type ServerMessage } from "./protocol";

export type ConnStatus = "connecting" | "connected" | "closed" | "error";

export type ConnectionHandlers = {
  onStatus: (status: ConnStatus, detail?: string) => void;
  onMessage: (msg: ServerMessage) => void;
  /**
   * Called when a connection attempt fails before the handshake completes
   * (the socket closed without ever firing `open`), with the count of
   * consecutive such failures. The WebSocket API hides the HTTP status of a
   * rejected upgrade, so a dead network and a rejected session token look
   * identical here — the consumer can disambiguate (e.g. by probing the REST
   * surface) and decide whether to keep retrying or re-authenticate.
   */
  onHandshakeFailure?: (consecutive: number) => void;
};

const MAX_BACKOFF_MS = 30_000;

export class Connection {
  #url: string;
  #token: string;
  #handlers: ConnectionHandlers;
  #ws: WebSocket | null = null;
  #nonce = "";
  #closedByUs = false;
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #openedThisAttempt = false;
  #preOpenFailures = 0;

  constructor(url: string, token: string, handlers: ConnectionHandlers) {
    this.#url = url;
    this.#token = token;
    this.#handlers = handlers;
  }

  connect() {
    this.#closedByUs = false;
    this.#open();
  }

  #open() {
    this.#handlers.onStatus("connecting");
    this.#openedThisAttempt = false;
    // A fresh per-attempt nonce binds the server's response to this attempt.
    this.#nonce = `n-${crypto.randomUUID()}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.#url, [`${AUTH_PREFIX}${this.#token}`, this.#nonce]);
    } catch (e) {
      this.#handlers.onStatus("error", `failed to open socket: ${e}`);
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;

    ws.addEventListener("open", () => {
      this.#openedThisAttempt = true;
      this.#preOpenFailures = 0;
      // Verify the server echoed our nonce as the selected subprotocol.
      if (ws.protocol !== this.#nonce) {
        this.#handlers.onStatus("error", "subprotocol mismatch — possible hijack");
        this.#closedByUs = true;
        ws.close();
        return;
      }
      this.#attempt = 0;
      this.#handlers.onStatus("connected");
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      // Each frame is a JSON array of messages; dispatch them in order.
      for (const msg of parseServerFrame(ev.data)) this.#handlers.onMessage(msg);
    });

    ws.addEventListener("error", () => {
      this.#handlers.onStatus("error", "socket error");
    });

    ws.addEventListener("close", () => {
      this.#ws = null;
      if (this.#closedByUs) {
        this.#handlers.onStatus("closed");
        return;
      }
      if (!this.#openedThisAttempt) {
        this.#preOpenFailures += 1;
        this.#handlers.onHandshakeFailure?.(this.#preOpenFailures);
        // The handler may have decided to sever (e.g. rejected token).
        if (this.#closedByUs) return;
      }
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect() {
    if (this.#closedByUs) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.#attempt);
    this.#attempt += 1;
    this.#handlers.onStatus("closed", `reconnecting in ${Math.round(delay / 1000)}s`);
    this.#retryTimer = setTimeout(() => this.#open(), delay);
  }

  /** Send a client message. Returns false if the socket isn't open. */
  send(msg: ClientMessage): boolean {
    if (this.#ws?.readyState !== WebSocket.OPEN) return false;
    this.#ws.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.#closedByUs = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#ws?.close();
    this.#ws = null;
  }
}
