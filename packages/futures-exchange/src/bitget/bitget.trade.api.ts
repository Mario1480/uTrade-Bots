import { BITGET_DEFAULT_PRODUCT_TYPE, type BitgetProductType } from "./bitget.constants.js";
import { BitgetRestClient } from "./bitget.rest.js";
import type {
  BitgetOrderModifyRequest,
  BitgetOrderPlaceRequest,
  BitgetOrderRaw,
  BitgetPositionTpSlRequest
} from "./bitget.types.js";

export class BitgetTradeApi {
  constructor(private readonly rest: BitgetRestClient) {}

  placeOrder(payload: BitgetOrderPlaceRequest): Promise<{ orderId?: string; clientOid?: string }> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v2/mix/order/place-order",
      body: payload
    });
  }

  modifyOrder(payload: BitgetOrderModifyRequest): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v2/mix/order/modify-order",
      body: payload
    });
  }

  cancelOrder(params: {
    symbol: string;
    orderId?: string;
    clientOid?: string;
    productType?: BitgetProductType;
  }): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v2/mix/order/cancel-order",
      body: {
        symbol: params.symbol,
        orderId: params.orderId,
        clientOid: params.clientOid,
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE
      }
    });
  }

  getPendingOrders(params: {
    productType?: BitgetProductType;
    symbol?: string;
    pageSize?: number;
    idLessThan?: string;
  } = {}): Promise<BitgetOrderRaw[]> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v2/mix/order/orders-pending",
      query: {
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
        symbol: params.symbol,
        limit: params.pageSize,
        idLessThan: params.idLessThan
      }
    });
  }

  getPendingPlanOrders(params: {
    productType?: BitgetProductType;
    symbol?: string;
    pageSize?: number;
    idLessThan?: string;
  } = {}): Promise<BitgetOrderRaw[]> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v2/mix/order/orders-plan-pending",
      query: {
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
        symbol: params.symbol,
        limit: params.pageSize,
        idLessThan: params.idLessThan
      }
    });
  }

  placePositionTpSl(payload: BitgetPositionTpSlRequest): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v2/mix/order/place-pos-tpsl",
      body: payload
    });
  }

  cancelPlanOrder(params: {
    symbol: string;
    orderId: string;
    productType?: BitgetProductType;
  }): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v2/mix/order/cancel-plan-order",
      body: {
        symbol: params.symbol,
        orderId: params.orderId,
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE
      }
    });
  }

  getOrderDetail(params: {
    symbol: string;
    orderId?: string;
    clientOid?: string;
  }): Promise<BitgetOrderRaw> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v2/mix/order/detail",
      query: {
        symbol: params.symbol,
        orderId: params.orderId,
        clientOid: params.clientOid
      }
    });
  }

  getFills(params: {
    symbol?: string;
    orderId?: string;
    productType?: BitgetProductType;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v2/mix/order/fills",
      query: {
        symbol: params.symbol,
        orderId: params.orderId,
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
        startTime: params.startTime,
        endTime: params.endTime,
        limit: params.limit
      }
    });
  }

  getOrderHistory(params: {
    productType?: BitgetProductType;
    symbol?: string;
    startTime?: number;
    endTime?: number;
    pageSize?: number;
    idLessThan?: string;
  } = {}): Promise<BitgetOrderRaw[]> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v2/mix/order/orders-history",
      query: {
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
        symbol: params.symbol,
        startTime: params.startTime,
        endTime: params.endTime,
        limit: params.pageSize,
        idLessThan: params.idLessThan
      }
    });
  }
}
