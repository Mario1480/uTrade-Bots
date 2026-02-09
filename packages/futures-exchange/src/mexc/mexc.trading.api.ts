import { MEXC_MAINTENANCE_ENDPOINTS } from "./mexc.constants.js";
import { MexcMaintenanceError } from "./mexc.errors.js";
import { MexcRestClient } from "./mexc.rest.js";
import type {
  MexcCapabilities,
  MexcOrderResponse,
  MexcPlaceOrderRequest
} from "./mexc.types.js";

export function createDefaultMexcCapabilities(): MexcCapabilities {
  return {
    // Under maintenance paths are intentionally off by default.
    placeOrder: false,
    batchPlaceOrder: false,
    cancelOrder: false,
    cancelWithExternal: false,
    cancelAll: false,
    stopOrders: false,
    planOrders: false,

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
      method: "POST"
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

  cancelOrder(orderId: string): Promise<unknown> {
    const endpoint = "/api/v1/private/order/cancel";
    assertCapability(this.capabilities.cancelOrder, endpoint, "cancelOrder");
    return this.rest.requestPrivate({
      method: "POST",
      endpoint,
      body: {
        order_id: orderId
      }
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

  cancelPlanOrder(orderId: string): Promise<unknown> {
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
