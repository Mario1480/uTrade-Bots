import "dotenv/config";
import { BitmartRestClient, CoinstoreRestClient } from "@mm/exchange";
import type { Exchange } from "@mm/exchange";
import { BotStateMachine } from "./state-machine.js";
import { runLoop } from "./loop.js";
import { log } from "./logger.js";
import {
  getRuntimeCounts,
  getBotCount,
  getCexCount,
  loadBotAndConfigs,
  loadCexConfig,
  loadRunningBotIds,
  upsertRunnerStatus,
  writeRuntime
} from "./db.js";
import { createServer } from "http";
import { getRunnerHealth, noteTick, setBotStatus, setRunnerCounts } from "./health.js";
import { getLicenseState, refreshLicense } from "./license-manager.js";

function optionalEnv(k: string): string | null {
  const v = process.env[k];
  return v && v.trim().length > 0 ? v : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getExchangeBaseUrl(exchange: string): string | null {
  const key = exchange.toLowerCase();
  if (key === "bitmart") return process.env.BITMART_BASE_URL || "https://api-cloud.bitmart.com";
  if (key === "coinstore") return process.env.COINSTORE_BASE_URL || "https://api.coinstore.com";
  return null;
}

async function startBotLoop(botId: string, tickMs: number) {
  let backoffMs = 1000;
  const maxBackoffMs = 30_000;

  while (true) {
    try {
      setBotStatus("RUNNING");
      const { bot, mm, vol, risk, notificationConfig, priceSupportConfig } = await loadBotAndConfigs(botId);
      const symbol = bot.symbol;

      const exchangeKey = bot.exchange.toLowerCase();
      if (exchangeKey !== "bitmart" && exchangeKey !== "coinstore") {
        const reason = `UNSUPPORTED_EXCHANGE:${bot.exchange}`;
        await writeRuntime({
          botId,
          status: "ERROR",
          reason,
          openOrders: null,
          openOrdersMm: null,
          openOrdersVol: null,
          lastVolClientOrderId: null
        });
        throw new Error(reason);
      }

      const baseUrl = getExchangeBaseUrl(exchangeKey);
      if (!baseUrl) {
        const reason = `MISSING_ENV:${exchangeKey.toUpperCase()}_BASE_URL`;
        await writeRuntime({
          botId,
          status: "ERROR",
          reason,
          openOrders: null,
          openOrdersMm: null,
          openOrdersVol: null,
          lastVolClientOrderId: null
        });
        throw new Error(`Missing env: ${exchangeKey.toUpperCase()}_BASE_URL`);
      }

      const cex = await loadCexConfig(bot.exchange);
      const rest =
        exchangeKey === "bitmart"
          ? new BitmartRestClient(baseUrl, cex.apiKey, cex.apiSecret, cex.apiMemo ?? "")
          : new CoinstoreRestClient(baseUrl, cex.apiKey, cex.apiSecret);

      const exchange: Exchange = {
        getMidPrice: (s) => rest.getTicker(s),
        getBalances: () => rest.getBalances(),
        getOpenOrders: (s) => rest.getOpenOrders(s),
        getMyTrades: (s, params) => rest.getMyTrades(s, params),
        placeOrder: (q) => rest.placeOrder(q),
        cancelOrder: (s, id) => rest.cancelOrder(s, id),
        cancelAll: (s) => rest.cancelAll(s)
      };

      const sm = new BotStateMachine();
      log.info({ botId: bot.id, name: bot.name, symbol, tickMs }, "starting runner (bot)");
      backoffMs = 1000;
      await runLoop({
        botId: bot.id,
        symbol,
        exchange,
        mm,
        vol,
        risk,
        notificationConfig,
        priceSupportConfig,
        tickMs,
        sm
      });
      log.warn({ botId: bot.id }, "runner loop exited unexpectedly");
    } catch (e) {
      const errStr = String(e);
      let reason = errStr;
      if (errStr.startsWith("Missing env:")) {
        const envName = errStr.split(":").pop()?.trim() ?? "UNKNOWN";
        reason = `MISSING_ENV:${envName}`;
      } else if (errStr.includes("CEX config not found")) {
        reason = "MISSING_CEX_CONFIG";
      } else if (errStr.includes("CEX config incomplete")) {
        reason = "INCOMPLETE_CEX_CONFIG";
      } else if (errStr.includes("Bot missing configs")) {
        reason = "INVALID_CONFIG";
      } else if (errStr.includes("Bot not found")) {
        reason = "BOT_NOT_FOUND";
      }

      log.warn({ botId, err: errStr }, "runner setup failed");
      setBotStatus("ERROR", reason);
      try {
        await writeRuntime({
          botId,
          status: "ERROR",
          reason,
          openOrders: null,
          openOrdersMm: null,
          openOrdersVol: null,
          lastVolClientOrderId: null
        });
      } catch {}
    }

    await sleep(backoffMs);
    backoffMs = Math.min(maxBackoffMs, backoffMs * 2);
  }
}

async function main() {
  const runnerPort = Number(process.env.RUNNER_PORT || "8091");
  const licenseState = getLicenseState();
  const server = createServer((req, res) => {
    const url = req.url || "/";
    if (url.startsWith("/health")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.startsWith("/ready")) {
      const health = getRunnerHealth();
      const ok = health.lastTickAt > 0;
      res.statusCode = ok ? 200 : 503;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok, ...health }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.listen(runnerPort, "0.0.0.0", () => {
    log.info({ port: runnerPort }, "runner health server listening");
  });

  try {
    const [botCount, cexCount] = await Promise.all([getBotCount(), getCexCount()]);
    await refreshLicense({ botCount, cexCount });
  } catch (e) {
    log.warn({ err: String(e) }, "initial license check failed");
  }

  const requestedBotId = optionalEnv("RUNNER_BOT_ID");
  const tickMs = Number(process.env.RUNNER_TICK_MS || "2000");
  const scanMs = Number(process.env.RUNNER_SCAN_MS || "10000");
  const licenseRefreshMs = Number(process.env.LICENSE_VERIFY_INTERVAL_MIN || "15") * 60_000;
  const botLoops = new Map<string, boolean>();
  let lastLicenseRefresh = 0;

  while (true) {
    try {
      const now = Date.now();
      if (now - lastLicenseRefresh >= licenseRefreshMs) {
        try {
          const [botCount, cexCount] = await Promise.all([getBotCount(), getCexCount()]);
          await refreshLicense({ botCount, cexCount });
        } catch (e) {
          log.warn({ err: String(e) }, "license refresh failed");
        }
        lastLicenseRefresh = now;
      }

      const botIds = requestedBotId ? [requestedBotId] : await loadRunningBotIds();
      if (botIds.length === 0) {
        log.warn("runner idle: no bots found");
      }
      for (const botId of botIds) {
        if (!licenseState.ok || (licenseState.enforce && !licenseState.enforce.allowed)) {
          log.warn({ reason: licenseState.enforce?.reason ?? licenseState.lastError?.code }, "license blocked bot start");
          break;
        }
        if (!botLoops.has(botId)) {
          botLoops.set(botId, true);
          void startBotLoop(botId, tickMs);
        }
      }

      try {
        const counts = await getRuntimeCounts();
        setRunnerCounts(counts.botsRunning, counts.botsErrored);
        await upsertRunnerStatus({
          lastTickAt: new Date(),
          botsRunning: counts.botsRunning,
          botsErrored: counts.botsErrored,
          version: process.env.VERSION ?? null
        });
      } catch (e) {
        log.warn({ err: String(e) }, "runner status update failed");
      }
      noteTick();
    } catch (e) {
      const errStr = String(e);
      log.warn({ err: errStr }, "runner supervisor error");
    }
    await sleep(scanMs);
  }
}

main().catch((e) => {
  log.error({ err: String(e) }, "runner crashed");
});
