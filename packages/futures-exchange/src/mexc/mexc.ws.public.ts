import { MexcWsClient } from "./mexc.ws.js";
import type {
  MexcAdapterConfig,
  MexcWsPayload,
  MexcWsSubscription
} from "./mexc.types.js";

type PublicEventHandler = (payload: MexcWsPayload) => void;

function makeSub(method: string, param: Record<string, unknown>): MexcWsSubscription {
  return { method, param };
}

export class MexcPublicWsApi {
  private readonly ws: MexcWsClient;
  private readonly handlers = new Map<string, Set<PublicEventHandler>>();

  constructor(config: Pick<MexcAdapterConfig, "wsUrl" | "log"> = {}) {
    this.ws = new MexcWsClient({
      url: config.wsUrl,
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

  async subscribeTickers(): Promise<void> {
    await this.ws.subscribe(makeSub("sub.tickers", {}));
  }

  async unsubscribeTickers(): Promise<void> {
    await this.ws.unsubscribe(makeSub("unsub.tickers", {}));
  }

  async subscribeTicker(symbol: string): Promise<void> {
    await this.ws.subscribe(makeSub("sub.ticker", { symbol }));
  }

  async unsubscribeTicker(symbol: string): Promise<void> {
    await this.ws.unsubscribe(makeSub("unsub.ticker", { symbol }));
  }

  async subscribeDepth(symbol: string, limit = 20): Promise<void> {
    await this.ws.subscribe(makeSub("sub.depth", { symbol, limit }));
  }

  async unsubscribeDepth(symbol: string): Promise<void> {
    await this.ws.unsubscribe(makeSub("unsub.depth", { symbol }));
  }

  async subscribeDepthStep(symbol: string, level = 1): Promise<void> {
    await this.ws.subscribe(makeSub("sub.depth.step", { symbol, level }));
  }

  async unsubscribeDepthStep(symbol: string, level = 1): Promise<void> {
    await this.ws.unsubscribe(makeSub("unsub.depth.step", { symbol, level }));
  }

  async subscribeDepthFull(symbol: string, level = 1): Promise<void> {
    await this.ws.subscribe(makeSub("sub.depth.full", { symbol, level }));
  }

  async unsubscribeDepthFull(symbol: string, level = 1): Promise<void> {
    await this.ws.unsubscribe(makeSub("unsub.depth.full", { symbol, level }));
  }

  async subscribeKline(symbol: string, interval: string): Promise<void> {
    await this.ws.subscribe(makeSub("sub.kline", { symbol, interval }));
  }

  async unsubscribeKline(symbol: string, interval: string): Promise<void> {
    await this.ws.unsubscribe(makeSub("unsub.kline", { symbol, interval }));
  }

  async subscribeFairPrice(symbol: string): Promise<void> {
    await this.ws.subscribe(makeSub("sub.fair.price", { symbol }));
  }

  async unsubscribeFairPrice(symbol: string): Promise<void> {
    await this.ws.unsubscribe(makeSub("unsub.fair.price", { symbol }));
  }

  async subscribeContract(symbol?: string): Promise<void> {
    await this.ws.subscribe(makeSub("sub.contract", symbol ? { symbol } : {}));
  }

  async unsubscribeContract(symbol?: string): Promise<void> {
    await this.ws.unsubscribe(makeSub("unsub.contract", symbol ? { symbol } : {}));
  }

  onChannel(channel: string, handler: PublicEventHandler): () => void {
    const set = this.handlers.get(channel) ?? new Set<PublicEventHandler>();
    set.add(handler);
    this.handlers.set(channel, set);
    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.handlers.delete(channel);
    };
  }

  onTicker(handler: PublicEventHandler): () => void {
    const unsubscribeA = this.onChannel("push.ticker", handler);
    const unsubscribeB = this.onChannel("push.tickers", handler);
    return () => {
      unsubscribeA();
      unsubscribeB();
    };
  }

  onDepth(handler: PublicEventHandler): () => void {
    return this.onChannel("push.depth", handler);
  }

  onKline(handler: PublicEventHandler): () => void {
    return this.onChannel("push.kline", handler);
  }

  onFairPrice(handler: PublicEventHandler): () => void {
    return this.onChannel("push.fair.price", handler);
  }

  onContract(handler: PublicEventHandler): () => void {
    return this.onChannel("push.contract", handler);
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
}
