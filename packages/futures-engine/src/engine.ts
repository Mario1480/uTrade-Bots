import type {
  ContractInfo,
  MarginMode,
  TradeIntent
} from "@mm/futures-core";
import {
  FuturesValidationError,
  InvalidStepError,
  InvalidTickError,
  QtyOutOfRangeError,
  SymbolUnknownError,
  TradingNotAllowedError,
  clampQty,
  deriveStepSize,
  deriveTickSize,
  enforceLeverageBounds,
  qtyFromNotionalUsd,
  qtyFromRisk,
  roundPriceToTick,
  roundQtyToStep,
  validatePrice,
  validateQty
} from "@mm/futures-core";
import type { FuturesExchange } from "@mm/futures-exchange";

export type EngineRiskEvent = {
  type:
    | "KILL_SWITCH_BLOCK"
    | "SYMBOL_UNKNOWN"
    | "TRADING_NOT_ALLOWED"
    | "ORDER_VALIDATION_BLOCK";
  botId?: string;
  timestamp: string;
  message: string;
  meta: Record<string, unknown>;
};

export type EngineExecutionResult =
  | { status: "noop" }
  | { status: "blocked"; reason: "kill_switch" | "symbol_unknown" | "trading_not_allowed" | "validation" }
  | { status: "accepted"; orderId?: string };

export type EngineExecutionContext = {
  botId?: string;
  isTradingEnabled?: boolean | (() => boolean | Promise<boolean>);
  emitRiskEvent?: (event: EngineRiskEvent) => void | Promise<void>;
  getContractInfo?: (symbol: string) => Promise<ContractInfo | null>;
};

export type FuturesEngineOptions = {
  isTradingEnabled?: () => boolean | Promise<boolean>;
  emitRiskEvent?: (event: EngineRiskEvent) => void | Promise<void>;
  getContractInfo?: (symbol: string) => Promise<ContractInfo | null>;
};

function normalize(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

function toOrderSide(positionSide: "long" | "short"): "buy" | "sell" {
  return positionSide === "long" ? "buy" : "sell";
}

function toCanonicalFallbackSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function isValidationError(error: unknown): error is FuturesValidationError {
  return error instanceof FuturesValidationError;
}

export function isGlobalTradingEnabled(
  raw: string | null | undefined = process.env.GLOBAL_TRADING_ENABLED,
  nodeEnv: string | null | undefined = process.env.NODE_ENV
): boolean {
  const normalized = normalize(raw);
  if (normalized === "off" || normalized === "false" || normalized === "0") return false;
  if (normalized === "on" || normalized === "true" || normalized === "1") return true;

  // Default is enabled. This keeps production safe unless explicitly disabled.
  return normalize(nodeEnv) === "production" ? true : true;
}

export class FuturesEngine {
  constructor(
    private readonly ex: FuturesExchange,
    private readonly options: FuturesEngineOptions = {}
  ) {}

  private assertExecutionBoundary(method: string) {
    const stack = new Error().stack ?? "";
    const calledFromStrategies = /[\\/](packages[\\/])?strategies[\\/]/i.test(stack);
    if (!calledFromStrategies) return;

    const message = `Execution boundary violation: ${method} called from strategy code path`;
    if (process.env.NODE_ENV === "production") {
      // eslint-disable-next-line no-console
      console.warn(message);
      return;
    }

    throw new Error(message);
  }

  private async resolveTradingEnabled(ctx: EngineExecutionContext): Promise<boolean> {
    if (typeof ctx.isTradingEnabled === "boolean") return ctx.isTradingEnabled;
    if (typeof ctx.isTradingEnabled === "function") return await ctx.isTradingEnabled();
    if (typeof this.options.isTradingEnabled === "function") return await this.options.isTradingEnabled();
    return isGlobalTradingEnabled();
  }

  private async emitRiskEvent(ctx: EngineExecutionContext, event: EngineRiskEvent) {
    if (ctx.emitRiskEvent) {
      await ctx.emitRiskEvent(event);
      return;
    }
    if (this.options.emitRiskEvent) {
      await this.options.emitRiskEvent(event);
    }
  }

  private async resolveContractInfo(ctx: EngineExecutionContext, symbol: string): Promise<ContractInfo | null> {
    if (ctx.getContractInfo) return ctx.getContractInfo(symbol);
    if (this.options.getContractInfo) return this.options.getContractInfo(symbol);
    if (this.ex.getContractInfo) return this.ex.getContractInfo(symbol);
    return null;
  }

  private async resolveExchangeSymbol(symbol: string, contract: ContractInfo): Promise<string> {
    if (this.ex.toExchangeSymbol) {
      return await this.ex.toExchangeSymbol(symbol);
    }
    return contract.mexcSymbol;
  }

  private async block(
    ctx: EngineExecutionContext,
    params: {
      type: EngineRiskEvent["type"];
      reason: Extract<EngineExecutionResult, { status: "blocked" }>["reason"];
      message: string;
      meta: Record<string, unknown>;
    }
  ): Promise<EngineExecutionResult> {
    await this.emitRiskEvent(ctx, {
      type: params.type,
      botId: ctx.botId,
      timestamp: new Date().toISOString(),
      message: params.message,
      meta: params.meta
    });

    return {
      status: "blocked",
      reason: params.reason
    };
  }

  private async executeOpenIntent(
    intent: Extract<TradeIntent, { type: "open" }>,
    ctx: EngineExecutionContext
  ): Promise<EngineExecutionResult> {
    const contract = await this.resolveContractInfo(ctx, intent.symbol);
    if (!contract) {
      return this.block(ctx, {
        type: "SYMBOL_UNKNOWN",
        reason: "symbol_unknown",
        message: `Unknown symbol ${intent.symbol}`,
        meta: {
          symbol: intent.symbol
        }
      });
    }

    if (!contract.apiAllowed) {
      return this.block(ctx, {
        type: "TRADING_NOT_ALLOWED",
        reason: "trading_not_allowed",
        message: `Trading disabled for ${contract.canonicalSymbol} (apiAllowed=false)`,
        meta: {
          symbol: contract.canonicalSymbol,
          mexcSymbol: contract.mexcSymbol
        }
      });
    }

    const order = intent.order ?? {};
    const roundMode = order.roundingMode ?? "down";

    try {
      if (order.leverage !== undefined) {
        enforceLeverageBounds(order.leverage, contract);
        await this.ex.setLeverage(
          contract.canonicalSymbol,
          order.leverage,
          (order.marginMode ?? "cross") as MarginMode
        );
      }

      const stepSize = deriveStepSize(contract);
      if (!stepSize) {
        throw new InvalidStepError(contract.canonicalSymbol, `Missing step size for ${contract.canonicalSymbol}`);
      }

      const markPrice = order.markPrice ?? order.price;
      let qty = order.qty;
      if (qty === undefined && order.desiredNotionalUsd !== undefined && markPrice !== undefined) {
        qty = qtyFromNotionalUsd(order.desiredNotionalUsd, markPrice, contract);
      }

      if (
        qty === undefined &&
        order.riskUsd !== undefined &&
        order.stopDistancePct !== undefined &&
        markPrice !== undefined
      ) {
        qty = qtyFromRisk(order.riskUsd, order.stopDistancePct, markPrice, contract);
      }

      if (qty === undefined) {
        throw new QtyOutOfRangeError(
          contract.canonicalSymbol,
          `Missing qty/sizing for ${contract.canonicalSymbol}. Provide qty, desiredNotionalUsd+markPrice, or riskUsd+stopDistancePct+markPrice.`
        );
      }

      let normalizedQty = roundQtyToStep(qty, stepSize, roundMode);
      normalizedQty = clampQty(normalizedQty, contract.minVol, contract.maxVol);

      const qtyValidation = validateQty(
        normalizedQty,
        stepSize,
        contract.minVol,
        contract.maxVol,
        contract.canonicalSymbol
      );
      if (!qtyValidation.ok) {
        throw qtyValidation.error;
      }

      const orderType = order.type ?? "market";
      let normalizedPrice: number | undefined;

      if (orderType === "limit") {
        if (order.price === undefined) {
          throw new InvalidTickError(contract.canonicalSymbol, `Limit order requires price for ${contract.canonicalSymbol}`);
        }

        const tickSize = deriveTickSize(contract);
        if (!tickSize) {
          throw new InvalidTickError(contract.canonicalSymbol, `Missing tick size for ${contract.canonicalSymbol}`);
        }

        normalizedPrice = roundPriceToTick(order.price, tickSize, roundMode);
        const priceValidation = validatePrice(normalizedPrice, tickSize, contract.canonicalSymbol);
        if (!priceValidation.ok) {
          throw priceValidation.error;
        }
      }

      const exchangeSymbol = await this.resolveExchangeSymbol(contract.canonicalSymbol, contract);
      const orderResult = await this.ex.placeOrder({
        symbol: exchangeSymbol,
        side: toOrderSide(intent.side),
        type: orderType,
        qty: normalizedQty,
        price: normalizedPrice,
        reduceOnly: order.reduceOnly
      });

      return {
        status: "accepted",
        orderId: orderResult.orderId
      };
    } catch (error) {
      if (error instanceof SymbolUnknownError) {
        return this.block(ctx, {
          type: "SYMBOL_UNKNOWN",
          reason: "symbol_unknown",
          message: error.message,
          meta: {
            symbol: contract.canonicalSymbol
          }
        });
      }

      if (error instanceof TradingNotAllowedError) {
        return this.block(ctx, {
          type: "TRADING_NOT_ALLOWED",
          reason: "trading_not_allowed",
          message: error.message,
          meta: {
            symbol: contract.canonicalSymbol
          }
        });
      }

      if (isValidationError(error)) {
        return this.block(ctx, {
          type: "ORDER_VALIDATION_BLOCK",
          reason: "validation",
          message: error.message,
          meta: {
            symbol: contract.canonicalSymbol,
            errorName: error.name
          }
        });
      }

      throw error;
    }
  }

  private async executeCloseIntent(
    intent: Extract<TradeIntent, { type: "close" }>
  ): Promise<EngineExecutionResult> {
    const cancelOrderId = intent.order?.cancelOrderId;
    if (!cancelOrderId) {
      return { status: "accepted" };
    }

    await this.ex.cancelOrder(cancelOrderId);
    return { status: "accepted" };
  }

  async execute(intent: TradeIntent, ctx: EngineExecutionContext = {}): Promise<EngineExecutionResult> {
    this.assertExecutionBoundary("execute");
    if (intent.type === "none") return { status: "noop" };

    const tradingEnabled = await this.resolveTradingEnabled(ctx);
    if (!tradingEnabled) {
      return this.block(ctx, {
        type: "KILL_SWITCH_BLOCK",
        reason: "kill_switch",
        message: "Global kill switch is engaged. Trading action blocked.",
        meta: {
          intentType: intent.type,
          symbol: "symbol" in intent ? intent.symbol : null
        }
      });
    }

    if (intent.type === "open") {
      return this.executeOpenIntent(
        {
          ...intent,
          symbol: this.ex.toCanonicalSymbol?.(intent.symbol) ?? toCanonicalFallbackSymbol(intent.symbol)
        },
        ctx
      );
    }

    if (intent.type === "close") {
      return this.executeCloseIntent(intent);
    }

    return { status: "noop" };
  }

  // Keep exchange dependency encapsulated inside engine.
  protected get exchange(): FuturesExchange {
    return this.ex;
  }
}
