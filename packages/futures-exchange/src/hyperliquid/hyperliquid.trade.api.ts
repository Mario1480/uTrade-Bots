import type {
  FrontendOpenOrders,
  Hyperliquid,
  Order,
  UserOrderHistory
} from "hyperliquid";
import { HYPERLIQUID_DEFAULT_PRODUCT_TYPE, HYPERLIQUID_ZERO_ADDRESS } from "./hyperliquid.constants.js";
import { parseCoinFromAnySymbol, toInternalPerpSymbol } from "./hyperliquid.symbols.js";
import type {
  HyperliquidOrderModifyRequest,
  HyperliquidOrderPlaceRequest,
  HyperliquidOrderRaw,
  HyperliquidPositionTpSlRequest,
  HyperliquidProductType
} from "./hyperliquid.types.js";

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

function toSide(value: unknown): "buy" | "sell" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "b" || normalized.includes("buy") || normalized.includes("long")) return "buy";
  return "sell";
}

function toTif(force: string | undefined, isMarket: boolean): "Gtc" | "Ioc" | "Alo" {
  if (isMarket) return "Ioc";
  const normalized = String(force ?? "").trim().toLowerCase();
  if (normalized === "ioc") return "Ioc";
  if (normalized === "post_only") return "Alo";
  return "Gtc";
}

function parsePlacedOrderId(response: unknown): string | null {
  const record = response && typeof response === "object" ? (response as Record<string, unknown>) : null;
  if (!record) return null;

  const direct = record.orderId ?? record.oid;
  if (direct !== undefined && direct !== null && String(direct).trim()) {
    return String(direct).trim();
  }

  const responseRecord =
    record.response && typeof record.response === "object"
      ? (record.response as Record<string, unknown>)
      : null;
  const dataRecord =
    responseRecord?.data && typeof responseRecord.data === "object"
      ? (responseRecord.data as Record<string, unknown>)
      : null;

  const statuses = Array.isArray(dataRecord?.statuses) ? dataRecord.statuses : [];
  for (const status of statuses) {
    const statusRecord = status && typeof status === "object" ? (status as Record<string, unknown>) : null;
    if (!statusRecord) continue;

    const resting = statusRecord.resting && typeof statusRecord.resting === "object"
      ? (statusRecord.resting as Record<string, unknown>)
      : null;
    const filled = statusRecord.filled && typeof statusRecord.filled === "object"
      ? (statusRecord.filled as Record<string, unknown>)
      : null;

    const oid = resting?.oid ?? filled?.oid;
    if (oid !== undefined && oid !== null && String(oid).trim()) {
      return String(oid).trim();
    }
  }

  return null;
}

function mapFrontendOrder(row: FrontendOpenOrders[number]): HyperliquidOrderRaw {
  return {
    orderId: String(row.oid),
    symbol: toInternalPerpSymbol(row.coin),
    price: String(row.limitPx),
    size: String(row.sz || row.origSz || "0"),
    side: toSide(row.side),
    orderType: row.isTrigger ? "trigger" : String(row.orderType ?? "limit"),
    status: "open",
    cTime: String(row.timestamp ?? Date.now()),
    triggerPrice: row.triggerPx ? String(row.triggerPx) : undefined,
    planType: row.isTrigger
      ? String(row.triggerCondition ?? "").toLowerCase().includes("tp")
        ? "profit_plan"
        : "loss_plan"
      : undefined,
    reduceOnly: Boolean(row.reduceOnly),
    raw: row
  };
}

function mapHistoryOrder(row: UserOrderHistory[number]): HyperliquidOrderRaw {
  const order = row.order;
  return {
    orderId: String(order.oid),
    symbol: toInternalPerpSymbol(order.coin),
    price: String(order.limitPx),
    size: String(order.sz || order.origSz || "0"),
    side: toSide(order.side),
    orderType: order.isTrigger ? "trigger" : String(order.orderType ?? "limit"),
    status: row.status,
    cTime: String(order.timestamp ?? row.statusTimestamp ?? Date.now()),
    triggerPrice: order.triggerPx ? String(order.triggerPx) : undefined,
    planType: order.isTrigger
      ? String(order.triggerCondition ?? "").toLowerCase().includes("tp")
        ? "profit_plan"
        : "loss_plan"
      : undefined,
    reduceOnly: Boolean(order.reduceOnly),
    raw: row
  };
}

export class HyperliquidTradeApi {
  constructor(
    private readonly sdk: Hyperliquid,
    private readonly userAddress: string,
    private readonly hasSigning: boolean
  ) {}

  private assertTradingReady(): void {
    if (!this.hasSigning) {
      throw new Error("Hyperliquid trading requires private key (apiSecret)");
    }
    const user = String(this.userAddress ?? "").trim();
    if (!user || user.toLowerCase() === HYPERLIQUID_ZERO_ADDRESS) {
      throw new Error("Hyperliquid trading requires wallet address (apiKey)");
    }
  }

  private async getAggressiveMarketPrice(symbol: string, side: "buy" | "sell"): Promise<number> {
    const coin = parseCoinFromAnySymbol(symbol);
    const allMids = await this.sdk.info.getAllMids(true);
    const mid = toNumber((allMids as Record<string, string>)[coin]);
    if (!mid || mid <= 0) {
      throw new Error(`hyperliquid_mid_unavailable:${coin}`);
    }
    const slippageBps = Math.max(1, Number(process.env.HYPERLIQUID_MARKET_IOC_SLIPPAGE_BPS ?? "30"));
    const multiplier = side === "buy" ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000;
    return Number((mid * multiplier).toFixed(8));
  }

  private async placeTriggerOrder(params: {
    symbol: string;
    side: "buy" | "sell";
    size: number;
    triggerPrice: number;
    triggerType: "tp" | "sl";
  }): Promise<string | null> {
    this.assertTradingReady();

    const response = await this.sdk.exchange.placeOrder({
      coin: params.symbol,
      is_buy: params.side === "buy",
      sz: params.size,
      limit_px: params.triggerPrice,
      order_type: {
        trigger: {
          triggerPx: params.triggerPrice,
          isMarket: true,
          tpsl: params.triggerType
        }
      },
      reduce_only: true,
      grouping: "positionTpsl"
    });

    return parsePlacedOrderId(response);
  }

  async placeOrder(payload: HyperliquidOrderPlaceRequest): Promise<{ orderId?: string; clientOid?: string }> {
    this.assertTradingReady();

    const size = Number(payload.size);
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error("hyperliquid_invalid_size");
    }

    const side = payload.side;
    const isMarket = payload.orderType === "market";
    const limitPrice = isMarket
      ? await this.getAggressiveMarketPrice(payload.symbol, side)
      : Number(payload.price);

    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      throw new Error("hyperliquid_invalid_price");
    }

    const orderRequest: Order = {
      coin: payload.symbol,
      is_buy: side === "buy",
      sz: size,
      limit_px: limitPrice,
      order_type: {
        limit: {
          tif: toTif(payload.force, isMarket)
        }
      },
      reduce_only: toBool(payload.reduceOnly)
    };

    const placed = await this.sdk.exchange.placeOrder(orderRequest);
    const orderId = parsePlacedOrderId(placed) ?? undefined;

    const closeSide: "buy" | "sell" = side === "buy" ? "sell" : "buy";
    const tp = toNumber(payload.presetStopSurplusPrice);
    const sl = toNumber(payload.presetStopLossPrice);

    if (tp && tp > 0) {
      await this.placeTriggerOrder({
        symbol: payload.symbol,
        side: closeSide,
        size,
        triggerPrice: tp,
        triggerType: "tp"
      });
    }
    if (sl && sl > 0) {
      await this.placeTriggerOrder({
        symbol: payload.symbol,
        side: closeSide,
        size,
        triggerPrice: sl,
        triggerType: "sl"
      });
    }

    return {
      orderId,
      clientOid: payload.clientOid
    };
  }

  async modifyOrder(payload: HyperliquidOrderModifyRequest): Promise<unknown> {
    this.assertTradingReady();

    const orderId = String(payload.orderId ?? "").trim();
    if (!orderId) {
      throw new Error("hyperliquid_order_id_required");
    }

    const detail = await this.getOrderDetail({
      symbol: payload.symbol,
      orderId
    });

    const size = toNumber(payload.newSize ?? detail.size);
    const price = toNumber(payload.newPrice ?? detail.price);

    if (!size || size <= 0) {
      throw new Error("hyperliquid_invalid_size");
    }
    if (!price || price <= 0) {
      throw new Error("hyperliquid_invalid_price");
    }

    await this.cancelOrder({
      symbol: payload.symbol,
      orderId,
      productType: payload.productType ?? HYPERLIQUID_DEFAULT_PRODUCT_TYPE
    });

    const currentType = String(detail.orderType ?? "").toLowerCase();
    const isTrigger = currentType.includes("trigger") || String(detail.planType ?? "").length > 0;

    if (isTrigger) {
      const triggerPrice = toNumber(payload.newPrice ?? payload.newPresetStopSurplusPrice ?? payload.newPresetStopLossPrice ?? detail.triggerPrice);
      if (!triggerPrice || triggerPrice <= 0) {
        throw new Error("hyperliquid_invalid_trigger_price");
      }
      const triggerType: "tp" | "sl" =
        String(detail.planType ?? "").toLowerCase().includes("profit") ||
        String(detail.triggerPrice ?? "").toLowerCase().includes("tp")
          ? "tp"
          : "sl";
      const triggerOrderId = await this.placeTriggerOrder({
        symbol: payload.symbol,
        side: toSide(detail.side),
        size,
        triggerPrice,
        triggerType
      });
      return {
        orderId: triggerOrderId ?? orderId
      };
    }

    return this.placeOrder({
      symbol: payload.symbol,
      side: toSide(detail.side),
      orderType: "limit",
      size: String(size),
      price: String(price),
      reduceOnly: toBool(detail.reduceOnly) ? "YES" : "NO",
      force: "gtc"
    });
  }

  async cancelOrder(params: {
    symbol: string;
    orderId?: string;
    clientOid?: string;
    productType?: HyperliquidProductType;
  }): Promise<unknown> {
    this.assertTradingReady();

    const rawOrderId = String(params.orderId ?? "").trim();
    if (!rawOrderId) throw new Error("hyperliquid_order_id_required");

    const numericOrderId = Number(rawOrderId);
    if (!Number.isFinite(numericOrderId) || numericOrderId <= 0) {
      return this.sdk.exchange.cancelOrderByCloid(params.symbol, rawOrderId);
    }

    return this.sdk.exchange.cancelOrder({
      coin: params.symbol,
      o: Math.trunc(numericOrderId)
    });
  }

  async getPendingOrders(params: {
    productType?: HyperliquidProductType;
    symbol?: string;
    pageSize?: number;
    idLessThan?: string;
  } = {}): Promise<HyperliquidOrderRaw[]> {
    const rows = await this.sdk.info.getFrontendOpenOrders(this.userAddress, true);
    const symbol = params.symbol ? String(params.symbol).toUpperCase() : null;

    return (Array.isArray(rows) ? rows : [])
      .filter((row) => !row.isTrigger)
      .map((row) => mapFrontendOrder(row))
      .filter((row) => (symbol ? String(row.symbol ?? "").toUpperCase() === symbol : true))
      .slice(0, Math.max(1, Number(params.pageSize ?? 100)));
  }

  async getPendingPlanOrders(params: {
    productType?: HyperliquidProductType;
    symbol?: string;
    pageSize?: number;
    idLessThan?: string;
  } = {}): Promise<HyperliquidOrderRaw[]> {
    const rows = await this.sdk.info.getFrontendOpenOrders(this.userAddress, true);
    const symbol = params.symbol ? String(params.symbol).toUpperCase() : null;

    return (Array.isArray(rows) ? rows : [])
      .filter((row) => Boolean(row.isTrigger))
      .map((row) => mapFrontendOrder(row))
      .filter((row) => (symbol ? String(row.symbol ?? "").toUpperCase() === symbol : true))
      .slice(0, Math.max(1, Number(params.pageSize ?? 100)));
  }

  async placePositionTpSl(payload: HyperliquidPositionTpSlRequest): Promise<unknown> {
    this.assertTradingReady();

    const state = await this.sdk.info.perpetuals.getClearinghouseState(this.userAddress, true);
    const coin = parseCoinFromAnySymbol(payload.symbol);
    const position = (Array.isArray(state?.assetPositions) ? state.assetPositions : [])
      .map((row) => row?.position)
      .find((row) => String(row?.coin ?? "").toUpperCase() === coin);

    const size = Math.abs(Number(position?.szi ?? 0));
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error("hyperliquid_position_not_found");
    }

    const triggerPrice = Number(payload.triggerPrice);
    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
      throw new Error("hyperliquid_invalid_trigger_price");
    }

    const side: "buy" | "sell" = payload.holdSide === "long" ? "sell" : "buy";
    const triggerType: "tp" | "sl" = payload.planType === "profit_plan" ? "tp" : "sl";

    return this.placeTriggerOrder({
      symbol: payload.symbol,
      side,
      size,
      triggerPrice,
      triggerType
    });
  }

  async cancelPlanOrder(params: {
    symbol: string;
    orderId: string;
    productType?: HyperliquidProductType;
  }): Promise<unknown> {
    return this.cancelOrder({
      symbol: params.symbol,
      orderId: params.orderId,
      productType: params.productType
    });
  }

  async getOrderDetail(params: {
    symbol: string;
    orderId?: string;
    clientOid?: string;
  }): Promise<HyperliquidOrderRaw> {
    const orderId = String(params.orderId ?? "").trim();

    if (orderId) {
      const openRows = await this.sdk.info.getFrontendOpenOrders(this.userAddress, true);
      const openMatch = (Array.isArray(openRows) ? openRows : [])
        .map((row) => mapFrontendOrder(row))
        .find((row) => String(row.orderId ?? "") === orderId);
      if (openMatch) return openMatch;

      const now = Date.now();
      const start = now - 14 * 24 * 60 * 60 * 1000;
      const historyRows = await this.sdk.info.getUserOrderHistory(this.userAddress, start, now, true);
      const historyMatch = (Array.isArray(historyRows) ? historyRows : [])
        .map((row) => mapHistoryOrder(row))
        .find((row) => String(row.orderId ?? "") === orderId);
      if (historyMatch) return historyMatch;
    }

    throw new Error(`hyperliquid_order_not_found:${orderId || "unknown"}`);
  }

  async getFills(params: {
    symbol?: string;
    orderId?: string;
    productType?: HyperliquidProductType;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown> {
    const fills = await this.sdk.info.getUserFills(this.userAddress, true);
    const symbol = params.symbol ? String(params.symbol).toUpperCase() : null;
    const orderId = params.orderId ? String(params.orderId) : null;

    return (Array.isArray(fills) ? fills : [])
      .filter((row) => (symbol ? toInternalPerpSymbol(String(row.coin ?? "")) === symbol : true))
      .filter((row) => (orderId ? String(row.oid ?? "") === orderId : true))
      .slice(0, Math.max(1, Number(params.limit ?? 100)));
  }
}
