import { DummyStrategy } from "@mm/strategies";
import type { RiskEventType } from "../db.js";
import {
  loadLatestPredictionStateForGate,
  writeRiskEvent
} from "../db.js";
import { log } from "../logger.js";
import {
  applySizeMultiplierToIntent,
  evaluateGate,
  getPredictionGateMetrics,
  readPredictionGatePolicy,
  recordPredictionGateDecision,
  type PredictionGateResult
} from "../prediction-gate.js";
import { defaultGateSummary } from "../runtime/decisionTrace.js";
import type { SignalDecision, SignalEngine } from "./types.js";

type Dependencies = {
  loadLatestPredictionStateForGateFn?: typeof loadLatestPredictionStateForGate;
  writeRiskEventFn?: typeof writeRiskEvent;
  evaluateGateFn?: typeof evaluateGate;
  applySizeMultiplierToIntentFn?: typeof applySizeMultiplierToIntent;
  readPredictionGatePolicyFn?: typeof readPredictionGatePolicy;
  recordPredictionGateDecisionFn?: typeof recordPredictionGateDecision;
  getPredictionGateMetricsFn?: typeof getPredictionGateMetrics;
  logInfoFn?: (payload: Record<string, unknown>, message: string) => void;
};

function toSignalSideFromIntent(intent: SignalDecision["legacyIntent"]): SignalDecision["side"] {
  if (intent.type !== "open") return "flat";
  return intent.side === "short" ? "short" : "long";
}

function getIntentConfidence(intent: SignalDecision["legacyIntent"]): number | null {
  if (intent.type !== "open") return null;
  const parsed = Number(intent.confidence);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createLegacyDummySignalEngine(deps: Dependencies = {}): SignalEngine {
  const loadPrediction = deps.loadLatestPredictionStateForGateFn ?? loadLatestPredictionStateForGate;
  const writeRiskEventFn = deps.writeRiskEventFn ?? writeRiskEvent;
  const evaluateGateFn = deps.evaluateGateFn ?? evaluateGate;
  const applyMultiplier = deps.applySizeMultiplierToIntentFn ?? applySizeMultiplierToIntent;
  const readPolicy = deps.readPredictionGatePolicyFn ?? readPredictionGatePolicy;
  const recordDecision = deps.recordPredictionGateDecisionFn ?? recordPredictionGateDecision;
  const getMetrics = deps.getPredictionGateMetricsFn ?? getPredictionGateMetrics;
  const logInfo = deps.logInfoFn ?? ((payload, message) => {
    log.info(payload, message);
  });

  return {
    key: "legacy_dummy",
    async decide(ctx) {
      const strategyIntent = await DummyStrategy.onTick({
        nowMs: ctx.now.getTime(),
        symbol: ctx.bot.symbol
      });

      const policy = readPolicy(ctx.bot.paramsJson ?? {});
      let intent = strategyIntent;
      let gateSummary = defaultGateSummary();
      let blockedBySignal = false;

      if (strategyIntent.type === "open" && policy.enabled) {
        gateSummary = {
          applied: true,
          allow: true,
          reason: "allowed",
          sizeMultiplier: 1,
          timeframe: policy.timeframe
        };

        let predictionGateResult: PredictionGateResult;
        let predictionState: Awaited<ReturnType<typeof loadLatestPredictionStateForGate>> = null;
        let gateError: string | null = null;

        try {
          predictionState = await loadPrediction({
            userId: ctx.bot.userId,
            exchange: ctx.bot.exchange,
            exchangeAccountId: ctx.bot.exchangeAccountId,
            symbol: ctx.bot.symbol,
            marketType: "perp",
            timeframe: policy.timeframe
          });
          predictionGateResult = evaluateGateFn(policy, predictionState);
        } catch (error) {
          gateError = String(error);
          predictionGateResult = policy.failOpenOnError
            ? {
                allow: true,
                reason: "prediction_state_unavailable_fail_open",
                sizeMultiplier: policy.failOpenMultiplier
              }
            : {
                allow: false,
                reason: "prediction_state_unavailable",
                sizeMultiplier: 1
              };
        }

        gateSummary = {
          applied: true,
          allow: predictionGateResult.allow,
          reason: predictionGateResult.reason,
          sizeMultiplier: predictionGateResult.sizeMultiplier,
          timeframe: policy.timeframe
        };

        recordDecision(predictionGateResult);
        const gateMetrics = getMetrics();

        const riskEventType: RiskEventType = predictionGateResult.allow
          ? predictionGateResult.reason === "prediction_state_unavailable_fail_open"
            ? "PREDICTION_GATE_FAIL_OPEN"
            : "PREDICTION_GATE_ALLOW"
          : "PREDICTION_GATE_BLOCK";

        await writeRiskEventFn({
          botId: ctx.bot.id,
          type: riskEventType,
          message: predictionGateResult.reason,
          meta: {
            timeframe: policy.timeframe,
            minConfidence: policy.minConfidence,
            maxAgeSec: policy.maxAgeSec,
            allowSignals: policy.allowSignals,
            blockTags: policy.blockTags,
            sizeMultiplier: predictionGateResult.sizeMultiplier,
            confidence: predictionState ? Number(predictionState.confidence) : null,
            signal: predictionState?.signal ?? null,
            tags: predictionState?.tags ?? [],
            predictionUpdatedAt: predictionState?.tsUpdated?.toISOString?.() ?? null,
            gateError
          }
        });

        logInfo(
          {
            botId: ctx.bot.id,
            symbol: ctx.bot.symbol,
            timeframe: policy.timeframe,
            confidence: predictionState ? Number(predictionState.confidence) : null,
            tags: predictionState?.tags ?? [],
            decision: predictionGateResult.allow ? "allow" : "deny",
            reason: predictionGateResult.reason,
            sizeMultiplier: predictionGateResult.sizeMultiplier,
            allowedCount: gateMetrics.allowedCount,
            gatedCount: gateMetrics.gatedCount,
            avgMultiplier: gateMetrics.avgMultiplier
          },
          "prediction gate decision"
        );

        if (!predictionGateResult.allow) {
          blockedBySignal = true;
        } else {
          intent = applyMultiplier(strategyIntent, predictionGateResult.sizeMultiplier);
        }
      }

      return {
        side: toSignalSideFromIntent(intent),
        confidence: getIntentConfidence(intent),
        reason: blockedBySignal ? gateSummary.reason : "signal_ready",
        metadata: {
          strategyKey: ctx.bot.strategyKey,
          blockedBySignal,
          signalIntentType: strategyIntent.type,
          gate: gateSummary
        },
        legacyIntent: blockedBySignal ? strategyIntent : intent
      };
    }
  };
}
