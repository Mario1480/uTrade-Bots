import { BITGET_DEFAULT_MARGIN_COIN, BITGET_DEFAULT_PRODUCT_TYPE, type BitgetProductType } from "./bitget.constants.js";
import { BitgetRestClient } from "./bitget.rest.js";
import type { BitgetAccountRaw } from "./bitget.types.js";

export class BitgetAccountApi {
  constructor(private readonly rest: BitgetRestClient) {}

  getAccounts(productType: BitgetProductType = BITGET_DEFAULT_PRODUCT_TYPE): Promise<BitgetAccountRaw[]> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v2/mix/account/accounts",
      query: { productType }
    });
  }

  getAccount(params: {
    symbol?: string;
    productType?: BitgetProductType;
    marginCoin?: string;
  }): Promise<BitgetAccountRaw> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v2/mix/account/account",
      query: {
        symbol: params.symbol,
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
        marginCoin: params.marginCoin ?? BITGET_DEFAULT_MARGIN_COIN
      }
    });
  }

  setLeverage(params: {
    symbol: string;
    leverage: number;
    productType?: BitgetProductType;
    marginCoin?: string;
    holdSide?: "long" | "short";
  }): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v2/mix/account/set-leverage",
      body: {
        symbol: params.symbol,
        leverage: String(params.leverage),
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
        marginCoin: params.marginCoin ?? BITGET_DEFAULT_MARGIN_COIN,
        holdSide: params.holdSide
      }
    });
  }

  setMarginMode(params: {
    symbol: string;
    marginMode: "isolated" | "crossed";
    productType?: BitgetProductType;
    marginCoin?: string;
  }): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v2/mix/account/set-margin-mode",
      body: {
        symbol: params.symbol,
        marginMode: params.marginMode,
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
        marginCoin: params.marginCoin ?? BITGET_DEFAULT_MARGIN_COIN
      }
    });
  }

  getPositionMode(productType: BitgetProductType = BITGET_DEFAULT_PRODUCT_TYPE): Promise<{ posMode?: string }> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v2/mix/account/get-position-mode",
      query: { productType }
    });
  }

  setPositionMode(params: {
    productType?: BitgetProductType;
    posMode: "one_way_mode" | "hedge_mode";
  }): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v2/mix/account/set-position-mode",
      body: {
        productType: params.productType ?? BITGET_DEFAULT_PRODUCT_TYPE,
        posMode: params.posMode
      }
    });
  }
}
