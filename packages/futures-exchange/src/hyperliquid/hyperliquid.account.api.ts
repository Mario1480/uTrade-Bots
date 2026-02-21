import type { Hyperliquid } from "hyperliquid";
import { HYPERLIQUID_DEFAULT_MARGIN_COIN, HYPERLIQUID_DEFAULT_PRODUCT_TYPE } from "./hyperliquid.constants.js";
import { parseCoinFromAnySymbol, toInternalPerpSymbol } from "./hyperliquid.symbols.js";
import type { HyperliquidAccountRaw, HyperliquidProductType } from "./hyperliquid.types.js";

function toStringNumber(value: unknown, fallback = "0"): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : fallback;
}

export class HyperliquidAccountApi {
  private readonly marginModeBySymbol = new Map<string, "isolated" | "crossed">();

  constructor(
    private readonly sdk: Hyperliquid,
    private readonly userAddress: string
  ) {}

  async getAccounts(_productType: HyperliquidProductType = HYPERLIQUID_DEFAULT_PRODUCT_TYPE): Promise<HyperliquidAccountRaw[]> {
    const state = await this.sdk.info.perpetuals.getClearinghouseState(this.userAddress, true);
    const equity = state?.marginSummary?.accountValue ?? state?.crossMarginSummary?.accountValue ?? "0";
    const available = state?.withdrawable ?? "0";

    return [
      {
        marginCoin: HYPERLIQUID_DEFAULT_MARGIN_COIN,
        available: toStringNumber(available),
        crossAvailable: toStringNumber(available),
        accountEquity: toStringNumber(equity)
      }
    ];
  }

  async getAccount(params: {
    symbol?: string;
    productType?: HyperliquidProductType;
    marginCoin?: string;
  }): Promise<HyperliquidAccountRaw> {
    const rows = await this.getAccounts(params.productType);
    return rows[0] ?? {
      marginCoin: params.marginCoin ?? HYPERLIQUID_DEFAULT_MARGIN_COIN,
      available: "0",
      crossAvailable: "0",
      accountEquity: "0"
    };
  }

  async setLeverage(params: {
    symbol: string;
    leverage: number;
    productType?: HyperliquidProductType;
    marginCoin?: string;
    holdSide?: "long" | "short";
  }): Promise<unknown> {
    const marginMode = this.marginModeBySymbol.get(params.symbol) ?? "crossed";
    const leverageMode = marginMode === "isolated" ? "isolated" : "cross";
    const coin = parseCoinFromAnySymbol(params.symbol);
    return this.sdk.exchange.updateLeverage(toInternalPerpSymbol(coin), leverageMode, Math.max(1, Math.trunc(params.leverage)));
  }

  async setMarginMode(params: {
    symbol: string;
    marginMode: "isolated" | "crossed";
    productType?: HyperliquidProductType;
    marginCoin?: string;
  }): Promise<unknown> {
    this.marginModeBySymbol.set(params.symbol, params.marginMode);
    return { ok: true };
  }

  async getPositionMode(_productType: HyperliquidProductType = HYPERLIQUID_DEFAULT_PRODUCT_TYPE): Promise<{ posMode?: string }> {
    return { posMode: "one_way_mode" };
  }

  async setPositionMode(_params: {
    productType?: HyperliquidProductType;
    posMode: "one_way_mode" | "hedge_mode";
  }): Promise<unknown> {
    return { ok: true };
  }
}
