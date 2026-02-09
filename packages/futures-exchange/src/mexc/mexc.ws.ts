import { gunzipSync } from "node:zlib";
import WebSocket from "ws";
import {
  MEXC_DEFAULT_PING_INTERVAL_MS,
  MEXC_DEFAULT_RECONNECT_BASE_DELAY_MS,
  MEXC_DEFAULT_RECONNECT_MAX_DELAY_MS,
  MEXC_DEFAULT_WS_URL
} from "./mexc.constants.js";
import type {
  MexcAdapterConfig,
  MexcWsPayload,
  MexcWsSubscription
} from "./mexc.types.js";

type WsHandler = (payload: MexcWsPayload) => void;

type MexcWsClientOptions = {
  url?: string;
  log?: MexcAdapterConfig["log"];
  pingIntervalMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  buildAuthPayload?: () => MexcWsSubscription | null | Promise<MexcWsSubscription | null>;
};

function parsePayload(raw: WebSocket.RawData): MexcWsPayload | null {
  try {
    if (typeof raw === "string") {
      return JSON.parse(raw) as MexcWsPayload;
    }

    const buffer = Array.isArray(raw)
      ? Buffer.concat(raw.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))))
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw as ArrayBuffer);
    const text = buffer.toString("utf8").trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      return JSON.parse(text) as MexcWsPayload;
    }

    const unzipped = gunzipSync(buffer).toString("utf8");
    return JSON.parse(unzipped) as MexcWsPayload;
  } catch {
    return null;
  }
}

export class MexcWsClient {
  private readonly url: string;
  private readonly pingIntervalMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly buildAuthPayload?: MexcWsClientOptions["buildAuthPayload"];

  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private manualClose = false;

  private readonly handlers = new Set<WsHandler>();
  private readonly subscriptions = new Map<string, MexcWsSubscription>();

  constructor(private readonly options: MexcWsClientOptions = {}) {
    this.url = options.url ?? MEXC_DEFAULT_WS_URL;
    this.pingIntervalMs = options.pingIntervalMs ?? MEXC_DEFAULT_PING_INTERVAL_MS;
    this.reconnectBaseDelayMs =
      options.reconnectBaseDelayMs ?? MEXC_DEFAULT_RECONNECT_BASE_DELAY_MS;
    this.reconnectMaxDelayMs =
      options.reconnectMaxDelayMs ?? MEXC_DEFAULT_RECONNECT_MAX_DELAY_MS;
    this.buildAuthPayload = options.buildAuthPayload;
  }

  onMessage(handler: WsHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.manualClose = false;
    await this.openSocket();
  }

  async disconnect(): Promise<void> {
    this.manualClose = true;
    this.clearTimers();

    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;

    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      ws.terminate();
    });
  }

  async subscribe(sub: MexcWsSubscription): Promise<void> {
    const key = JSON.stringify(sub);
    this.subscriptions.set(key, sub);
    await this.send(sub);
  }

  async unsubscribe(sub: MexcWsSubscription): Promise<void> {
    const key = JSON.stringify(sub);
    this.subscriptions.delete(key);
    await this.send(sub);
  }

  protected async send(payload: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }

  private async openSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.once("open", async () => {
        this.reconnectAttempt = 0;
        this.startPingLoop();

        try {
          if (this.buildAuthPayload) {
            const auth = await this.buildAuthPayload();
            if (auth) await this.send(auth);
          }

          for (const sub of this.subscriptions.values()) {
            await this.send(sub);
          }
        } catch (error) {
          this.options.log?.({
            at: new Date().toISOString(),
            endpoint: "ws-auth",
            method: "GET",
            durationMs: 0,
            ok: false,
            message: String(error)
          });
        }

        resolve();
      });

      ws.on("message", (raw) => {
        const payload = parsePayload(raw);
        if (!payload) return;
        if (payload.channel === "pong" || payload.method === "pong") return;

        for (const handler of this.handlers) {
          handler(payload);
        }
      });

      ws.on("error", (error) => {
        this.options.log?.({
          at: new Date().toISOString(),
          endpoint: "ws",
          method: "GET",
          durationMs: 0,
          ok: false,
          message: String(error)
        });
      });

      ws.on("close", () => {
        this.clearTimers();
        if (this.manualClose) return;
        void this.scheduleReconnect();
      });

      ws.once("unexpected-response", () => {
        reject(new Error("MEXC websocket unexpected response"));
      });

      ws.once("error", (error) => {
        reject(error);
      });
    });
  }

  private startPingLoop() {
    this.pingTimer = setInterval(() => {
      void this.send({ method: "ping" });
    }, this.pingIntervalMs);
  }

  private async scheduleReconnect() {
    this.reconnectAttempt += 1;
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** (this.reconnectAttempt - 1),
      this.reconnectMaxDelayMs
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualClose) return;
      void this.openSocket().catch(() => {
        void this.scheduleReconnect();
      });
    }, delay);
  }
}
