import { buildWsSignature } from "./mexc.signing.js";
import { MexcWsClient } from "./mexc.ws.js";
import type {
  MexcAdapterConfig,
  MexcFillEvent,
  MexcOrderEvent,
  MexcPositionEvent,
  MexcWsPayload,
  MexcWsSubscription
} from "./mexc.types.js";

type PrivateChannelHandler = (payload: MexcWsPayload) => void;

type MexcWsFilter = {
  filter: string;
  rules?: string[];
};

function toArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "object" && item !== null) as Array<Record<string, unknown>>;
  }
  if (typeof value === "object" && value !== null) {
    return [value as Record<string, unknown>];
  }
  return [];
}

function findString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function findNumber(data: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key];
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

export class MexcPrivateWsApi {
  private readonly ws: MexcWsClient;
  private readonly handlers = new Map<string, Set<PrivateChannelHandler>>();
  private subscribeOnLogin = true;

  constructor(private readonly config: Pick<MexcAdapterConfig, "apiKey" | "apiSecret" | "wsUrl" | "log">) {
    this.ws = new MexcWsClient({
      url: config.wsUrl,
      log: config.log,
      buildAuthPayload: () => this.buildLoginPayload()
    });

    this.ws.onMessage((payload) => this.dispatch(payload));
  }

  async connect(options: { subscribeDefault?: boolean } = {}): Promise<void> {
    this.subscribeOnLogin = options.subscribeDefault !== false;
    await this.ws.connect();
  }

  async disconnect(): Promise<void> {
    await this.ws.disconnect();
  }

  async applyFilter(filters: MexcWsFilter[]): Promise<void> {
    const payload: MexcWsSubscription = {
      method: "personal.filter",
      param: {
        filters
      }
    };
    await this.ws.subscribe(payload);
  }

  async subscribeAllPrivate(): Promise<void> {
    await this.applyFilter([]);
  }

  async subscribePrivateChannel(filter: string, rules?: string[]): Promise<void> {
    await this.applyFilter([{ filter, rules }]);
  }

  onChannel(channel: string, handler: PrivateChannelHandler): () => void {
    const set = this.handlers.get(channel) ?? new Set<PrivateChannelHandler>();
    set.add(handler);
    this.handlers.set(channel, set);

    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.handlers.delete(channel);
    };
  }

  onFill(handler: (event: MexcFillEvent) => void): () => void {
    return this.onChannel("push.personal.order.deal", (payload) => {
      const records = toArray(payload.data);
      for (const record of records) {
        const orderId = findString(record, ["orderId", "order_id"]);
        const symbol = findString(record, ["symbol"]);
        if (!orderId || !symbol) continue;

        handler({
          orderId,
          symbol,
          side: findString(record, ["side"])?.toLowerCase() ?? undefined,
          price: findNumber(record, ["price", "dealPrice", "deal_price"]),
          qty: findNumber(record, ["vol", "dealVol", "deal_vol"]),
          raw: record
        });
      }
    });
  }

  onPositionUpdate(handler: (event: MexcPositionEvent) => void): () => void {
    return this.onChannel("push.personal.position", (payload) => {
      const records = toArray(payload.data);
      for (const record of records) {
        const symbol = findString(record, ["symbol"]);
        if (!symbol) continue;

        handler({
          symbol,
          side: findString(record, ["positionType", "position_type"]) ?? undefined,
          size: findNumber(record, ["positionVol", "holdVol", "vol"]),
          raw: record
        });
      }
    });
  }

  onOrderUpdate(handler: (event: MexcOrderEvent) => void): () => void {
    return this.onChannel("push.personal.order", (payload) => {
      const records = toArray(payload.data);
      for (const record of records) {
        const orderId = findString(record, ["orderId", "order_id"]);
        if (!orderId) continue;

        handler({
          orderId,
          symbol: findString(record, ["symbol"]) ?? undefined,
          status: findString(record, ["state", "status"]) ?? undefined,
          raw: record
        });
      }
    });
  }

  private dispatch(payload: MexcWsPayload): void {
    const channel = typeof payload.channel === "string" ? payload.channel : null;
    if (!channel) return;

    const listeners = this.handlers.get(channel);
    if (!listeners || listeners.size === 0) return;

    for (const handler of listeners) {
      handler(payload);
    }
  }

  private buildLoginPayload(): MexcWsSubscription {
    if (!this.config.apiKey || !this.config.apiSecret) {
      throw new Error("MEXC private websocket requires apiKey/apiSecret");
    }

    const reqTime = String(Date.now());
    const signature = buildWsSignature({
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
      timestampMs: reqTime
    });

    const payload: MexcWsSubscription = {
      method: "login",
      param: {
        apiKey: this.config.apiKey,
        reqTime,
        signature
      }
    };

    if (!this.subscribeOnLogin) {
      payload.subscribe = false;
    }

    return payload;
  }
}
