import { BITGET_DEFAULT_PRODUCT_TYPE, type BitgetProductType } from "./bitget.constants.js";
import { BitgetRestClient } from "./bitget.rest.js";
import type { BitgetContractRaw } from "./bitget.types.js";

export class BitgetMarketApi {
  constructor(private readonly rest: BitgetRestClient) {}

  getContracts(productType: BitgetProductType = BITGET_DEFAULT_PRODUCT_TYPE): Promise<BitgetContractRaw[]> {
    return this.rest.requestPublic("GET", "/api/v2/mix/market/contracts", {
      productType
    });
  }

  getTicker(symbol: string, productType: BitgetProductType = BITGET_DEFAULT_PRODUCT_TYPE): Promise<unknown> {
    return this.rest.requestPublic("GET", "/api/v2/mix/market/ticker", {
      symbol,
      productType
    });
  }

  getTickers(productType: BitgetProductType = BITGET_DEFAULT_PRODUCT_TYPE): Promise<unknown> {
    return this.rest.requestPublic("GET", "/api/v2/mix/market/tickers", {
      productType
    });
  }

  getCandles(params: {
    symbol: string;
    granularity: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    productType?: BitgetProductType;
  }): Promise<unknown> {
    return this.rest.requestPublic("GET", "/api/v2/mix/market/candles", {
      symbol: params.symbol,
      productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
      granularity: params.granularity,
      startTime: params.startTime,
      endTime: params.endTime,
      limit: params.limit
    });
  }

  getDepth(symbol: string, limit = 50, productType: BitgetProductType = BITGET_DEFAULT_PRODUCT_TYPE): Promise<unknown> {
    return this.rest.requestPublic("GET", "/api/v2/mix/market/merge-depth", {
      symbol,
      productType,
      limit
    });
  }

  getTrades(symbol: string, limit = 100, productType: BitgetProductType = BITGET_DEFAULT_PRODUCT_TYPE): Promise<unknown> {
    return this.rest.requestPublic("GET", "/api/v2/mix/market/fills", {
      symbol,
      productType,
      limit
    });
  }
}
