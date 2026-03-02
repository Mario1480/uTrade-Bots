import type { MexcContractDetail, MexcOrderBookSnapshot } from "./mexc.types.js";
import { MexcRestClient } from "./mexc.rest.js";

function normalizeInterval(granularity: string): string {
  const raw = String(granularity ?? "").trim();
  if (!raw) return "Min1";
  const normalized = raw.toLowerCase();
  if (["1m", "min1", "min_1"].includes(normalized)) return "Min1";
  if (["5m", "min5", "min_5"].includes(normalized)) return "Min5";
  if (["15m", "min15", "min_15"].includes(normalized)) return "Min15";
  if (["30m", "min30", "min_30"].includes(normalized)) return "Min30";
  if (["1h", "hour1", "h1"].includes(normalized)) return "Min60";
  if (["4h", "hour4", "h4"].includes(normalized)) return "Hour4";
  if (["8h", "hour8", "h8"].includes(normalized)) return "Hour8";
  if (["1d", "day1", "d1"].includes(normalized)) return "Day1";
  if (["1w", "week1", "w1"].includes(normalized)) return "Week1";
  return raw;
}

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

  getTicker(symbol?: string, _productType?: string): Promise<unknown> {
    return this.rest.requestPublic("GET", "/api/v1/contract/ticker", symbol ? { symbol } : undefined);
  }

  getDepth(symbol: string, limit?: number, _productType?: string): Promise<MexcOrderBookSnapshot> {
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

  getTrades(symbol: string, limit = 100, _productType?: string): Promise<unknown> {
    return this.getDeals(symbol, 1, limit);
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

  getCandles(params: {
    symbol: string;
    granularity: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    productType?: string;
  }): Promise<unknown> {
    const interval = normalizeInterval(params.granularity);
    return this.rest.requestPublic("GET", `/api/v1/contract/kline/${params.symbol}`, {
      interval,
      start: params.startTime,
      end: params.endTime
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
