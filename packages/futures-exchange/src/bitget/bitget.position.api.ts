import { BITGET_DEFAULT_MARGIN_COIN, BITGET_DEFAULT_PRODUCT_TYPE, type BitgetProductType } from "./bitget.constants.js";
import { BitgetRestClient } from "./bitget.rest.js";
import type { BitgetPositionRaw } from "./bitget.types.js";

export class BitgetPositionApi {
  constructor(private readonly rest: BitgetRestClient) {}

  getAllPositions(params: {
    productType?: BitgetProductType;
    marginCoin?: string;
  } = {}): Promise<BitgetPositionRaw[]> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v2/mix/position/all-position",
      query: {
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
        marginCoin: params.marginCoin ?? BITGET_DEFAULT_MARGIN_COIN
      }
    });
  }

  getSinglePosition(params: {
    symbol: string;
    productType?: BitgetProductType;
    marginCoin?: string;
  }): Promise<BitgetPositionRaw[]> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v2/mix/position/single-position",
      query: {
        symbol: params.symbol,
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
        marginCoin: params.marginCoin ?? BITGET_DEFAULT_MARGIN_COIN
      }
    });
  }
}
