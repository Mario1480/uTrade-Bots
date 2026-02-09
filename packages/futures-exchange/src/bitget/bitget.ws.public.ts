import {
  BITGET_DEFAULT_PRODUCT_TYPE,
  BITGET_DEFAULT_PUBLIC_WS_URL,
  type BitgetProductType
} from "./bitget.constants.js";
import { BitgetWsClient } from "./bitget.ws.base.js";
import type {
  BitgetAdapterConfig,
  BitgetWsPayload,
  BitgetWsSubscription,
  BitgetWsSubscriptionArg
} from "./bitget.types.js";

type PublicHandler = (payload: BitgetWsPayload) => void;

function makeSub(args: BitgetWsSubscriptionArg[], op: "subscribe" | "unsubscribe" = "subscribe"): BitgetWsSubscription {
  return { op, args };
}

function buildArg(channel: string, symbol: string, productType: BitgetProductType): BitgetWsSubscriptionArg {
  return {
    instType: productType,
    channel,
    instId: symbol
  };
}

export class BitgetPublicWsApi {
  private readonly ws: BitgetWsClient;
  private readonly handlers = new Map<string, Set<PublicHandler>>();

  constructor(
    config: Pick<BitgetAdapterConfig, "publicWsUrl" | "log"> = {},
    private readonly productType: BitgetProductType = BITGET_DEFAULT_PRODUCT_TYPE
  ) {
    this.ws = new BitgetWsClient({
      url: config.publicWsUrl ?? BITGET_DEFAULT_PUBLIC_WS_URL,
      log: config.log
    });

    this.ws.onMessage((payload) => this.dispatch(payload));
  }

  async connect(): Promise<void> {
    await this.ws.connect();
  }

  async disconnect(): Promise<void> {
    await this.ws.disconnect();
  }

  async subscribeTicker(symbol: string): Promise<void> {
    await this.ws.subscribe(makeSub([buildArg("ticker", symbol, this.productType)]));
  }

  async unsubscribeTicker(symbol: string): Promise<void> {
    await this.ws.unsubscribe(makeSub([buildArg("ticker", symbol, this.productType)], "unsubscribe"));
  }

  async subscribeDepth(symbol: string): Promise<void> {
    await this.ws.subscribe(makeSub([buildArg("books", symbol, this.productType)]));
  }

  async unsubscribeDepth(symbol: string): Promise<void> {
    await this.ws.unsubscribe(makeSub([buildArg("books", symbol, this.productType)], "unsubscribe"));
  }

  async subscribeTrades(symbol: string): Promise<void> {
    await this.ws.subscribe(makeSub([buildArg("trade", symbol, this.productType)]));
  }

  async unsubscribeTrades(symbol: string): Promise<void> {
    await this.ws.unsubscribe(makeSub([buildArg("trade", symbol, this.productType)], "unsubscribe"));
  }

  async subscribeCandle(symbol: string, interval = "candle1m"): Promise<void> {
    await this.ws.subscribe(makeSub([buildArg(interval, symbol, this.productType)]));
  }

  async unsubscribeCandle(symbol: string, interval = "candle1m"): Promise<void> {
    await this.ws.unsubscribe(makeSub([buildArg(interval, symbol, this.productType)], "unsubscribe"));
  }

  onChannel(channel: string, handler: PublicHandler): () => void {
    const set = this.handlers.get(channel) ?? new Set<PublicHandler>();
    set.add(handler);
    this.handlers.set(channel, set);

    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.handlers.delete(channel);
    };
  }

  onTicker(handler: PublicHandler): () => void {
    return this.onChannel("ticker", handler);
  }

  onDepth(handler: PublicHandler): () => void {
    return this.onChannel("books", handler);
  }

  onTrades(handler: PublicHandler): () => void {
    return this.onChannel("trade", handler);
  }

  onCandle(interval: string, handler: PublicHandler): () => void {
    return this.onChannel(interval, handler);
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
}
