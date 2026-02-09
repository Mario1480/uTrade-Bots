import type { MexcContractDetail, MexcOrderBookSnapshot } from "./mexc.types.js";
import { MexcRestClient } from "./mexc.rest.js";

export class MexcMarketApi {
  constructor(private readonly rest: MexcRestClient) {}

  ping(): Promise<number> {
    return this.rest.requestPublic<number>("GET", "/api/v1/contract/ping");
  }

  getContractDetail(symbol?: string): Promise<MexcContractDetail[] | MexcContractDetail> {
    return this.rest.requestPublic("GET", "/api/v1/contract/detail", symbol ? { symbol } : undefined);
  }

  getSupportCurrencies(): Promise<Array<{ currency?: string }>> {
    return this.rest.requestPublic("GET", "/api/v1/contract/support_currencies");
  }

  getTicker(symbol?: string): Promise<unknown> {
    return this.rest.requestPublic("GET", "/api/v1/contract/ticker", symbol ? { symbol } : undefined);
  }

  getDepth(symbol: string, limit?: number): Promise<MexcOrderBookSnapshot> {
    return this.rest.requestPublic("GET", `/api/v1/contract/depth/${symbol}`, limit ? { limit } : undefined);
  }

  getDepthCommits(symbol: string, limit: number): Promise<unknown> {
    return this.rest.requestPublic("GET", `/api/v1/contract/depth_commits/${symbol}/${limit}`);
  }

  getDeals(symbol: string, pageNum?: number, pageSize?: number): Promise<unknown> {
    return this.rest.requestPublic("GET", `/api/v1/contract/deals/${symbol}`, {
      page_num: pageNum,
      page_size: pageSize
    });
  }

  getFairPrice(symbol: string): Promise<unknown> {
    return this.rest.requestPublic("GET", `/api/v1/contract/fair_price/${symbol}`);
  }

  getIndexPrice(symbol: string): Promise<unknown> {
    return this.rest.requestPublic("GET", `/api/v1/contract/index_price/${symbol}`);
  }

  getFundingRate(symbol: string): Promise<unknown> {
    return this.rest.requestPublic("GET", `/api/v1/contract/funding_rate/${symbol}`);
  }

  getFundingRateHistory(symbol?: string, pageNum?: number, pageSize?: number): Promise<unknown> {
    return this.rest.requestPublic("GET", "/api/v1/contract/funding_rate/history", {
      symbol,
      page_num: pageNum,
      page_size: pageSize
    });
  }

  getKline(symbol: string, interval: string, start?: number, end?: number): Promise<unknown> {
    return this.rest.requestPublic("GET", `/api/v1/contract/kline/${symbol}`, {
      interval,
      start,
      end
    });
  }

  getIndexKline(symbol: string, interval: string, start?: number, end?: number): Promise<unknown> {
    return this.rest.requestPublic("GET", `/api/v1/contract/kline/index_price/${symbol}`, {
      interval,
      start,
      end
    });
  }

  getFairPriceKline(symbol: string, interval: string, start?: number, end?: number): Promise<unknown> {
    return this.rest.requestPublic("GET", `/api/v1/contract/kline/fair_price/${symbol}`, {
      interval,
      start,
      end
    });
  }

  getRiskReverse(symbol?: string): Promise<unknown> {
    return this.rest.requestPublic("GET", "/api/v1/contract/risk_reverse", symbol ? { symbol } : undefined);
  }

  getRiskReverseHistory(symbol?: string, pageNum?: number, pageSize?: number): Promise<unknown> {
    return this.rest.requestPublic("GET", "/api/v1/contract/risk_reverse/history", {
      symbol,
      page_num: pageNum,
      page_size: pageSize
    });
  }
}
