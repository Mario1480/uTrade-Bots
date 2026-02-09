import {
  BITGET_DEFAULT_PRIVATE_WS_URL,
  BITGET_DEFAULT_PRODUCT_TYPE,
  type BitgetProductType
} from "./bitget.constants.js";
import { buildWsLoginSignature } from "./bitget.signing.js";
import { BitgetWsClient } from "./bitget.ws.base.js";
import type {
  BitgetAdapterConfig,
  BitgetFillEvent,
  BitgetOrderEvent,
  BitgetPositionEvent,
  BitgetWsPayload,
  BitgetWsSubscription,
  BitgetWsSubscriptionArg
} from "./bitget.types.js";

type PrivateHandler = (payload: BitgetWsPayload) => void;

type ReconcileFn = () => Promise<void>;

function toArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "object" && item !== null) as Array<Record<string, unknown>>;
  }
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

function getString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function getNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function makeSub(args: BitgetWsSubscriptionArg[], op: "subscribe" | "unsubscribe" = "subscribe"): BitgetWsSubscription {
  return { op, args };
}

function buildArg(channel: string, instType: BitgetProductType, symbol = "default"): BitgetWsSubscriptionArg {
  return {
    instType,
    channel,
    instId: symbol
  };
}

export class BitgetPrivateWsApi {
  private readonly ws: BitgetWsClient;
  private readonly handlers = new Map<string, Set<PrivateHandler>>();

  constructor(
    private readonly config: Pick<BitgetAdapterConfig, "apiKey" | "apiSecret" | "apiPassphrase" | "privateWsUrl" | "log">,
    private readonly productType: BitgetProductType = BITGET_DEFAULT_PRODUCT_TYPE,
    private readonly reconcile?: ReconcileFn
  ) {
    this.ws = new BitgetWsClient({
      url: config.privateWsUrl ?? BITGET_DEFAULT_PRIVATE_WS_URL,
      log: config.log,
      buildAuthPayload: () => this.buildLoginPayload(),
      onReconnect: () => this.reconcile?.()
    });

    this.ws.onMessage((payload) => this.dispatch(payload));
  }

  async connect(): Promise<void> {
    await this.ws.connect();
  }

  async disconnect(): Promise<void> {
    await this.ws.disconnect();
  }

  async subscribeOrders(): Promise<void> {
    await this.ws.subscribe(makeSub([buildArg("orders", this.productType)]));
  }

  async subscribePositions(): Promise<void> {
    await this.ws.subscribe(makeSub([buildArg("positions", this.productType)]));
  }

  async subscribeFills(): Promise<void> {
    await this.ws.subscribe(makeSub([buildArg("fills", this.productType)]));
  }

  onChannel(channel: string, handler: PrivateHandler): () => void {
    const set = this.handlers.get(channel) ?? new Set<PrivateHandler>();
    set.add(handler);
    this.handlers.set(channel, set);

    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.handlers.delete(channel);
    };
  }

  onFill(handler: (event: BitgetFillEvent) => void): () => void {
    return this.onChannel("fills", (payload) => {
      const records = toArray(payload.data);
      for (const record of records) {
        const orderId = getString(record, ["orderId", "ordId"]);
        const symbol = getString(record, ["symbol", "instId"]);
        if (!orderId || !symbol) continue;

        handler({
          orderId,
          symbol,
          side: getString(record, ["side"]) ?? undefined,
          price: getNumber(record, ["fillPrice", "price"]),
          qty: getNumber(record, ["fillSize", "size"]),
          raw: record
        });
      }
    });
  }

  onPositionUpdate(handler: (event: BitgetPositionEvent) => void): () => void {
    return this.onChannel("positions", (payload) => {
      const records = toArray(payload.data);
      for (const record of records) {
        const symbol = getString(record, ["symbol", "instId"]);
        if (!symbol) continue;

        handler({
          symbol,
          side: getString(record, ["holdSide", "side"]) ?? undefined,
          size: getNumber(record, ["total", "size"]),
          raw: record
        });
      }
    });
  }

  onOrderUpdate(handler: (event: BitgetOrderEvent) => void): () => void {
    return this.onChannel("orders", (payload) => {
      const records = toArray(payload.data);
      for (const record of records) {
        const orderId = getString(record, ["orderId", "ordId"]);
        if (!orderId) continue;

        handler({
          orderId,
          symbol: getString(record, ["symbol", "instId"]) ?? undefined,
          status: getString(record, ["status", "state"]) ?? undefined,
          raw: record
        });
      }
    });
  }

  private dispatch(payload: BitgetWsPayload): void {
    const channel = payload.arg?.channel;
    if (!channel) return;

    const listeners = this.handlers.get(channel);
    if (!listeners || listeners.size === 0) return;

    for (const handler of listeners) {
      handler(payload);
    }
  }

  private buildLoginPayload(): Record<string, unknown> {
    if (!this.config.apiKey || !this.config.apiSecret || !this.config.apiPassphrase) {
      throw new Error("Bitget private websocket requires apiKey/apiSecret/apiPassphrase");
    }

    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = buildWsLoginSignature({
      timestamp,
      secretKey: this.config.apiSecret
    });

    return {
      op: "login",
      args: [
        {
          apiKey: this.config.apiKey,
          passphrase: this.config.apiPassphrase,
          timestamp,
          sign
        }
      ]
    };
  }
}
