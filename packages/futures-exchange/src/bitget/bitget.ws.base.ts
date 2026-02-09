import WebSocket from "ws";
import {
  BITGET_DEFAULT_PING_INTERVAL_MS,
  BITGET_DEFAULT_RECONNECT_BASE_DELAY_MS,
  BITGET_DEFAULT_RECONNECT_MAX_DELAY_MS
} from "./bitget.constants.js";
import type { BitgetAdapterConfig, BitgetWsPayload, BitgetWsSubscription } from "./bitget.types.js";

type WsHandler = (payload: BitgetWsPayload) => void;

type BitgetWsClientOptions = {
  url: string;
  log?: BitgetAdapterConfig["log"];
  pingIntervalMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  buildAuthPayload?: () => unknown | null | Promise<unknown | null>;
  onReconnect?: () => void | Promise<void>;
};

function safeParse(raw: WebSocket.RawData): BitgetWsPayload | null {
  try {
    if (typeof raw === "string") {
      if (raw === "pong") return { event: "pong" };
      return JSON.parse(raw) as BitgetWsPayload;
    }

    const buffer = Array.isArray(raw)
      ? Buffer.concat(raw.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part))))
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw as ArrayBuffer);

    const text = buffer.toString("utf8").trim();
    if (!text) return null;
    if (text === "pong") return { event: "pong" };

    return JSON.parse(text) as BitgetWsPayload;
  } catch {
    return null;
  }
}

export class BitgetWsClient {
  private readonly pingIntervalMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;

  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private manualClose = false;

  private readonly handlers = new Set<WsHandler>();
  private readonly subscriptions = new Map<string, BitgetWsSubscription>();

  constructor(private readonly options: BitgetWsClientOptions) {
    this.pingIntervalMs = options.pingIntervalMs ?? BITGET_DEFAULT_PING_INTERVAL_MS;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? BITGET_DEFAULT_RECONNECT_BASE_DELAY_MS;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? BITGET_DEFAULT_RECONNECT_MAX_DELAY_MS;
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
      if (ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const timeout = setTimeout(done, 750);
      ws.once("close", () => {
        clearTimeout(timeout);
        done();
      });
      ws.once("error", () => {
        clearTimeout(timeout);
        done();
      });

      try {
        if (ws.readyState === WebSocket.CONNECTING) {
          // Avoid close/terminate on CONNECTING: ws can throw synchronously before handshake.
          clearTimeout(timeout);
          done();
          return;
        }
        ws.terminate();
      } catch {
        clearTimeout(timeout);
        done();
      }
    });
  }

  async subscribe(sub: BitgetWsSubscription): Promise<void> {
    const key = JSON.stringify(sub.args);
    this.subscriptions.set(key, sub);
    await this.send(sub);
  }

  async unsubscribe(sub: BitgetWsSubscription): Promise<void> {
    const key = JSON.stringify(sub.args);
    this.subscriptions.delete(key);
    await this.send(sub);
  }

  protected async send(payload: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (payload === "ping") {
      this.ws.send("ping");
      return;
    }

    this.ws.send(JSON.stringify(payload));
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }

  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      void this.send("ping");
    }, this.pingIntervalMs);
  }

  private async openSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.options.url);
      this.ws = ws;

      ws.once("open", async () => {
        this.reconnectAttempt = 0;
        this.startPingLoop();

        try {
          if (this.options.buildAuthPayload) {
            const payload = await this.options.buildAuthPayload();
            if (payload) await this.send(payload);
          }

          for (const sub of this.subscriptions.values()) {
            await this.send(sub);
          }

          if (this.options.onReconnect) {
            await this.options.onReconnect();
          }
        } catch (error) {
          this.options.log?.({
            at: new Date().toISOString(),
            endpoint: "ws",
            method: "GET",
            durationMs: 0,
            ok: false,
            message: String(error)
          });
        }

        resolve();
      });

      ws.on("message", (raw) => {
        const payload = safeParse(raw);
        if (!payload) return;
        if (payload.event === "pong") return;

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
        this.scheduleReconnect();
      });

      ws.once("error", (error) => reject(error));
      ws.once("unexpected-response", () => reject(new Error("Bitget websocket unexpected response")));
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** (this.reconnectAttempt - 1),
      this.reconnectMaxDelayMs
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualClose) return;
      void this.openSocket().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }
}
