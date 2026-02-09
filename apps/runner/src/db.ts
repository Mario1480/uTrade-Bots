import { prisma } from "@mm/db";
import type { TradeIntent } from "@mm/futures-core";
import { decryptSecret } from "./secret-crypto.js";

const db = prisma as any;

export type BotStatusValue = "running" | "stopped" | "error";

export type ActiveFuturesBot = {
  id: string;
  userId: string;
  name: string;
  symbol: string;
  exchange: string;
  exchangeAccountId: string;
  strategyKey: string;
  marginMode: "isolated" | "cross";
  leverage: number;
  paramsJson: Record<string, unknown>;
  tickMs: number;
  credentials: {
    apiKey: string;
    apiSecret: string;
    passphrase: string | null;
  };
};

export type BotRuntimeCircuitBreakerState = {
  consecutiveErrors: number;
  errorWindowStartAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
};

export type RiskEventType = "KILL_SWITCH_BLOCK" | "CIRCUIT_BREAKER_TRIPPED" | "BOT_ERROR";

function mapRowToActiveBot(bot: any): ActiveFuturesBot {
  return {
    id: bot.id,
    userId: bot.userId,
    name: bot.name,
    symbol: bot.symbol,
    exchange: bot.exchange,
    exchangeAccountId: bot.exchangeAccountId,
    strategyKey: bot.futuresConfig.strategyKey,
    marginMode: bot.futuresConfig.marginMode,
    leverage: bot.futuresConfig.leverage,
    paramsJson: (bot.futuresConfig.paramsJson ?? {}) as Record<string, unknown>,
    tickMs: bot.futuresConfig?.tickMs ?? 1000,
    credentials: {
      apiKey: decryptSecret(bot.exchangeAccount.apiKeyEnc),
      apiSecret: decryptSecret(bot.exchangeAccount.apiSecretEnc),
      passphrase: bot.exchangeAccount.passphraseEnc
        ? decryptSecret(bot.exchangeAccount.passphraseEnc)
        : null
    }
  };
}

function canExecuteRow(bot: any): boolean {
  return Boolean(bot && bot.userId && bot.exchangeAccountId && bot.futuresConfig && bot.exchangeAccount);
}

export async function getBotStatus(botId: string): Promise<BotStatusValue | null> {
  const bot = await db.bot.findUnique({
    where: { id: botId },
    select: { status: true }
  });
  if (!bot) return null;
  return bot.status as BotStatusValue;
}

export async function getBotRuntimeCircuitBreakerState(
  botId: string
): Promise<BotRuntimeCircuitBreakerState> {
  const runtime = await db.botRuntime.findUnique({
    where: { botId },
    select: {
      consecutiveErrors: true,
      errorWindowStartAt: true,
      lastErrorAt: true,
      lastErrorMessage: true
    }
  });

  return {
    consecutiveErrors: Number(runtime?.consecutiveErrors ?? 0),
    errorWindowStartAt: runtime?.errorWindowStartAt ?? null,
    lastErrorAt: runtime?.lastErrorAt ?? null,
    lastErrorMessage: runtime?.lastErrorMessage ?? null
  };
}

export async function loadBotForExecution(botId: string): Promise<ActiveFuturesBot | null> {
  const bot = await db.bot.findUnique({
    where: { id: botId },
    include: {
      futuresConfig: {
        select: {
          strategyKey: true,
          marginMode: true,
          leverage: true,
          tickMs: true,
          paramsJson: true
        }
      },
      exchangeAccount: {
        select: {
          id: true,
          apiKeyEnc: true,
          apiSecretEnc: true,
          passphraseEnc: true
        }
      }
    }
  });

  if (!bot || !canExecuteRow(bot)) return null;
  return mapRowToActiveBot(bot);
}

export async function loadActiveFuturesBots(): Promise<ActiveFuturesBot[]> {
  const bots = await db.bot.findMany({
    where: {
      status: "running",
      userId: { not: null },
      exchangeAccountId: { not: null },
      futuresConfig: { isNot: null }
    },
    include: {
      futuresConfig: {
        select: {
          strategyKey: true,
          marginMode: true,
          leverage: true,
          tickMs: true,
          paramsJson: true
        }
      },
      exchangeAccount: {
        select: {
          id: true,
          apiKeyEnc: true,
          apiSecretEnc: true,
          passphraseEnc: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  return (bots as any[]).filter(canExecuteRow).map(mapRowToActiveBot);
}

export async function upsertBotRuntime(params: {
  botId: string;
  status: BotStatusValue;
  reason?: string | null;
  workerId?: string | null;
  lastHeartbeatAt?: Date | null;
  lastTickAt?: Date | null;
  stateJson?: Record<string, unknown> | null;
  lastError?: string | null;
  consecutiveErrors?: number;
  errorWindowStartAt?: Date | null;
  lastErrorAt?: Date | null;
  lastErrorMessage?: string | null;
}) {
  const updateData: any = {
    status: params.status,
    updatedAt: new Date()
  };

  const createData: any = {
    botId: params.botId,
    status: params.status
  };

  if ("reason" in params) {
    updateData.reason = params.reason ?? null;
    createData.reason = params.reason ?? null;
  }
  if ("workerId" in params) {
    updateData.workerId = params.workerId ?? null;
    createData.workerId = params.workerId ?? null;
  }
  if ("lastHeartbeatAt" in params) {
    updateData.lastHeartbeatAt = params.lastHeartbeatAt ?? null;
    createData.lastHeartbeatAt = params.lastHeartbeatAt ?? null;
  }
  if ("lastTickAt" in params) {
    updateData.lastTickAt = params.lastTickAt ?? null;
    createData.lastTickAt = params.lastTickAt ?? null;
  }
  if ("stateJson" in params) {
    updateData.stateJson = params.stateJson ?? null;
    createData.stateJson = params.stateJson ?? null;
  }
  if ("lastError" in params) {
    updateData.lastError = params.lastError ?? null;
    createData.lastError = params.lastError ?? null;
  }
  if ("consecutiveErrors" in params) {
    updateData.consecutiveErrors = params.consecutiveErrors ?? 0;
    createData.consecutiveErrors = params.consecutiveErrors ?? 0;
  }
  if ("errorWindowStartAt" in params) {
    updateData.errorWindowStartAt = params.errorWindowStartAt ?? null;
    createData.errorWindowStartAt = params.errorWindowStartAt ?? null;
  }
  if ("lastErrorAt" in params) {
    updateData.lastErrorAt = params.lastErrorAt ?? null;
    createData.lastErrorAt = params.lastErrorAt ?? null;
  }
  if ("lastErrorMessage" in params) {
    updateData.lastErrorMessage = params.lastErrorMessage ?? null;
    createData.lastErrorMessage = params.lastErrorMessage ?? null;
  }

  await db.botRuntime.upsert({
    where: { botId: params.botId },
    update: updateData,
    create: createData
  });
}

export async function writeBotTick(params: {
  botId: string;
  status: "running" | "error";
  reason: string | null;
  intent: TradeIntent;
  workerId?: string | null;
}) {
  const now = new Date();
  await upsertBotRuntime({
    botId: params.botId,
    status: params.status,
    reason: params.reason,
    workerId: params.workerId ?? null,
    lastHeartbeatAt: now,
    lastTickAt: now,
    stateJson: {
      intentType: params.intent.type
    },
    ...(params.status === "error" ? { lastError: params.reason } : {})
  });
}

export async function writeRiskEvent(params: {
  botId: string;
  type: RiskEventType;
  message?: string | null;
  meta?: Record<string, unknown> | null;
}) {
  await db.riskEvent.create({
    data: {
      botId: params.botId,
      type: params.type,
      message: params.message ?? null,
      meta: params.meta ?? null
    }
  });
}

export async function markExchangeAccountUsed(exchangeAccountId: string) {
  await db.exchangeAccount.update({
    where: { id: exchangeAccountId },
    data: { lastUsedAt: new Date() }
  });
}

export async function markBotAsError(botId: string, reason: string) {
  await db.bot.update({
    where: { id: botId },
    data: {
      status: "error",
      lastError: reason
    }
  });
}

export async function markRunnerHeartbeat(params: {
  botsRunning: number;
  botsErrored: number;
}) {
  await db.runnerStatus.upsert({
    where: { id: "main" },
    update: {
      lastTickAt: new Date(),
      botsRunning: params.botsRunning,
      botsErrored: params.botsErrored,
      version: process.env.VERSION ?? null
    },
    create: {
      id: "main",
      lastTickAt: new Date(),
      botsRunning: params.botsRunning,
      botsErrored: params.botsErrored,
      version: process.env.VERSION ?? null
    }
  });
}

export async function getRunnerBotCounters(): Promise<{ botsRunning: number; botsErrored: number }> {
  const [botsRunning, botsErrored] = await Promise.all([
    db.bot.count({ where: { status: "running" } }),
    db.bot.count({ where: { status: "error" } })
  ]);

  return { botsRunning, botsErrored };
}
