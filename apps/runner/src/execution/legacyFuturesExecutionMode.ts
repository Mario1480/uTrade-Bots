import { FuturesEngine, isGlobalTradingEnabled, type EngineRiskEvent } from "@mm/futures-engine";
import type { RiskEventType } from "../db.js";
import { writeRiskEvent } from "../db.js";
import {
  coerceGateSummary,
  defaultGateSummary
} from "../runtime/decisionTrace.js";
import type { ExecutionMode, ExecutionResult } from "./types.js";

type Dependencies = {
  engine?: FuturesEngine;
  writeRiskEventFn?: typeof writeRiskEvent;
};

const noopExchange = {
  async getAccountState() {
    return { equity: 0 };
  },
  async getPositions() {
    return [];
  },
  async setLeverage() {
    return;
  },
  async placeOrder() {
    return { orderId: "noop" };
  },
  async cancelOrder() {
    return;
  }
};

function mapEngineEventToRiskType(event: EngineRiskEvent): RiskEventType {
  return event.type === "KILL_SWITCH_BLOCK" ? "KILL_SWITCH_BLOCK" : "BOT_ERROR";
}

export function createLegacyFuturesExecutionMode(deps: Dependencies = {}): ExecutionMode {
  const engine = deps.engine ?? new FuturesEngine(noopExchange, {
    isTradingEnabled: () => isGlobalTradingEnabled()
  });
  const writeRiskEventFn = deps.writeRiskEventFn ?? writeRiskEvent;

  return {
    key: "futures_engine",
    async execute(signal, ctx): Promise<ExecutionResult> {
      const gate = coerceGateSummary(signal.metadata.gate, defaultGateSummary());
      const engineResult = await engine.execute(signal.legacyIntent, {
        botId: ctx.bot.id,
        emitRiskEvent: async (event) => {
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: mapEngineEventToRiskType(event),
            message: event.message,
            meta: {
              engineType: event.type,
              ...event.meta,
              timestamp: event.timestamp
            }
          });
        }
      });

      if (engineResult.status === "blocked") {
        return {
          status: "blocked",
          reason: engineResult.reason,
          metadata: {
            engineStatus: engineResult.status,
            engineReason: engineResult.reason,
            preserveReason: false
          },
          legacy: {
            outcome: "blocked",
            intent: signal.legacyIntent,
            gate
          }
        };
      }

      if (engineResult.status === "noop") {
        return {
          status: "noop",
          reason: "noop",
          metadata: {
            engineStatus: engineResult.status,
            preserveReason: false
          },
          legacy: {
            outcome: "ok",
            intent: signal.legacyIntent,
            gate
          }
        };
      }

      return {
        status: "executed",
        reason: "accepted",
        orderIds: engineResult.orderId ? [engineResult.orderId] : undefined,
        metadata: {
          engineStatus: engineResult.status,
          preserveReason: false
        },
        legacy: {
          outcome: "ok",
          intent: signal.legacyIntent,
          gate
        }
      };
    }
  };
}
