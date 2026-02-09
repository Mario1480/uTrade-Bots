import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import { prisma } from "@mm/db";
import { BitgetFuturesAdapter } from "@mm/futures-exchange";
import {
  createSession,
  destroySession,
  getUserFromLocals,
  hashPassword,
  requireAuth,
  verifyPassword
} from "./auth.js";
import { decryptSecret, encryptSecret } from "./secret-crypto.js";
import {
  enforceBotStartLicense,
  getStubEntitlements,
  isLicenseEnforcementEnabled,
  isLicenseStubEnabled
} from "./license.js";
import {
  closeOrchestration,
  cancelBotRun,
  enqueueBotRun,
  getQueueMetrics,
  getRuntimeOrchestrationMode
} from "./orchestration.js";
import { ExchangeSyncError, syncExchangeAccount } from "./exchange-sync.js";
import {
  ManualTradingError,
  cancelAllOrders,
  closePositionsMarket,
  createBitgetAdapter,
  extractWsDataArray,
  getTradingSettings,
  listOpenOrders,
  listPositions,
  listSymbols,
  normalizeOrderBookPayload,
  normalizeSymbolInput,
  normalizeTickerPayload,
  normalizeTradesPayload,
  resolveTradingAccount,
  saveTradingSettings
} from "./trading.js";
import { generateAndPersistPrediction } from "./ai/predictionPipeline.js";

const db = prisma as any;

const app = express();
app.set("trust proxy", 1);

const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (origins.includes("http://localhost:3000") && !origins.includes("http://127.0.0.1:3000")) {
  origins.push("http://127.0.0.1:3000");
}
if (origins.includes("http://127.0.0.1:3000") && !origins.includes("http://localhost:3000")) {
  origins.push("http://localhost:3000");
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origins.includes("*") || origins.includes(origin)) return callback(null, true);
      return callback(new Error("not_allowed_by_cors"));
    },
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json());

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const exchangeCreateSchema = z.object({
  exchange: z.string().trim().min(1),
  label: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
  apiSecret: z.string().trim().min(1),
  passphrase: z.string().trim().optional()
}).superRefine((value, ctx) => {
  if (value.exchange.toLowerCase() === "bitget" && !value.passphrase) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["passphrase"],
      message: "passphrase is required for bitget"
    });
  }
});

const botCreateSchema = z.object({
  name: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  exchangeAccountId: z.string().trim().min(1),
  strategyKey: z.string().trim().min(1).default("dummy"),
  marginMode: z.enum(["isolated", "cross"]).default("isolated"),
  leverage: z.number().int().min(1).max(125).default(1),
  tickMs: z.number().int().min(100).max(60_000).default(1000),
  paramsJson: z.record(z.any()).default({})
});

const tradingSettingsSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).nullable().optional(),
  symbol: z.string().trim().min(1).nullable().optional(),
  timeframe: z.string().trim().min(1).nullable().optional()
});

const placeOrderSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  type: z.enum(["market", "limit"]),
  side: z.enum(["long", "short"]),
  qty: z.number().positive(),
  price: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().optional(),
  stopLossPrice: z.number().positive().optional(),
  reduceOnly: z.boolean().optional(),
  leverage: z.number().int().min(1).max(125).optional(),
  marginMode: z.enum(["isolated", "cross"]).optional()
}).superRefine((value, ctx) => {
  if (value.type === "limit" && value.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["price"],
      message: "price is required for limit orders"
    });
  }
});

const adjustLeverageSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  leverage: z.number().int().min(1).max(125),
  marginMode: z.enum(["isolated", "cross"]).default("cross")
});

const cancelOrderSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  orderId: z.string().trim().min(1),
  symbol: z.string().trim().min(1).optional()
});

const closePositionSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  side: z.enum(["long", "short"]).optional()
});

const predictionGenerateSchema = z.object({
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  tsCreated: z.string().datetime().optional(),
  prediction: z.object({
    signal: z.enum(["up", "down", "neutral"]),
    expectedMovePct: z.number(),
    confidence: z.number()
  }),
  featureSnapshot: z.record(z.any()),
  botId: z.string().trim().min(1).optional(),
  modelVersionBase: z.string().trim().min(1).optional()
});

type DashboardConnectionStatus = "connected" | "degraded" | "disconnected";

type ExchangeAccountOverview = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
  status: DashboardConnectionStatus;
  lastSyncAt: string | null;
  spotBudget: { total?: number | null; available?: number | null } | null;
  futuresBudget: { equity?: number | null; availableMargin?: number | null } | null;
  pnlTodayUsd: number | null;
  lastSyncError: { at: string | null; message: string | null } | null;
  bots: { running: number; stopped: number; error: number };
  alerts: { hasErrors: boolean; message?: string | null };
};

const DASHBOARD_CONNECTED_WINDOW_MS =
  Number(process.env.DASHBOARD_STATUS_CONNECTED_SECONDS ?? "120") * 1000;
const DASHBOARD_DEGRADED_WINDOW_MS =
  Number(process.env.DASHBOARD_STATUS_DEGRADED_SECONDS ?? "600") * 1000;
const EXCHANGE_AUTO_SYNC_INTERVAL_MS =
  Math.max(15, Number(process.env.EXCHANGE_AUTO_SYNC_INTERVAL_SECONDS ?? "60")) * 1000;
const EXCHANGE_AUTO_SYNC_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.EXCHANGE_AUTO_SYNC_ENABLED ?? "1").trim().toLowerCase()
);

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function resolveLastSyncAt(runtime: {
  lastHeartbeatAt?: Date | null;
  lastTickAt?: Date | null;
  updatedAt?: Date | null;
} | null | undefined): Date | null {
  if (!runtime) return null;
  const values = [runtime.lastHeartbeatAt, runtime.lastTickAt, runtime.updatedAt]
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime());
  return values[0] ?? null;
}

function computeConnectionStatus(
  lastSyncAt: Date | null,
  hasBotActivity: boolean
): DashboardConnectionStatus {
  if (!lastSyncAt) return hasBotActivity ? "disconnected" : "degraded";
  const ageMs = Date.now() - lastSyncAt.getTime();
  if (ageMs <= DASHBOARD_CONNECTED_WINDOW_MS) return "connected";
  if (ageMs <= DASHBOARD_DEGRADED_WINDOW_MS) return "degraded";
  return "disconnected";
}

function toSafeUser(user: { id: string; email: string }) {
  return { id: user.id, email: user.email };
}

function toSafeBot(bot: any) {
  return {
    id: bot.id,
    userId: bot.userId,
    exchangeAccountId: bot.exchangeAccountId ?? null,
    name: bot.name,
    exchange: bot.exchange,
    symbol: bot.symbol,
    status: bot.status,
    lastError: bot.lastError ?? null,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    exchangeAccount: bot.exchangeAccount
      ? {
          id: bot.exchangeAccount.id,
          exchange: bot.exchangeAccount.exchange,
          label: bot.exchangeAccount.label
        }
      : null,
    futuresConfig: bot.futuresConfig
      ? {
          strategyKey: bot.futuresConfig.strategyKey,
          marginMode: bot.futuresConfig.marginMode,
          leverage: bot.futuresConfig.leverage,
          tickMs: bot.futuresConfig.tickMs,
          paramsJson: bot.futuresConfig.paramsJson
        }
      : null,
    runtime: bot.runtime
      ? {
          status: bot.runtime.status,
          reason: bot.runtime.reason,
          updatedAt: bot.runtime.updatedAt,
          workerId: bot.runtime.workerId ?? null,
          lastHeartbeatAt: bot.runtime.lastHeartbeatAt ?? null,
          lastTickAt: bot.runtime.lastTickAt ?? null,
          lastError: bot.runtime.lastError ?? null,
          consecutiveErrors: bot.runtime.consecutiveErrors ?? 0,
          errorWindowStartAt: bot.runtime.errorWindowStartAt ?? null,
          lastErrorAt: bot.runtime.lastErrorAt ?? null,
          lastErrorMessage: bot.runtime.lastErrorMessage ?? null
        }
      : null
  };
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}

type ExchangeAccountSecrets = {
  id: string;
  exchange: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
};

function normalizeSyncErrorMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.slice(0, 500);
}

async function persistExchangeSyncSuccess(accountId: string, synced: Awaited<ReturnType<typeof syncExchangeAccount>>) {
  await db.exchangeAccount.update({
    where: { id: accountId },
    data: {
      lastUsedAt: synced.syncedAt,
      spotBudgetTotal: synced.spotBudget?.total ?? null,
      spotBudgetAvailable: synced.spotBudget?.available ?? null,
      futuresBudgetEquity: synced.futuresBudget.equity,
      futuresBudgetAvailableMargin: synced.futuresBudget.availableMargin,
      pnlTodayUsd: synced.pnlTodayUsd,
      lastSyncErrorAt: null,
      lastSyncErrorMessage: null
    }
  });
}

async function persistExchangeSyncFailure(accountId: string, errorMessage: string) {
  await db.exchangeAccount.update({
    where: { id: accountId },
    data: {
      lastSyncErrorAt: new Date(),
      lastSyncErrorMessage: normalizeSyncErrorMessage(errorMessage)
    }
  });
}

function decodeExchangeSecrets(account: ExchangeAccountSecrets): {
  apiKey: string;
  apiSecret: string;
  passphrase: string | null;
} {
  try {
    const apiKey = decryptSecret(account.apiKeyEnc);
    const apiSecret = decryptSecret(account.apiSecretEnc);
    const passphrase = account.passphraseEnc ? decryptSecret(account.passphraseEnc) : null;
    return { apiKey, apiSecret, passphrase };
  } catch {
    throw new ExchangeSyncError(
      "Failed to decrypt exchange credentials.",
      500,
      "exchange_secret_decrypt_failed"
    );
  }
}

async function executeExchangeSync(account: ExchangeAccountSecrets) {
  const secrets = decodeExchangeSecrets(account);
  return syncExchangeAccount({
    exchange: account.exchange,
    apiKey: secrets.apiKey,
    apiSecret: secrets.apiSecret,
    passphrase: secrets.passphrase
  });
}

let exchangeAutoSyncTimer: NodeJS.Timeout | null = null;
let exchangeAutoSyncRunning = false;

async function runExchangeAutoSyncCycle() {
  if (exchangeAutoSyncRunning) return;
  exchangeAutoSyncRunning = true;
  try {
    const accounts: ExchangeAccountSecrets[] = await db.exchangeAccount.findMany({
      where: { exchange: "bitget" },
      select: {
        id: true,
        exchange: true,
        apiKeyEnc: true,
        apiSecretEnc: true,
        passphraseEnc: true
      }
    });

    for (const account of accounts) {
      try {
        const synced = await executeExchangeSync(account);
        await persistExchangeSyncSuccess(account.id, synced);
      } catch (error) {
        const message =
          error instanceof ExchangeSyncError
            ? error.message
            : "Auto sync failed due to unexpected error.";
        await persistExchangeSyncFailure(account.id, message);
      }
    }
  } finally {
    exchangeAutoSyncRunning = false;
  }
}

function startExchangeAutoSyncScheduler() {
  if (!EXCHANGE_AUTO_SYNC_ENABLED) return;
  exchangeAutoSyncTimer = setInterval(() => {
    void runExchangeAutoSyncCycle();
  }, EXCHANGE_AUTO_SYNC_INTERVAL_MS);
  void runExchangeAutoSyncCycle();
}

function stopExchangeAutoSyncScheduler() {
  if (!exchangeAutoSyncTimer) return;
  clearInterval(exchangeAutoSyncTimer);
  exchangeAutoSyncTimer = null;
}

type WsAuthUser = {
  id: string;
  email: string;
};

type MarketWsContext = {
  adapter: BitgetFuturesAdapter;
  stop: () => Promise<void>;
};

function readCookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const entries = header.split(";");
  for (const entry of entries) {
    const [rawName, ...rest] = entry.trim().split("=");
    if (rawName !== name) continue;
    const value = rest.join("=");
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function authenticateWsUser(req: http.IncomingMessage): Promise<WsAuthUser | null> {
  const token = readCookieValue(req.headers.cookie, "mm_session");
  if (!token) return null;

  const session = await db.session.findUnique({
    where: {
      tokenHash: hashSessionToken(token)
    },
    include: {
      user: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  await db.session.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() }
  });

  return {
    id: session.user.id,
    email: session.user.email
  };
}

function wsReject(socket: any, statusCode: number, reason: string) {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function createMarketWsContext(
  userId: string,
  exchangeAccountId?: string | null
): Promise<{ accountId: string; ctx: MarketWsContext }> {
  const account = await resolveTradingAccount(userId, exchangeAccountId);
  const adapter = createBitgetAdapter(account);
  await adapter.contractCache.warmup();

  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    await adapter.close();
  };

  return {
    accountId: account.id,
    ctx: {
      adapter,
      stop
    }
  };
}

function pickWsSymbol(
  preferred: string | null | undefined,
  contracts: Array<{ canonicalSymbol: string; apiAllowed: boolean }>
): string | null {
  const normalizedPreferred = normalizeSymbolInput(preferred);
  if (normalizedPreferred && contracts.some((row) => row.canonicalSymbol === normalizedPreferred)) {
    return normalizedPreferred;
  }
  return contracts.find((row) => row.apiAllowed)?.canonicalSymbol ?? contracts[0]?.canonicalSymbol ?? null;
}

function sendManualTradingError(res: express.Response, error: unknown) {
  if (error instanceof ManualTradingError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      message: error.message
    });
  }

  const unknown = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    options?: {
      status?: unknown;
      code?: unknown;
      message?: unknown;
    };
  };

  const rawStatus = Number(unknown?.status ?? unknown?.options?.status);
  const status = Number.isFinite(rawStatus) && rawStatus >= 400 && rawStatus < 600
    ? rawStatus
    : 500;

  const code =
    typeof unknown?.code === "string" && unknown.code.trim()
      ? unknown.code
      : typeof unknown?.options?.code === "string" && unknown.options.code.trim()
        ? unknown.options.code
        : "manual_trading_unexpected_error";

  const message =
    error instanceof Error
      ? error.message
      : typeof unknown?.options?.message === "string" && unknown.options.message.trim()
        ? unknown.options.message
        : "Unexpected manual trading failure.";

  // eslint-disable-next-line no-console
  console.error("[manual-trading]", message, { status, code });

  return res.status(status).json({
    error: code,
    message
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api" });
});

app.get("/system/settings", (_req, res) => {
  res.json({
    tradingEnabled: true,
    readOnlyMode: false,
    orchestrationMode: getRuntimeOrchestrationMode()
  });
});

app.get("/license/state", (_req, res) => {
  res.json({
    enforcement: isLicenseEnforcementEnabled() ? "on" : "off",
    stubEnabled: isLicenseStubEnabled() ? "on" : "off"
  });
});

app.get("/license-server-stub/entitlements", (req, res) => {
  if (!isLicenseStubEnabled()) {
    return res.status(404).json({ error: "stub_disabled" });
  }

  const userId = typeof req.query.userId === "string" ? req.query.userId : "";
  return res.json({
    userId,
    ...getStubEntitlements()
  });
});

app.get("/admin/queue/metrics", requireAuth, async (_req, res) => {
  try {
    const metrics = await getQueueMetrics();
    return res.json(metrics);
  } catch (error) {
    return res.status(503).json({
      error: "queue_unavailable",
      reason: String(error)
    });
  }
});

app.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "email_already_exists" });

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.user.create({
    data: {
      email,
      passwordHash
    },
    select: {
      id: true,
      email: true
    }
  });

  await createSession(res, user.id);
  return res.status(201).json({ user: toSafeUser(user) });
});

app.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true
    }
  });
  if (!user?.passwordHash) return res.status(401).json({ error: "invalid_credentials" });

  const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!passwordOk) return res.status(401).json({ error: "invalid_credentials" });

  await createSession(res, user.id);
  return res.json({ user: toSafeUser(user) });
});

app.post("/auth/logout", async (req, res) => {
  const token = req.cookies?.mm_session ?? null;
  await destroySession(res, token);
  return res.json({ ok: true });
});

app.get("/auth/me", requireAuth, async (_req, res) => {
  return res.json({ user: getUserFromLocals(res) });
});

app.get("/api/trading/settings", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const settings = await getTradingSettings(user.id);
  return res.json(settings);
});

app.post("/api/trading/settings", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = tradingSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const settings = await saveTradingSettings(user.id, parsed.data);
  return res.json(settings);
});

app.post("/api/predictions/generate", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const payload = parsed.data;
  const tsCreated = payload.tsCreated ?? new Date().toISOString();

  const created = await generateAndPersistPrediction({
    symbol: payload.symbol,
    marketType: payload.marketType,
    timeframe: payload.timeframe,
    tsCreated,
    prediction: payload.prediction,
    featureSnapshot: payload.featureSnapshot,
    userId: user.id,
    botId: payload.botId ?? null,
    modelVersionBase: payload.modelVersionBase
  });

  return res.status(created.persisted ? 201 : 202).json({
    persisted: created.persisted,
    prediction: {
      symbol: payload.symbol,
      marketType: payload.marketType,
      timeframe: payload.timeframe,
      tsCreated,
      ...payload.prediction
    },
    explanation: created.explanation,
    modelVersion: created.modelVersion,
    predictionId: created.rowId
  });
});

app.get("/api/symbols", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const account = await resolveTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(account);

    try {
      const symbols = await listSymbols(adapter);
      return res.json({
        exchangeAccountId: account.id,
        exchange: account.exchange,
        ...symbols
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/account/summary", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const account = await resolveTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(account);

    try {
      const [summary, positions] = await Promise.all([
        adapter.getAccountState(),
        adapter.getPositions()
      ]);

      return res.json({
        exchangeAccountId: account.id,
        exchange: account.exchange,
        equity: summary.equity ?? null,
        availableMargin: summary.availableMargin ?? null,
        marginMode: summary.marginMode ?? null,
        positionsCount: positions.length,
        updatedAt: new Date().toISOString()
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/account/leverage", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = adjustLeverageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const account = await resolveTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(account);
    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }

      await adapter.setLeverage(
        symbol,
        parsed.data.leverage,
        parsed.data.marginMode
      );

      return res.json({
        ok: true,
        exchangeAccountId: account.id,
        symbol,
        leverage: parsed.data.leverage,
        marginMode: parsed.data.marginMode
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/positions", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const symbol = normalizeSymbolInput(typeof req.query.symbol === "string" ? req.query.symbol : null);

    const account = await resolveTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(account);
    try {
      const items = await listPositions(adapter, symbol ?? undefined);
      return res.json({
        exchangeAccountId: account.id,
        items
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/orders/open", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const symbol = normalizeSymbolInput(typeof req.query.symbol === "string" ? req.query.symbol : null);

    const account = await resolveTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(account);
    try {
      const items = await listOpenOrders(adapter, symbol ?? undefined);
      return res.json({
        exchangeAccountId: account.id,
        items
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/orders", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = placeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const account = await resolveTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(account);

    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }

      if (parsed.data.leverage !== undefined) {
        await adapter.setLeverage(
          symbol,
          parsed.data.leverage,
          parsed.data.marginMode ?? "cross"
        );
      }

      const side = parsed.data.side === "long" ? "buy" : "sell";
      const placed = await adapter.placeOrder({
        symbol,
        side,
        type: parsed.data.type,
        qty: parsed.data.qty,
        price: parsed.data.price,
        takeProfitPrice: parsed.data.takeProfitPrice,
        stopLossPrice: parsed.data.stopLossPrice,
        reduceOnly: parsed.data.reduceOnly
      });

      return res.status(201).json({
        exchangeAccountId: account.id,
        orderId: placed.orderId,
        status: "accepted"
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/orders/cancel", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = cancelOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const account = await resolveTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(account);
    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (symbol) {
        await adapter.tradeApi.cancelOrder({
          symbol: await adapter.toExchangeSymbol(symbol),
          orderId: parsed.data.orderId,
          productType: adapter.productType
        });
      } else {
        await adapter.cancelOrder(parsed.data.orderId);
      }
      return res.json({ ok: true });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/orders/cancel-all", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : typeof req.body?.exchangeAccountId === "string"
        ? req.body.exchangeAccountId
        : undefined;
    const symbol = normalizeSymbolInput(
      typeof req.query.symbol === "string"
        ? req.query.symbol
        : typeof req.body?.symbol === "string"
          ? req.body.symbol
          : null
    );
    const account = await resolveTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(account);

    try {
      const result = await cancelAllOrders(adapter, symbol ?? undefined);
      return res.json({
        exchangeAccountId: account.id,
        ...result
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/positions/close", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = closePositionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const account = await resolveTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(account);
    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }
      const orderIds = await closePositionsMarket(adapter, symbol, parsed.data.side);
      return res.json({
        exchangeAccountId: account.id,
        closedCount: orderIds.length,
        orderIds
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/exchange-accounts", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const rows = await db.exchangeAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  const items = rows.map((row: any) => {
    let apiKeyMasked = "****";
    try {
      apiKeyMasked = maskSecret(decryptSecret(row.apiKeyEnc));
    } catch {
      apiKeyMasked = "****";
    }
    return {
      id: row.id,
      exchange: row.exchange,
      label: row.label,
      apiKeyMasked,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastUsedAt: row.lastUsedAt
    };
  });

  return res.json({ items });
});

app.get("/dashboard/overview", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const [accounts, bots] = await Promise.all([
    db.exchangeAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        exchange: true,
        label: true,
        lastUsedAt: true,
        spotBudgetTotal: true,
        spotBudgetAvailable: true,
        futuresBudgetEquity: true,
        futuresBudgetAvailableMargin: true,
        pnlTodayUsd: true,
        lastSyncErrorAt: true,
        lastSyncErrorMessage: true
      }
    }),
    db.bot.findMany({
      where: {
        userId: user.id,
        exchangeAccountId: { not: null }
      },
      select: {
        id: true,
        exchangeAccountId: true,
        status: true,
        lastError: true,
        runtime: {
          select: {
            updatedAt: true,
            lastHeartbeatAt: true,
            lastTickAt: true,
            lastError: true,
            freeUsdt: true
          }
        }
      }
    })
  ]);

  const aggregate = new Map<string, {
    running: number;
    stopped: number;
    error: number;
    latestSyncAt: Date | null;
    latestRuntimeAt: Date | null;
    latestRuntimeFreeUsdt: number | null;
    lastErrorMessage: string | null;
  }>();

  for (const account of accounts) {
    aggregate.set(account.id, {
      running: 0,
      stopped: 0,
      error: 0,
      latestSyncAt: null,
      latestRuntimeAt: null,
      latestRuntimeFreeUsdt: null,
      lastErrorMessage: null
    });
  }

  for (const bot of bots) {
    const exchangeAccountId = bot.exchangeAccountId as string | null;
    if (!exchangeAccountId) continue;
    const current = aggregate.get(exchangeAccountId);
    if (!current) continue;

    if (bot.status === "running") current.running += 1;
    else if (bot.status === "error") current.error += 1;
    else current.stopped += 1;

    if (!current.lastErrorMessage) {
      current.lastErrorMessage = bot.lastError ?? bot.runtime?.lastError ?? null;
    }

    const lastSyncAt = resolveLastSyncAt(bot.runtime);
    if (lastSyncAt && (!current.latestSyncAt || lastSyncAt.getTime() > current.latestSyncAt.getTime())) {
      current.latestSyncAt = lastSyncAt;
    }

    const runtimeUpdatedAt = bot.runtime?.updatedAt ?? null;
    if (runtimeUpdatedAt && (!current.latestRuntimeAt || runtimeUpdatedAt.getTime() > current.latestRuntimeAt.getTime())) {
      current.latestRuntimeAt = runtimeUpdatedAt;
      current.latestRuntimeFreeUsdt =
        typeof bot.runtime?.freeUsdt === "number" ? bot.runtime.freeUsdt : null;
    }
  }

  const overview: ExchangeAccountOverview[] = accounts.map((account) => {
    const row = aggregate.get(account.id);
    const lastSyncAt = row?.latestSyncAt ?? account.lastUsedAt ?? null;
    const hasBotActivity =
      ((row?.running ?? 0) + (row?.stopped ?? 0) + (row?.error ?? 0)) > 0;
    const status = computeConnectionStatus(lastSyncAt, hasBotActivity);

    return {
      exchangeAccountId: account.id,
      exchange: account.exchange,
      label: account.label,
      status,
      lastSyncAt: toIso(lastSyncAt),
      spotBudget:
        account.spotBudgetTotal !== null || account.spotBudgetAvailable !== null
          ? {
              total: account.spotBudgetTotal,
              available: account.spotBudgetAvailable
            }
          : null,
      futuresBudget: (() => {
        const availableMargin =
          row?.latestRuntimeFreeUsdt !== null && row?.latestRuntimeFreeUsdt !== undefined
            ? row.latestRuntimeFreeUsdt
            : account.futuresBudgetAvailableMargin;
        const equity = account.futuresBudgetEquity;
        if (equity === null && availableMargin === null) return null;
        return {
          equity,
          availableMargin
        };
      })(),
      pnlTodayUsd: account.pnlTodayUsd ?? null,
      lastSyncError:
        account.lastSyncErrorAt || account.lastSyncErrorMessage
          ? {
              at: toIso(account.lastSyncErrorAt),
              message: account.lastSyncErrorMessage ?? null
            }
          : null,
      bots: {
        running: row?.running ?? 0,
        stopped: row?.stopped ?? 0,
        error: row?.error ?? 0
      },
      alerts: {
        hasErrors: (row?.error ?? 0) > 0,
        message: row?.lastErrorMessage ?? null
      }
    };
  });

  return res.json(overview);
});

app.post("/exchange-accounts", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = exchangeCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const created = await db.exchangeAccount.create({
    data: {
      userId: user.id,
      exchange: parsed.data.exchange.toLowerCase(),
      label: parsed.data.label,
      apiKeyEnc: encryptSecret(parsed.data.apiKey),
      apiSecretEnc: encryptSecret(parsed.data.apiSecret),
      passphraseEnc: parsed.data.passphrase ? encryptSecret(parsed.data.passphrase) : null
    }
  });

  return res.status(201).json({
    id: created.id,
    exchange: created.exchange,
    label: created.label,
    apiKeyMasked: maskSecret(parsed.data.apiKey)
  });
});

app.delete("/exchange-accounts/:id", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const id = req.params.id;
  const account = await db.exchangeAccount.findFirst({
    where: { id, userId: user.id }
  });
  if (!account) return res.status(404).json({ error: "exchange_account_not_found" });

  const linkedBots = await db.bot.count({
    where: { userId: user.id, exchangeAccountId: id }
  });
  if (linkedBots > 0) {
    return res.status(409).json({ error: "exchange_account_in_use" });
  }

  await db.exchangeAccount.delete({ where: { id } });
  return res.json({ ok: true });
});

app.post("/exchange-accounts/:id/test-connection", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const id = req.params.id;
  const account: ExchangeAccountSecrets | null = await db.exchangeAccount.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      exchange: true,
      apiKeyEnc: true,
      apiSecretEnc: true,
      passphraseEnc: true
    }
  });
  if (!account) return res.status(404).json({ error: "exchange_account_not_found" });

  try {
    const synced = await executeExchangeSync(account);
    await persistExchangeSyncSuccess(account.id, synced);

    return res.json({
      ok: true,
      message: "sync_ok",
      syncedAt: synced.syncedAt.toISOString(),
      spotBudget: synced.spotBudget,
      futuresBudget: synced.futuresBudget,
      pnlTodayUsd: synced.pnlTodayUsd,
      details: synced.details
    });
  } catch (error) {
    await persistExchangeSyncFailure(
      account.id,
      error instanceof ExchangeSyncError
        ? error.message
        : "Manual sync failed due to unexpected error."
    );

    if (error instanceof ExchangeSyncError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code
      });
    }
    return res.status(500).json({
      error: "exchange_sync_failed",
      message: "Unexpected exchange sync failure."
    });
  }
});

app.get("/bots", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const bots = await db.bot.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          workerId: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          lastError: true,
          consecutiveErrors: true,
          errorWindowStartAt: true,
          lastErrorAt: true,
          lastErrorMessage: true
        }
      }
    }
  });
  return res.json(bots.map(toSafeBot));
});

app.get("/bots/:id", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: {
      id: req.params.id,
      userId: user.id
    },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          workerId: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          lastError: true,
          consecutiveErrors: true,
          errorWindowStartAt: true,
          lastErrorAt: true,
          lastErrorMessage: true
        }
      }
    }
  });

  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  return res.json(toSafeBot(bot));
});

app.get("/bots/:id/runtime", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id },
    select: { id: true }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const runtime = await db.botRuntime.findUnique({
    where: { botId: req.params.id },
    select: {
      botId: true,
      status: true,
      reason: true,
      updatedAt: true,
      workerId: true,
      lastHeartbeatAt: true,
      lastTickAt: true,
      lastError: true,
      consecutiveErrors: true,
      errorWindowStartAt: true,
      lastErrorAt: true,
      lastErrorMessage: true
    }
  });
  if (!runtime) return res.status(404).json({ error: "runtime_not_found" });
  return res.json(runtime);
});

app.get("/bots/:id/risk-events", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id },
    select: { id: true }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const items = await db.riskEvent.findMany({
    where: { botId: bot.id },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return res.json({ items });
});

app.post("/bots", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = botCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const account = await db.exchangeAccount.findFirst({
    where: {
      id: parsed.data.exchangeAccountId,
      userId: user.id
    }
  });
  if (!account) return res.status(400).json({ error: "exchange_account_not_found" });

  const created = await db.bot.create({
    data: {
      userId: user.id,
      exchangeAccountId: account.id,
      name: parsed.data.name,
      symbol: parsed.data.symbol,
      exchange: account.exchange,
      status: "stopped",
      lastError: null,
      futuresConfig: {
        create: {
          strategyKey: parsed.data.strategyKey,
          marginMode: parsed.data.marginMode,
          leverage: parsed.data.leverage,
          tickMs: parsed.data.tickMs,
          paramsJson: parsed.data.paramsJson
        }
      }
    },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      }
    }
  });

  return res.status(201).json(toSafeBot(created));
});

app.post("/bots/:id/start", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id },
    include: { futuresConfig: true }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  if (!bot.futuresConfig) return res.status(409).json({ error: "futures_config_missing" });

  const [totalBots, runningBots] = await Promise.all([
    db.bot.count({ where: { userId: user.id } }),
    db.bot.count({ where: { userId: user.id, status: "running" } })
  ]);

  const decision = await enforceBotStartLicense({
    userId: user.id,
    exchange: bot.exchange,
    totalBots,
    runningBots,
    isAlreadyRunning: bot.status === "running"
  });
  if (!decision.allowed) {
    return res.status(403).json({
      error: "license_blocked",
      reason: decision.reason
    });
  }

  const updated = await db.bot.update({
    where: { id: bot.id },
    data: {
      status: "running",
      lastError: null
    }
  });

  await db.botRuntime.upsert({
    where: { botId: bot.id },
    update: {
      status: "running",
      reason: "start_requested",
      lastError: null,
      lastHeartbeatAt: new Date()
    },
    create: {
      botId: bot.id,
      status: "running",
      reason: "start_requested",
      lastError: null,
      lastHeartbeatAt: new Date()
    }
  });

  try {
    await enqueueBotRun(bot.id);
  } catch (error) {
    const reason = `queue_enqueue_failed:${String(error)}`;
    await Promise.allSettled([
      db.bot.update({
        where: { id: bot.id },
        data: {
          status: "error",
          lastError: reason
        }
      }),
      db.botRuntime.upsert({
        where: { botId: bot.id },
        update: {
          status: "error",
          reason,
          lastError: reason,
          lastHeartbeatAt: new Date()
        },
        create: {
          botId: bot.id,
          status: "error",
          reason,
          lastError: reason,
          lastHeartbeatAt: new Date()
        }
      })
    ]);

    return res.status(503).json({
      error: "queue_enqueue_failed",
      reason: String(error)
    });
  }

  return res.json({ id: updated.id, status: updated.status });
});

app.post("/bots/:id/stop", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const updated = await db.bot.update({
    where: { id: bot.id },
    data: {
      status: "stopped"
    }
  });

  await db.botRuntime.upsert({
    where: { botId: bot.id },
    update: {
      status: "stopped",
      reason: "stopped_by_user",
      lastHeartbeatAt: new Date()
    },
    create: {
      botId: bot.id,
      status: "stopped",
      reason: "stopped_by_user",
      lastHeartbeatAt: new Date()
    }
  });

  try {
    await cancelBotRun(bot.id);
  } catch {
    // Worker loop also exits on DB status check even if queue cleanup is unavailable.
  }

  return res.json({ id: updated.id, status: updated.status });
});

function wsSend(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function coerceFirstItem(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (payload && typeof payload === "object") {
    const list = (payload as Record<string, unknown>).list;
    if (Array.isArray(list)) return list[0] ?? null;
  }
  return payload;
}

async function handleMarketWsConnection(
  socket: WebSocket,
  user: WsAuthUser,
  url: URL
) {
  const exchangeAccountId = url.searchParams.get("exchangeAccountId");
  const requestedSymbol = url.searchParams.get("symbol");

  let context: MarketWsContext | null = null;
  let cleaned = false;
  const unsubs: Array<() => void> = [];

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const unsub of unsubs) unsub();
    if (context) await context.stop();
    context = null;
  };

  try {
    const settings = await getTradingSettings(user.id);
    const resolved = await createMarketWsContext(
      user.id,
      exchangeAccountId ?? settings.exchangeAccountId
    );
    context = resolved.ctx;

    const contracts = context.adapter.contractCache.snapshot();
    const symbol = pickWsSymbol(
      requestedSymbol ?? settings.symbol,
      contracts.map((row) => ({
        canonicalSymbol: row.canonicalSymbol,
        apiAllowed: row.apiAllowed
      }))
    );
    if (!symbol) {
      throw new ManualTradingError("no_symbols_available", 404, "no_symbols_available");
    }

    await saveTradingSettings(user.id, {
      exchangeAccountId: resolved.accountId,
      symbol
    });

    unsubs.push(
      context.adapter.onTicker((payload) => {
        const row = coerceFirstItem(extractWsDataArray(payload));
        const normalized = normalizeTickerPayload(row);
        wsSend(socket, {
          type: "ticker",
          symbol,
          data: {
            ...normalized,
            symbol
          }
        });
      })
    );
    unsubs.push(
      context.adapter.onDepth((payload) => {
        const row = coerceFirstItem(extractWsDataArray(payload));
        const normalized = normalizeOrderBookPayload(row);
        wsSend(socket, {
          type: "orderbook",
          symbol,
          data: normalized
        });
      })
    );
    unsubs.push(
      (context.adapter as any).onTrades((payload: unknown) => {
        const rows = extractWsDataArray(payload);
        const normalized = normalizeTradesPayload(rows).map((trade) => ({
          ...trade,
          symbol: symbol
        }));
        wsSend(socket, {
          type: "trades",
          symbol,
          data: normalized
        });
      })
    );

    await Promise.all([
      context.adapter.subscribeTicker(symbol),
      context.adapter.subscribeDepth(symbol),
      (context.adapter as any).subscribeTrades(symbol)
    ]);

    const exchangeSymbol = await context.adapter.toExchangeSymbol(symbol);

    const [tickerSnapshot, depthSnapshot, tradesSnapshot] = await Promise.allSettled([
      context.adapter.marketApi.getTicker(exchangeSymbol, context.adapter.productType),
      context.adapter.marketApi.getDepth(exchangeSymbol, 50, context.adapter.productType),
      context.adapter.marketApi.getTrades(exchangeSymbol, 60, context.adapter.productType)
    ]);

    if (tickerSnapshot.status === "fulfilled") {
      wsSend(socket, {
        type: "snapshot:ticker",
        symbol,
        data: {
          ...normalizeTickerPayload(coerceFirstItem(tickerSnapshot.value)),
          symbol
        }
      });
    }

    if (depthSnapshot.status === "fulfilled") {
      wsSend(socket, {
        type: "snapshot:orderbook",
        symbol,
        data: normalizeOrderBookPayload(depthSnapshot.value)
      });
    }

    if (tradesSnapshot.status === "fulfilled") {
      wsSend(socket, {
        type: "snapshot:trades",
        symbol,
        data: normalizeTradesPayload(tradesSnapshot.value).map((trade) => ({
          ...trade,
          symbol
        }))
      });
    }

    wsSend(socket, {
      type: "ready",
      exchangeAccountId: resolved.accountId,
      symbol
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "market_ws_failed";
    wsSend(socket, {
      type: "error",
      message
    });
    await cleanup();
    socket.close();
    return;
  }

  socket.on("message", (raw) => {
    try {
      const text = String(raw);
      const parsed = JSON.parse(text) as { type?: string };
      if (parsed.type === "ping") {
        wsSend(socket, { type: "pong" });
      }
    } catch {
      // ignore malformed payloads
    }
  });

  socket.on("close", () => {
    void cleanup();
  });
  socket.on("error", () => {
    void cleanup();
  });
}

async function handleUserWsConnection(
  socket: WebSocket,
  user: WsAuthUser,
  url: URL
) {
  const exchangeAccountId = url.searchParams.get("exchangeAccountId");

  let context: MarketWsContext | null = null;
  let cleaned = false;
  let balanceTimer: NodeJS.Timeout | null = null;
  const unsubs: Array<() => void> = [];

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const unsub of unsubs) unsub();
    if (balanceTimer) clearInterval(balanceTimer);
    if (context) await context.stop();
    balanceTimer = null;
    context = null;
  };

  try {
    const settings = await getTradingSettings(user.id);
    const resolved = await createMarketWsContext(
      user.id,
      exchangeAccountId ?? settings.exchangeAccountId
    );
    context = resolved.ctx;

    await saveTradingSettings(user.id, {
      exchangeAccountId: resolved.accountId
    });

    unsubs.push(
      context.adapter.onFill((event) => {
        wsSend(socket, {
          type: "fill",
          data: event
        });
      })
    );
    unsubs.push(
      context.adapter.onOrderUpdate((event) => {
        wsSend(socket, {
          type: "order",
          data: event
        });
      })
    );
    unsubs.push(
      context.adapter.onPositionUpdate((event) => {
        wsSend(socket, {
          type: "position",
          data: event
        });
      })
    );

    const sendSummary = async () => {
      if (!context) return;
      const [accountSummary, positions, openOrders] = await Promise.all([
        context.adapter.getAccountState(),
        listPositions(context.adapter),
        listOpenOrders(context.adapter)
      ]);
      wsSend(socket, {
        type: "account",
        data: {
          exchangeAccountId: resolved.accountId,
          equity: accountSummary.equity ?? null,
          availableMargin: accountSummary.availableMargin ?? null,
          positions,
          openOrders
        }
      });
    };

    await sendSummary();
    balanceTimer = setInterval(() => {
      void sendSummary().catch(() => {
        // ignore timer errors
      });
    }, 10_000);

    wsSend(socket, {
      type: "ready",
      exchangeAccountId: resolved.accountId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "user_ws_failed";
    wsSend(socket, {
      type: "error",
      message
    });
    await cleanup();
    socket.close();
    return;
  }

  socket.on("message", (raw) => {
    try {
      const text = String(raw);
      const parsed = JSON.parse(text) as { type?: string };
      if (parsed.type === "ping") {
        wsSend(socket, { type: "pong" });
      }
    } catch {
      // ignore malformed payloads
    }
  });
  socket.on("close", () => {
    void cleanup();
  });
  socket.on("error", () => {
    void cleanup();
  });
}

const marketWss = new WebSocketServer({ noServer: true });
const userWss = new WebSocketServer({ noServer: true });

const port = Number(process.env.API_PORT ?? "4000");
const server = http.createServer(app);

server.on("upgrade", (req, socket, head) => {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);

  if (url.pathname !== "/ws/market" && url.pathname !== "/ws/user") {
    wsReject(socket, 404, "Not Found");
    return;
  }

  void (async () => {
    const user = await authenticateWsUser(req);
    if (!user) {
      wsReject(socket, 401, "Unauthorized");
      return;
    }

    if (url.pathname === "/ws/market") {
      marketWss.handleUpgrade(req, socket, head, (ws) => {
        void handleMarketWsConnection(ws, user, url);
      });
      return;
    }

    userWss.handleUpgrade(req, socket, head, (ws) => {
      void handleUserWsConnection(ws, user, url);
    });
  })().catch(() => {
    wsReject(socket, 500, "Internal Server Error");
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${port}`);
  startExchangeAutoSyncScheduler();
});

process.on("SIGTERM", () => {
  stopExchangeAutoSyncScheduler();
  marketWss.close();
  userWss.close();
  server.close();
  void closeOrchestration();
});

process.on("SIGINT", () => {
  stopExchangeAutoSyncScheduler();
  marketWss.close();
  userWss.close();
  server.close();
  void closeOrchestration();
});
