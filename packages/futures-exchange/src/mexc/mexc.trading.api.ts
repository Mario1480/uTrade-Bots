import { MEXC_MAINTENANCE_ENDPOINTS } from "./mexc.constants.js";
import { MexcInvalidParamsError, MexcMaintenanceError } from "./mexc.errors.js";
import { MexcRestClient } from "./mexc.rest.js";
import type {
  MexcCapabilities,
  MexcOrderResponse,
  MexcPlaceOrderRequest
} from "./mexc.types.js";

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(normalized);
}

function assertNonEmpty(value: unknown, message: string): string {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new MexcInvalidParamsError(message, {
      endpoint: "/api/v1/private/order",
      method: "POST"
    });
  }
  return text;
}

function toRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const candidates = [record.entrustedList, record.orderList, record.list, record.rows, record.data];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  return [];
}

export function createDefaultMexcCapabilities(): MexcCapabilities {
  const orderWritesEnabled = envFlag("MEXC_ORDER_WRITE_ENABLED", false);
  const advancedOrdersEnabled = orderWritesEnabled && envFlag("MEXC_ADVANCED_ORDERS_ENABLED", false);

  return {
    placeOrder: orderWritesEnabled,
    batchPlaceOrder: orderWritesEnabled,
    cancelOrder: orderWritesEnabled,
    cancelWithExternal: orderWritesEnabled,
    cancelAll: orderWritesEnabled,
    stopOrders: advancedOrdersEnabled,
    planOrders: advancedOrdersEnabled,

    // Stable account toggles.
    positionModeChange: true,
    leverageChange: true,
    privateWs: true
  };
}

function assertCapability(enabled: boolean, endpoint: string, capabilityName: keyof MexcCapabilities) {
  if (enabled) return;
  const maintenanceHint = MEXC_MAINTENANCE_ENDPOINTS.has(endpoint)
    ? " (MEXC endpoint marked under maintenance)"
    : "";

  throw new MexcMaintenanceError(
    `MEXC capability '${capabilityName}' is disabled for endpoint ${endpoint}${maintenanceHint}`,
    {
      endpoint,
      method: "POST",
      status: 409
    }
  );
}

export class MexcTradingApi {
  constructor(
    private readonly rest: MexcRestClient,
    private readonly capabilities: MexcCapabilities
  ) {}

  submitOrder(payload: MexcPlaceOrderRequest): Promise<MexcOrderResponse> {
    const endpoint = "/api/v1/private/order/submit";
    assertCapability(this.capabilities.placeOrder, endpoint, "placeOrder");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: payload
    });
  }

  submitBatchOrders(payload: MexcPlaceOrderRequest[]): Promise<unknown> {
    const endpoint = "/api/v1/private/order/submit_batch";
    assertCapability(this.capabilities.batchPlaceOrder, endpoint, "batchPlaceOrder");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: payload
    });
  }

  cancelOrder(orderId: string): Promise<unknown>;
  cancelOrder(params: {
    symbol?: string;
    orderId?: string;
    clientOid?: string;
    productType?: string;
  }): Promise<unknown>;
  cancelOrder(
    input:
      | string
      | {
          symbol?: string;
          orderId?: string;
          clientOid?: string;
          productType?: string;
        }
  ): Promise<unknown> {
    if (typeof input === "string") {
      const endpoint = "/api/v1/private/order/cancel";
      assertCapability(this.capabilities.cancelOrder, endpoint, "cancelOrder");
      return this.rest.requestPrivate({
        method: "POST",
        endpoint,
        body: {
          order_id: input
        }
      });
    }

    const orderId = String(input.orderId ?? "").trim();
    if (orderId) {
      return this.cancelOrder(orderId);
    }

    const clientOid = String(input.clientOid ?? "").trim();
    if (clientOid) {
      const symbol = assertNonEmpty(input.symbol, "MEXC cancel-with-external requires symbol");
      return this.cancelWithExternal(symbol, clientOid);
    }

    throw new MexcInvalidParamsError("MEXC cancelOrder requires orderId or clientOid", {
      endpoint: "/api/v1/private/order/cancel",
      method: "POST"
    });
  }

  cancelWithExternal(symbol: string, externalOid: string): Promise<unknown> {
    const endpoint = "/api/v1/private/order/cancel_with_external";
    assertCapability(this.capabilities.cancelWithExternal, endpoint, "cancelWithExternal");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: {
        symbol,
        external_oid: externalOid
      }
    });
  }

  cancelAll(symbol: string): Promise<unknown> {
    const endpoint = "/api/v1/private/order/cancel_all";
    assertCapability(this.capabilities.cancelAll, endpoint, "cancelAll");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: {
        symbol
      }
    });
  }

  getOrder(orderId: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: `/api/v1/private/order/get/${orderId}`
    });
  }

  getOrderByExternal(symbol: string, externalOid: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: `/api/v1/private/order/external/${symbol}/${externalOid}`
    });
  }

  batchQueryOrders(orderIds: string[]): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/order/batch_query",
      query: {
        order_ids: orderIds.join(",")
      }
    });
  }

  listOpenOrders(symbol: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: `/api/v1/private/order/list/open_orders/${symbol}`
    });
  }

  getPendingOrders(params: {
    productType?: string;
    symbol?: string;
    pageSize?: number;
    idLessThan?: string;
  } = {}): Promise<unknown> {
    const symbol = String(params.symbol ?? "").trim();
    if (!symbol) return Promise.resolve([]);
    return this.listOpenOrders(symbol);
  }

  listHistoryOrders(params?: { symbol?: string; pageNum?: number; pageSize?: number }): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/order/list/history_orders",
      query: {
        symbol: params?.symbol,
        page_num: params?.pageNum,
        page_size: params?.pageSize
      }
    });
  }

  listOrderDeals(params?: { symbol?: string; pageNum?: number; pageSize?: number }): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/order/list/order_deals",
      query: {
        symbol: params?.symbol,
        page_num: params?.pageNum,
        page_size: params?.pageSize
      }
    });
  }

  getOrderDealDetails(orderId: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: `/api/v1/private/order/deal_details/${orderId}`
    });
  }

  async getOrderDetail(params: {
    symbol: string;
    orderId?: string;
    clientOid?: string;
  }): Promise<Record<string, unknown>> {
    const orderId = String(params.orderId ?? "").trim();
    const clientOid = String(params.clientOid ?? "").trim();

    if (orderId) {
      const row = await this.getOrder(orderId);
      const direct = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
      const nestedRows = toRows(row);
      return nestedRows[0] ?? direct ?? {};
    }

    if (clientOid) {
      const row = await this.getOrderByExternal(params.symbol, clientOid);
      const direct = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
      const nestedRows = toRows(row);
      return nestedRows[0] ?? direct ?? {};
    }

    throw new MexcInvalidParamsError("MEXC getOrderDetail requires orderId or clientOid", {
      endpoint: "/api/v1/private/order/get",
      method: "GET"
    });
  }

  modifyOrder(payload: Record<string, unknown>): Promise<unknown> {
    void payload;
    throw new MexcMaintenanceError("MEXC modifyOrder is not available. Use cancel+replace.", {
      endpoint: "/api/v1/private/order/modify",
      method: "POST",
      status: 409
    });
  }

  openOrderTotalCount(symbol?: string): Promise<unknown> {
    // Listed in newer docs. Keep wrapper available for forward-compat.
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v1/private/order/open_order_total_count",
      body: symbol ? { symbol } : {}
    });
  }

  placePlanOrder(payload: Record<string, unknown>): Promise<unknown> {
    const endpoint = "/api/v1/private/planorder/place";
    assertCapability(this.capabilities.planOrders, endpoint, "planOrders");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: payload
    });
  }

  cancelPlanOrder(orderId: string): Promise<unknown>;
  cancelPlanOrder(params: {
    symbol?: string;
    orderId: string;
    productType?: string;
  }): Promise<unknown>;
  cancelPlanOrder(input: string | { symbol?: string; orderId: string; productType?: string }): Promise<unknown> {
    const orderId = typeof input === "string" ? input : String(input.orderId ?? "").trim();
    const endpoint = "/api/v1/private/planorder/cancel";
    assertCapability(this.capabilities.planOrders, endpoint, "planOrders");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: {
        order_id: orderId
      }
    });
  }

  cancelAllPlanOrders(symbol: string): Promise<unknown> {
    const endpoint = "/api/v1/private/planorder/cancel_all";
    assertCapability(this.capabilities.planOrders, endpoint, "planOrders");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: {
        symbol
      }
    });
  }

  listPlanOrders(symbol?: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/planorder/list/orders",
      query: symbol ? { symbol } : undefined
    });
  }

  getPendingPlanOrders(params: {
    productType?: string;
    symbol?: string;
    pageSize?: number;
    idLessThan?: string;
  } = {}): Promise<unknown> {
    return this.listPlanOrders(params.symbol);
  }

  placePositionTpSl(payload: {
    symbol: string;
    productType?: string;
    marginCoin?: string;
    holdSide?: string;
    planType: string;
    triggerPrice: string;
  }): Promise<unknown> {
    const holdSide = String(payload.holdSide ?? "").trim().toLowerCase();
    const side =
      holdSide === "long"
        ? 2
        : holdSide === "short"
          ? 4
          : undefined;

    const mapped: Record<string, unknown> = {
      symbol: payload.symbol,
      triggerPrice: payload.triggerPrice,
      trigger_price: payload.triggerPrice,
      planType: payload.planType,
      holdSide,
      side,
      marginCoin: payload.marginCoin,
      productType: payload.productType
    };

    return this.placePlanOrder(mapped);
  }

  placeStopOrder(payload: Record<string, unknown>): Promise<unknown> {
    const endpoint = "/api/v1/private/stoporder/place";
    assertCapability(this.capabilities.stopOrders, endpoint, "stopOrders");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: payload
    });
  }

  cancelStopOrder(orderId: string): Promise<unknown> {
    const endpoint = "/api/v1/private/stoporder/cancel";
    assertCapability(this.capabilities.stopOrders, endpoint, "stopOrders");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: {
        order_id: orderId
      }
    });
  }

  cancelAllStopOrders(symbol: string): Promise<unknown> {
    const endpoint = "/api/v1/private/stoporder/cancel_all";
    assertCapability(this.capabilities.stopOrders, endpoint, "stopOrders");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: {
        symbol
      }
    });
  }

  changeStopOrderPrice(orderId: string, stopLossPrice?: number, takeProfitPrice?: number): Promise<unknown> {
    const endpoint = "/api/v1/private/stoporder/change_price";
    assertCapability(this.capabilities.stopOrders, endpoint, "stopOrders");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: {
        order_id: orderId,
        stop_loss_price: stopLossPrice,
        take_profit_price: takeProfitPrice
      }
    });
  }

  changeStopPlanPrice(orderId: string, triggerPrice: number): Promise<unknown> {
    const endpoint = "/api/v1/private/stoporder/change_plan_price";
    assertCapability(this.capabilities.stopOrders, endpoint, "stopOrders");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: {
        order_id: orderId,
        trigger_price: triggerPrice
      }
    });
  }

  listStopOrders(symbol?: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/stoporder/list/orders",
      query: symbol ? { symbol } : undefined
    });
  }
}
