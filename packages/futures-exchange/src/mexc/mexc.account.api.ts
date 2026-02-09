import { MexcRestClient } from "./mexc.rest.js";
import type { MexcAccountAssetRaw, MexcPositionRaw } from "./mexc.types.js";

export class MexcAccountApi {
  constructor(private readonly rest: MexcRestClient) {}

  getAssets(): Promise<MexcAccountAssetRaw[]> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/account/assets"
    });
  }

  getAsset(currency: string): Promise<MexcAccountAssetRaw> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: `/api/v1/private/account/asset/${currency}`
    });
  }

  getRiskLimit(): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/account/risk_limit"
    });
  }

  getTieredFeeRate(symbol?: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/account/tiered_fee_rate",
      query: symbol ? { symbol } : undefined
    });
  }

  getTransferRecord(pageNum?: number, pageSize?: number): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/account/transfer_record",
      query: {
        page_num: pageNum,
        page_size: pageSize
      }
    });
  }

  getOpenPositions(symbol?: string): Promise<MexcPositionRaw[]> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/position/open_positions",
      query: symbol ? { symbol } : undefined
    });
  }

  getHistoryPositions(pageNum?: number, pageSize?: number): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/position/list/history_positions",
      query: {
        page_num: pageNum,
        page_size: pageSize
      }
    });
  }

  getFundingRecords(symbol?: string, pageNum?: number, pageSize?: number): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/position/funding_records",
      query: {
        symbol,
        page_num: pageNum,
        page_size: pageSize
      }
    });
  }

  getLeverage(symbol?: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/position/leverage",
      query: symbol ? { symbol } : undefined
    });
  }

  getPositionMode(): Promise<{ positionMode?: number | string }> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/api/v1/private/position/position_mode"
    });
  }

  changePositionMode(positionMode: number): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v1/private/position/change_position_mode",
      body: {
        positionMode
      }
    });
  }

  changeLeverage(symbol: string, leverage: number, openType = 2, positionType = 1): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v1/private/position/change_leverage",
      body: {
        symbol,
        leverage,
        openType,
        positionType
      }
    });
  }

  changeMargin(symbol: string, amount: number, positionType = 1): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/api/v1/private/position/change_margin",
      body: {
        symbol,
        amount,
        positionType
      }
    });
  }
}
