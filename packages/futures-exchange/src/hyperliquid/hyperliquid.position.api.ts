import type { Hyperliquid } from "hyperliquid";
import { HYPERLIQUID_DEFAULT_MARGIN_COIN, HYPERLIQUID_DEFAULT_PRODUCT_TYPE } from "./hyperliquid.constants.js";
import { coinToCanonicalSymbol } from "./hyperliquid.symbols.js";
import type { HyperliquidPositionRaw, HyperliquidProductType } from "./hyperliquid.types.js";

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class HyperliquidPositionApi {
  constructor(private readonly sdk: Hyperliquid, private readonly userAddress: string) {}

  async getAllPositions(params: {
    productType?: HyperliquidProductType;
    marginCoin?: string;
  } = {}): Promise<HyperliquidPositionRaw[]> {
    const state = await this.sdk.info.perpetuals.getClearinghouseState(this.userAddress, true);
    const markByCoin = new Map<string, string>();
    const allMids = await this.sdk.info.getAllMids(true).catch(() => ({} as Record<string, string>));
    for (const [coin, mark] of Object.entries(allMids)) {
      markByCoin.set(String(coin).toUpperCase(), String(mark));
    }

    const rows = Array.isArray(state?.assetPositions) ? state.assetPositions : [];

    const normalized = rows
      .map((row) => {
        const position = row?.position;
        const coin = String(position?.coin ?? "").toUpperCase();
        const szi = toNumber(position?.szi);
        const absSize = Math.abs(szi);
        if (!coin || absSize <= 0) return null;

        const markPrice = toNumber(markByCoin.get(coin) ?? null);

        return {
          symbol: coinToCanonicalSymbol(coin),
          holdSide: szi >= 0 ? "long" : "short",
          total: String(absSize),
          avgOpenPrice: String(position?.entryPx ?? "0"),
          markPrice: markPrice > 0 ? String(markPrice) : undefined,
          unrealizedPL: String(position?.unrealizedPnl ?? "0"),
          leverage: String(position?.leverage?.value ?? ""),
          marginMode: String(position?.leverage?.type ?? "cross")
        } satisfies HyperliquidPositionRaw;
      })
      .filter((row) => row !== null);

    return normalized;
  }

  async getPositionsBySymbol(params: {
    symbol: string;
    productType?: HyperliquidProductType;
    marginCoin?: string;
  }): Promise<HyperliquidPositionRaw[]> {
    const all = await this.getAllPositions({
      productType: params.productType ?? HYPERLIQUID_DEFAULT_PRODUCT_TYPE,
      marginCoin: params.marginCoin ?? HYPERLIQUID_DEFAULT_MARGIN_COIN
    });
    return all.filter((row) => String(row.symbol ?? "").toUpperCase() === params.symbol.toUpperCase());
  }
}
