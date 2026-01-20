import "dotenv/config";
import { BitmartRestClient } from "@mm/exchange";
import type { Exchange } from "@mm/exchange";
import { BotStateMachine } from "./state-machine.js";
import { runLoop } from "./loop.js";
import { log } from "./logger.js";
import { loadBotAndConfigs, loadCexConfig, loadLatestBotAndConfigs } from "./db.js";
import { createServer } from "http";
import { getRunnerHealth, setBotStatus } from "./health.js";

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
}

function optionalEnv(k: string): string | null {
  const v = process.env[k];
  return v && v.trim().length > 0 ? v : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const runnerPort = Number(process.env.RUNNER_PORT || "8091");
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

  const requestedBotId = optionalEnv("RUNNER_BOT_ID");
  const tickMs = Number(process.env.RUNNER_TICK_MS || "800");
  let backoffMs = 1000;
  const maxBackoffMs = 30_000;

  while (true) {
    try {
      setBotStatus("RUNNING");
      const { bot, mm, vol, risk, notificationConfig, priceSupportConfig } = requestedBotId
        ? await loadBotAndConfigs(requestedBotId)
        : await loadLatestBotAndConfigs();
      const symbol = bot.symbol;

      if (bot.exchange !== "bitmart") {
        throw new Error(`Unsupported exchange: ${bot.exchange}`);
      }

      const cex = await loadCexConfig(bot.exchange);
      const rest = new BitmartRestClient(
        mustEnv("BITMART_BASE_URL"),
        cex.apiKey,
        cex.apiSecret,
        cex.apiMemo ?? ""
      );

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
      log.info(
        { botId: bot.id, name: bot.name, symbol, tickMs },
        requestedBotId ? "starting runner (explicit bot id)" : "starting runner (latest bot)"
      );
      backoffMs = 1000;
      await runLoop({ botId: bot.id, symbol, exchange, mm, vol, risk, notificationConfig, priceSupportConfig, tickMs, sm });
      log.warn({ botId: bot.id }, "runner loop exited unexpectedly");
    } catch (e) {
      const errStr = String(e);
      if (errStr.includes("No bots found")) {
        log.warn({ err: errStr }, "runner idle: no bots found");
      } else {
        log.error({ err: errStr }, "runner setup failed");
      }
      setBotStatus("ERROR", errStr);
    }

    await sleep(backoffMs);
    backoffMs = Math.min(maxBackoffMs, backoffMs * 2);
  }
}

main().catch((e) => {
  log.error({ err: String(e) }, "runner crashed");
});
