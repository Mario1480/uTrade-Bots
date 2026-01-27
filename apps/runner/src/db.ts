import { prisma } from "@mm/db";
import type { MarketMakingConfig, RiskConfig, VolumeConfig, NotificationConfig, PriceSupportConfig } from "@mm/core";

export async function loadBotAndConfigs(botId: string) {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    include: {
      mmConfig: true,
      volConfig: true,
      riskConfig: true,
      notificationConfig: true,
      priceSupportConfig: true
    }
  });

  if (!bot) throw new Error(`Bot not found in DB: ${botId}`);

  if (!bot.mmConfig || !bot.volConfig || !bot.riskConfig) {
    throw new Error(`Bot missing configs (mm/vol/risk): ${botId}`);
  }

  const mm: MarketMakingConfig = {
    spreadPct: bot.mmConfig.spreadPct,
    maxSpreadPct: bot.mmConfig.maxSpreadPct,
    levelsUp: bot.mmConfig.levelsUp,
    levelsDown: bot.mmConfig.levelsDown,
    budgetQuoteUsdt: bot.mmConfig.budgetQuoteUsdt,
    budgetBaseToken: bot.mmConfig.budgetBaseToken,
    minOrderUsdt: bot.mmConfig.minOrderUsdt ?? 0,
    maxOrderUsdt: bot.mmConfig.maxOrderUsdt ?? 0,
    distribution: bot.mmConfig.distribution as any,
    jitterPct: bot.mmConfig.jitterPct,
    skewFactor: bot.mmConfig.skewFactor,
    maxSkew: bot.mmConfig.maxSkew
  };

  const vol: VolumeConfig = {
    dailyNotionalUsdt: bot.volConfig.dailyNotionalUsdt,
    minTradeUsdt: bot.volConfig.minTradeUsdt,
    maxTradeUsdt: bot.volConfig.maxTradeUsdt,
    activeFrom: "00:00",
    activeTo: "23:59",
    mode: bot.volConfig.mode as any,
    buyPct: bot.volConfig.buyPct ?? 0.5,
    buyBumpTicks: bot.volConfig.buyBumpTicks ?? 0,
    sellBumpTicks: bot.volConfig.sellBumpTicks ?? 0
  };

  const risk: RiskConfig = {
    minUsdt: bot.riskConfig.minUsdt,
    maxDeviationPct: bot.riskConfig.maxDeviationPct,
    maxOpenOrders: bot.riskConfig.maxOpenOrders,
    maxDailyLoss: bot.riskConfig.maxDailyLoss
  };

  let notificationConfig: NotificationConfig;
  if (bot.notificationConfig) {
    notificationConfig = {
      fundsWarnEnabled: bot.notificationConfig.fundsWarnEnabled,
      fundsWarnPct: bot.notificationConfig.fundsWarnPct
    };
  } else {
    const created = await prisma.botNotificationConfig.create({
      data: { botId }
    });
    notificationConfig = {
      fundsWarnEnabled: created.fundsWarnEnabled,
      fundsWarnPct: created.fundsWarnPct
    };
  }

  let priceSupportConfig: PriceSupportConfig;
  if (bot.priceSupportConfig) {
    priceSupportConfig = {
      enabled: bot.priceSupportConfig.enabled,
      active: bot.priceSupportConfig.active,
      floorPrice: bot.priceSupportConfig.floorPrice,
      budgetUsdt: bot.priceSupportConfig.budgetUsdt,
      spentUsdt: bot.priceSupportConfig.spentUsdt,
      maxOrderUsdt: bot.priceSupportConfig.maxOrderUsdt,
      cooldownMs: bot.priceSupportConfig.cooldownMs,
      mode: bot.priceSupportConfig.mode as any,
      lastActionAt: Number(bot.priceSupportConfig.lastActionAt ?? 0),
      stoppedReason: bot.priceSupportConfig.stoppedReason,
      notifiedBudgetExhaustedAt: Number(bot.priceSupportConfig.notifiedBudgetExhaustedAt ?? 0)
    };
  } else {
    const created = await prisma.botPriceSupportConfig.create({
      data: {
        botId,
        enabled: false,
        active: true,
        floorPrice: null,
        budgetUsdt: 0,
        spentUsdt: 0,
        maxOrderUsdt: 50,
        cooldownMs: 2000,
        mode: "PASSIVE",
        lastActionAt: BigInt(0),
        stoppedReason: null,
        notifiedBudgetExhaustedAt: BigInt(0)
      }
    });
    priceSupportConfig = {
      enabled: created.enabled,
      active: created.active,
      floorPrice: created.floorPrice,
      budgetUsdt: created.budgetUsdt,
      spentUsdt: created.spentUsdt,
      maxOrderUsdt: created.maxOrderUsdt,
      cooldownMs: created.cooldownMs,
      mode: created.mode as any,
      lastActionAt: Number(created.lastActionAt ?? 0),
      stoppedReason: created.stoppedReason,
      notifiedBudgetExhaustedAt: Number(created.notifiedBudgetExhaustedAt ?? 0)
    };
  }

  return { bot, mm, vol, risk, notificationConfig, priceSupportConfig };
}

export async function loadLatestBotAndConfigs() {
  const bot = await prisma.bot.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      mmConfig: true,
      volConfig: true,
      riskConfig: true,
      notificationConfig: true,
      priceSupportConfig: true
    }
  });

  if (!bot) throw new Error("No bots found in DB");
  if (!bot.mmConfig || !bot.volConfig || !bot.riskConfig) {
    throw new Error(`Bot missing configs (mm/vol/risk): ${bot.id}`);
  }

  const mm: MarketMakingConfig = {
    spreadPct: bot.mmConfig.spreadPct,
    maxSpreadPct: bot.mmConfig.maxSpreadPct,
    levelsUp: bot.mmConfig.levelsUp,
    levelsDown: bot.mmConfig.levelsDown,
    budgetQuoteUsdt: bot.mmConfig.budgetQuoteUsdt,
    budgetBaseToken: bot.mmConfig.budgetBaseToken,
    minOrderUsdt: bot.mmConfig.minOrderUsdt ?? 0,
    maxOrderUsdt: bot.mmConfig.maxOrderUsdt ?? 0,
    distribution: bot.mmConfig.distribution as any,
    jitterPct: bot.mmConfig.jitterPct,
    skewFactor: bot.mmConfig.skewFactor,
    maxSkew: bot.mmConfig.maxSkew
  };

  const vol: VolumeConfig = {
    dailyNotionalUsdt: bot.volConfig.dailyNotionalUsdt,
    minTradeUsdt: bot.volConfig.minTradeUsdt,
    maxTradeUsdt: bot.volConfig.maxTradeUsdt,
    activeFrom: "00:00",
    activeTo: "23:59",
    mode: bot.volConfig.mode as any,
    buyPct: bot.volConfig.buyPct ?? 0.5,
    buyBumpTicks: bot.volConfig.buyBumpTicks ?? 0,
    sellBumpTicks: bot.volConfig.sellBumpTicks ?? 0
  };

  const risk: RiskConfig = {
    minUsdt: bot.riskConfig.minUsdt,
    maxDeviationPct: bot.riskConfig.maxDeviationPct,
    maxOpenOrders: bot.riskConfig.maxOpenOrders,
    maxDailyLoss: bot.riskConfig.maxDailyLoss
  };

  let notificationConfig: NotificationConfig;
  if (bot.notificationConfig) {
    notificationConfig = {
      fundsWarnEnabled: bot.notificationConfig.fundsWarnEnabled,
      fundsWarnPct: bot.notificationConfig.fundsWarnPct
    };
  } else {
    const created = await prisma.botNotificationConfig.create({
      data: { botId: bot.id }
    });
    notificationConfig = {
      fundsWarnEnabled: created.fundsWarnEnabled,
      fundsWarnPct: created.fundsWarnPct
    };
  }

  let priceSupportConfig: PriceSupportConfig;
  if (bot.priceSupportConfig) {
    priceSupportConfig = {
      enabled: bot.priceSupportConfig.enabled,
      active: bot.priceSupportConfig.active,
      floorPrice: bot.priceSupportConfig.floorPrice,
      budgetUsdt: bot.priceSupportConfig.budgetUsdt,
      spentUsdt: bot.priceSupportConfig.spentUsdt,
      maxOrderUsdt: bot.priceSupportConfig.maxOrderUsdt,
      cooldownMs: bot.priceSupportConfig.cooldownMs,
      mode: bot.priceSupportConfig.mode as any,
      lastActionAt: Number(bot.priceSupportConfig.lastActionAt ?? 0),
      stoppedReason: bot.priceSupportConfig.stoppedReason,
      notifiedBudgetExhaustedAt: Number(bot.priceSupportConfig.notifiedBudgetExhaustedAt ?? 0)
    };
  } else {
    const created = await prisma.botPriceSupportConfig.create({
      data: {
        botId: bot.id,
        enabled: false,
        active: true,
        floorPrice: null,
        budgetUsdt: 0,
        spentUsdt: 0,
        maxOrderUsdt: 50,
        cooldownMs: 2000,
        mode: "PASSIVE",
        lastActionAt: BigInt(0),
        stoppedReason: null,
        notifiedBudgetExhaustedAt: BigInt(0)
      }
    });
    priceSupportConfig = {
      enabled: created.enabled,
      active: created.active,
      floorPrice: created.floorPrice,
      budgetUsdt: created.budgetUsdt,
      spentUsdt: created.spentUsdt,
      maxOrderUsdt: created.maxOrderUsdt,
      cooldownMs: created.cooldownMs,
      mode: created.mode as any,
      lastActionAt: Number(created.lastActionAt ?? 0),
      stoppedReason: created.stoppedReason,
      notifiedBudgetExhaustedAt: Number(created.notifiedBudgetExhaustedAt ?? 0)
    };
  }

  return { bot, mm, vol, risk, notificationConfig, priceSupportConfig };
}

export async function loadCexConfig(exchange: string) {
  const cfg = await prisma.cexConfig.findUnique({ where: { exchange } });

  if (!cfg) throw new Error(`CEX config not found for exchange: ${exchange}`);
  if (!cfg.apiKey || !cfg.apiSecret) {
    throw new Error(`CEX config incomplete for exchange: ${exchange}`);
  }

  return cfg;
}

export async function loadRunningBotIds() {
  const bots = await prisma.bot.findMany({
    where: { status: "RUNNING" },
    select: { id: true }
  });
  return bots.map((b) => b.id);
}

export async function getRuntimeCounts() {
  const [botsRunning, botsErrored] = await Promise.all([
    prisma.botRuntime.count({ where: { status: "RUNNING" } }),
    prisma.botRuntime.count({ where: { status: "ERROR" } })
  ]);
  return { botsRunning, botsErrored };
}

export async function getBotCount() {
  return prisma.bot.count();
}

export async function getCexCount() {
  return prisma.cexConfig.count();
}

export async function upsertRunnerStatus(params: {
  lastTickAt: Date;
  botsRunning: number;
  botsErrored: number;
  version?: string | null;
}) {
  await prisma.runnerStatus.upsert({
    where: { id: "main" },
    create: {
      id: "main",
      lastTickAt: params.lastTickAt,
      botsRunning: params.botsRunning,
      botsErrored: params.botsErrored,
      version: params.version ?? null
    },
    update: {
      lastTickAt: params.lastTickAt,
      botsRunning: params.botsRunning,
      botsErrored: params.botsErrored,
      version: params.version ?? undefined
    }
  });
}

export async function writeRuntime(params: {
  botId: string;
  status: string;
  reason?: string | null;
  lastHealthyAt?: Date | null;
  mid?: number | null;
  bid?: number | null;
  ask?: number | null;
  openOrders?: number | null;
  openOrdersMm?: number | null;
  openOrdersVol?: number | null;
  lastVolClientOrderId?: string | null;
  freeUsdt?: number | null;
  freeBase?: number | null;
  tradedNotionalToday?: number | null;
}) {
  await prisma.botRuntime.upsert({
    where: { botId: params.botId },
    create: {
      botId: params.botId,
      status: params.status,
      reason: params.reason ?? null,
      lastHealthyAt: params.lastHealthyAt ?? null,
      mid: params.mid ?? null,
      bid: params.bid ?? null,
      ask: params.ask ?? null,
      openOrders: params.openOrders ?? null,
      openOrdersMm: params.openOrdersMm ?? null,
      openOrdersVol: params.openOrdersVol ?? null,
      lastVolClientOrderId: params.lastVolClientOrderId ?? null,
      freeUsdt: params.freeUsdt ?? null,
      freeBase: params.freeBase ?? null,
      tradedNotionalToday: params.tradedNotionalToday ?? null
    },
    update: {
      status: params.status,
      reason: params.reason ?? null,
      lastHealthyAt: params.lastHealthyAt ?? undefined,
      mid: params.mid ?? null,
      bid: params.bid ?? null,
      ask: params.ask ?? null,
      openOrders: params.openOrders ?? null,
      openOrdersMm: params.openOrdersMm ?? null,
      openOrdersVol: params.openOrdersVol ?? null,
      lastVolClientOrderId: params.lastVolClientOrderId ?? null,
      freeUsdt: params.freeUsdt ?? null,
      freeBase: params.freeBase ?? null,
      tradedNotionalToday: params.tradedNotionalToday ?? null
    }
  });
}

export async function writeBotMetric(params: {
  botId: string;
  ts?: Date;
  mid?: number | null;
  bid?: number | null;
  ask?: number | null;
  spreadPct?: number | null;
  openOrders?: number | null;
  freeQuote?: number | null;
  freeBase?: number | null;
  inventoryQuoteValue?: number | null;
  tradedNotionalToday?: number | null;
  mmOrders?: number | null;
  volOrders?: number | null;
  status?: string | null;
  reason?: string | null;
}) {
  await prisma.botMetric.create({
    data: {
      botId: params.botId,
      ts: params.ts ?? new Date(),
      mid: params.mid ?? null,
      bid: params.bid ?? null,
      ask: params.ask ?? null,
      spreadPct: params.spreadPct ?? null,
      openOrders: params.openOrders ?? null,
      freeQuote: params.freeQuote ?? null,
      freeBase: params.freeBase ?? null,
      inventoryQuoteValue: params.inventoryQuoteValue ?? null,
      tradedNotionalToday: params.tradedNotionalToday ?? null,
      mmOrders: params.mmOrders ?? null,
      volOrders: params.volOrders ?? null,
      status: params.status ?? null,
      reason: params.reason ?? null
    }
  });
}

export async function writeAlert(params: {
  botId: string;
  level: "info" | "warn" | "error";
  title: string;
  message?: string | null;
}) {
  await prisma.botAlert.create({
    data: {
      botId: params.botId,
      level: params.level,
      title: params.title,
      message: params.message ?? null
    }
  });
}

export async function loadSystemSettings() {
  const row = await prisma.globalSetting.findUnique({ where: { key: "system" } });
  const raw = (row?.value as Record<string, any>) ?? {};
  return {
    tradingEnabled: raw.tradingEnabled ?? true,
    readOnlyMode: raw.readOnlyMode ?? false
  };
}

export async function loadLicenseConfig() {
  const row = await prisma.globalSetting.findUnique({ where: { key: "license.config" } });
  const raw = (row?.value as Record<string, any>) ?? {};
  return {
    licenseKey: raw.licenseKey ?? null,
    instanceId: raw.instanceId ?? null
  };
}

export async function updateBotFlags(params: {
  botId: string;
  status?: string;
  mmEnabled?: boolean;
  volEnabled?: boolean;
}) {
  const data: Record<string, any> = {};
  if (params.status !== undefined) data.status = params.status;
  if (params.mmEnabled !== undefined) data.mmEnabled = params.mmEnabled;
  if (params.volEnabled !== undefined) data.volEnabled = params.volEnabled;
  if (Object.keys(data).length === 0) return;
  await prisma.bot.update({ where: { id: params.botId }, data });
}

export async function updatePriceSupportConfig(botId: string, data: Record<string, any>) {
  return prisma.botPriceSupportConfig.update({
    where: { botId },
    data
  });
}

export async function incrementPriceSupportSpent(botId: string, amount: number) {
  return prisma.botPriceSupportConfig.update({
    where: { botId },
    data: {
      spentUsdt: { increment: amount }
    }
  });
}

export async function upsertOrderMap(params: {
  botId: string;
  symbol: string;
  orderId: string;
  clientOrderId: string;
}) {
  if (!params.orderId || !params.clientOrderId) return;
  await prisma.botOrderMap.upsert({
    where: {
      botId_symbol_orderId: {
        botId: params.botId,
        symbol: params.symbol,
        orderId: params.orderId
      }
    },
    update: { clientOrderId: params.clientOrderId },
    create: {
      botId: params.botId,
      symbol: params.symbol,
      orderId: params.orderId,
      clientOrderId: params.clientOrderId
    }
  });
}
