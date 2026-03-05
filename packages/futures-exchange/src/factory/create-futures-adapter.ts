import { BitgetFuturesAdapter } from "../bitget/bitget.adapter.js";
import { HyperliquidFuturesAdapter } from "../hyperliquid/hyperliquid.adapter.js";
import { MexcFuturesAdapter } from "../mexc/mexc.adapter.js";

export type FuturesAdapterExchange = "bitget" | "hyperliquid" | "mexc" | "binance" | "paper";

export type FuturesAdapterAccount = {
  exchange: FuturesAdapterExchange | string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string | null;
};

export type CreateFuturesAdapterOptions = {
  allowMexcPerp?: boolean;
  allowBinancePerp?: boolean;
  bitgetProductType?: string;
  bitgetMarginCoin?: string;
  hyperliquidRestBaseUrl?: string;
  hyperliquidMarginCoin?: string;
  mexcRestBaseUrl?: string;
  mexcWsUrl?: string;
  mexcProductType?: string;
  mexcMarginCoin?: string;
};

export type SupportedFuturesAdapter =
  | BitgetFuturesAdapter
  | HyperliquidFuturesAdapter
  | MexcFuturesAdapter;

export class FuturesAdapterFactoryError extends Error {
  readonly code:
    | "paper_account_requires_market_data_resolution"
    | "mexc_perp_disabled"
    | "binance_market_data_only"
    | "unsupported_exchange";

  constructor(
    code:
      | "paper_account_requires_market_data_resolution"
      | "mexc_perp_disabled"
      | "binance_market_data_only"
      | "unsupported_exchange",
    message?: string
  ) {
    super(message ?? code);
    this.code = code;
  }
}

export function createFuturesAdapter(
  account: FuturesAdapterAccount,
  options: CreateFuturesAdapterOptions = {}
): SupportedFuturesAdapter {
  const exchange = String(account.exchange ?? "").trim().toLowerCase();
  if (exchange === "paper") {
    throw new FuturesAdapterFactoryError("paper_account_requires_market_data_resolution");
  }
  if (exchange === "hyperliquid") {
    return new HyperliquidFuturesAdapter({
      apiKey: account.apiKey,
      apiSecret: account.apiSecret,
      apiPassphrase: account.passphrase ?? undefined,
      restBaseUrl: options.hyperliquidRestBaseUrl ?? process.env.HYPERLIQUID_REST_BASE_URL,
      productType: "USDT-FUTURES",
      marginCoin: options.hyperliquidMarginCoin ?? process.env.HYPERLIQUID_MARGIN_COIN ?? "USDC"
    });
  }
  if (exchange === "mexc") {
    const mexcEnabled = options.allowMexcPerp !== false;
    if (!mexcEnabled) {
      throw new FuturesAdapterFactoryError("mexc_perp_disabled");
    }
    return new MexcFuturesAdapter({
      apiKey: account.apiKey,
      apiSecret: account.apiSecret,
      restBaseUrl: options.mexcRestBaseUrl ?? process.env.MEXC_REST_BASE_URL,
      wsUrl: options.mexcWsUrl ?? process.env.MEXC_WS_URL,
      productType: options.mexcProductType ?? process.env.MEXC_PRODUCT_TYPE ?? "USDT-FUTURES",
      marginCoin: options.mexcMarginCoin ?? process.env.MEXC_MARGIN_COIN ?? "USDT"
    });
  }
  if (exchange === "binance") {
    if (options.allowBinancePerp === true) {
      throw new FuturesAdapterFactoryError("unsupported_exchange");
    }
    throw new FuturesAdapterFactoryError("binance_market_data_only");
  }
  if (exchange !== "bitget") {
    throw new FuturesAdapterFactoryError("unsupported_exchange");
  }
  return new BitgetFuturesAdapter({
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    apiPassphrase: account.passphrase ?? undefined,
    productType: (options.bitgetProductType as any) ?? (process.env.BITGET_PRODUCT_TYPE as any) ?? "USDT-FUTURES",
    marginCoin: options.bitgetMarginCoin ?? process.env.BITGET_MARGIN_COIN ?? "USDT"
  });
}
