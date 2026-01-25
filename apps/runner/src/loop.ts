import type { Exchange, ExchangePublic } from "@mm/exchange";
import type {
  MarketMakingConfig,
  RiskConfig,
  VolumeConfig,
  NotificationConfig,
  PriceSupportConfig,
  Balance,
  MidPrice,
  Quote,
  Order
} from "@mm/core";
import { splitSymbol } from "@mm/core";
import { BitmartRestClient, CoinstoreRestClient } from "@mm/exchange";
import { buildMmQuotes, VolumeScheduler } from "@mm/strategy";
import type { VolumeState as VolState } from "@mm/strategy";
import { RiskEngine } from "@mm/risk";
import { BotStateMachine } from "./state-machine.js";
import { OrderManager } from "./order-manager.js";
import { inventoryRatio } from "./inventory.js";
import { log } from "./logger.js";
import { noteTick, setBotStatus } from "./health.js";
import {
  loadBotAndConfigs,
  loadSystemSettings,
  getBotCount,
  getCexCount,
  updateBotFlags,
  updatePriceSupportConfig,
  writeAlert,
  writeRuntime,
  upsertOrderMap
} from "./db.js";
import { alert } from "./alerts.js";
import { syncVolumeFills } from "./fills.js";
import { ensureLicense } from "./license-manager.js";

function normalizeAsset(a: string): string {
  return a.toUpperCase().split("-")[0];
}

function findFree(balances: Balance[], asset: string): number {
  const target = normalizeAsset(asset);
  const direct = balances.find((b) => normalizeAsset(b.asset) === target);
  return direct?.free ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runLoop(params: {
  botId: string;
  symbol: string;
  exchange: Exchange;
  mm: MarketMakingConfig;
  vol: VolumeConfig;
  risk: RiskConfig;
  notificationConfig: NotificationConfig;
  priceSupportConfig: PriceSupportConfig;
  tickMs: number;
  sm: BotStateMachine;
}): Promise<void> {
  const { botId, symbol, exchange, tickMs, sm } = params;
  const debug = process.env.RUNNER_DEBUG === "1";

  let mm = params.mm;
  let vol = params.vol;
  let risk = params.risk;
  let notificationConfig = params.notificationConfig;
  let priceSupportConfig = params.priceSupportConfig;
  let botName = params.botId;
  let systemSettings = { tradingEnabled: true, readOnlyMode: false };

  const marketDataClients = new Map<string, ExchangePublic>();
  const priceFeedCache = new Map<string, { mid: MidPrice; ts: number }>();
  const priceFeedTtlMs = Number(process.env.PRICE_FEED_TTL_MS || "15000");
  const masterStaleMs = Number(process.env.PRICE_FOLLOW_STALE_MS || "10000");
  const balancesTtlMs = Number(process.env.BALANCES_TTL_MS || "30000");
  const openOrdersTtlMs = Number(process.env.OPEN_ORDERS_TTL_MS || "30000");

  function getMarketDataClient(exchangeKey: string): ExchangePublic {
    const key = exchangeKey.toLowerCase();
    const cached = marketDataClients.get(key);
    if (cached) return cached;
    let rest: BitmartRestClient | CoinstoreRestClient;
    if (key === "bitmart") {
      const baseUrl = process.env.BITMART_BASE_URL || "https://api-cloud.bitmart.com";
      rest = new BitmartRestClient(baseUrl, "", "", "");
    } else if (key === "coinstore") {
      const baseUrl = process.env.COINSTORE_BASE_URL || "https://api.coinstore.com";
      rest = new CoinstoreRestClient(baseUrl, "", "");
    } else {
      throw new Error(`Unsupported exchange: ${exchangeKey}`);
    }
    const client: ExchangePublic = {
      getMidPrice: (s) => rest.getTicker(s)
    };
    marketDataClients.set(key, client);
    return client;
  }

  async function getMarketPrice(exchangeKey: string, symbolKey: string) {
    const key = `${exchangeKey.toLowerCase()}:${symbolKey}`;
    const cached = priceFeedCache.get(key);
    const now = Date.now();
    if (cached && now - cached.ts < priceFeedTtlMs) return cached.mid;
    try {
      const mid = await getMarketDataClient(exchangeKey).getMidPrice(symbolKey);
      priceFeedCache.set(key, { mid, ts: now });
      return mid;
    } catch (e) {
      if (cached && now - cached.ts < priceFeedTtlMs * 6) {
        log.warn({ err: String(e) }, "market price fetch failed, using cache");
        return cached.mid;
      }
      throw e;
    }
  }
  let volSched = new VolumeScheduler(vol);
  let riskEngine = new RiskEngine(risk);
  const priceEpsPct = Number(process.env.MM_PRICE_EPS_PCT || "0.005");
  const qtyEpsPct = Number(process.env.MM_QTY_EPS_PCT || "0.02");
  const minRepriceMs = Number(process.env.MM_REPRICE_MS || "15000");
  const minRepricePct = Number(process.env.MM_REPRICE_PCT || "0.01");
  const invAlpha = Number(process.env.MM_INV_ALPHA || "0.1");
  const volCooldownMs = Number(process.env.MM_VOL_COOLDOWN_MS || "60000");
  const volActiveTtlMs = Number(process.env.VOL_ACTIVE_TTL_MS || "20000");
  const volMmSafetyMult = Number(process.env.VOL_MM_SAFETY_MULT || "1.5");
  const volLastBandPct = Number(process.env.VOL_LAST_BAND_PCT || "0.0001");
  const volInsideSpreadPct = Number(process.env.VOL_INSIDE_SPREAD_PCT || "0.00005");
  const volLastMinBumpAbs = Number(process.env.VOL_LAST_MIN_BUMP_ABS || "0.00000001");
  const volLastMinBumpPct = Number(process.env.VOL_LAST_MIN_BUMP_PCT || "0");
  const volBuyTicks = Number(process.env.VOL_BUY_TICKS || "2");
  const volSellTicks = Number(process.env.VOL_SELL_TICKS || "2");
  const orderMgr = new OrderManager({ priceEpsPct, qtyEpsPct });
  let lastRepriceAt = 0;
  let lastRepriceMid = 0;
  let smoothedInvRatio: number | null = null;
  let lastVolTradeAt = 0;
  let fundsAlertSent = false;
  let fundsWarnSent = false;
  let lowFundsSince: number | null = null;
  let errorBackoffMs = 1000;
  const maxBackoffMs = 30_000;
  const volSideWindow: ("buy" | "sell")[] = [];
  const volSideWindowMax = 20;

  const volState = { dayKey: "init", tradedNotional: 0, lastActionMs: 0, dailyAlertSent: false } as VolState;
  const { base } = splitSymbol(symbol);
  const mmRunId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const reloadEveryMs = 5_000;
  let lastReload = 0;
  const fillsEveryMs = 3_000;
  let lastFillSync = 0;
  let licenseBlocked = false;
  let lastBalances: Balance[] = [];
  let lastBalancesAt = 0;
  let lastOpenOrders: Order[] = [];
  let lastOpenOrdersAt = 0;

  sm.set("RUNNING");
  setBotStatus("RUNNING");
  await writeRuntime({
    botId,
    status: "RUNNING",
    reason: null,
    openOrders: 0,
    openOrdersMm: 0,
    openOrdersVol: 0,
    lastVolClientOrderId: null
  });

  while (true) {
    let botRow: (Awaited<ReturnType<typeof loadBotAndConfigs>>)["bot"];
    try {
      // Bot status from DB (start/stop/pause)
      botRow = (await loadBotAndConfigs(botId)).bot;
      botName = botRow.name || botName;
    if (botRow.status === "STOPPED") {
      await exchange.cancelAll(symbol);
      sm.set("STOPPED", "Stopped from UI/API");
      setBotStatus("STOPPED", sm.getReason());
      await writeRuntime({
        botId,
        status: "STOPPED",
        reason: sm.getReason(),
        openOrders: 0,
        openOrdersMm: 0,
        openOrdersVol: 0,
        lastVolClientOrderId: null
      });
      // Keep the runner alive and wait until it is started again.
      while (true) {
        await sleep(1500);
        const b = (await loadBotAndConfigs(botId)).bot;
        if (b.status === "RUNNING") {
          sm.set("RUNNING", "");
          setBotStatus("RUNNING");
          fundsAlertSent = false;
          fundsWarnSent = false;
          await writeRuntime({
            botId,
            status: "RUNNING",
            reason: null,
            openOrders: 0,
            openOrdersMm: 0,
            openOrdersVol: 0,
            lastVolClientOrderId: null
          });
          break;
        }
        if (b.status === "PAUSED") {
          sm.set("PAUSED", "Paused from UI/API");
          setBotStatus("PAUSED", sm.getReason());
          await writeRuntime({
            botId,
            status: "PAUSED",
            reason: sm.getReason(),
            openOrders: 0,
            openOrdersMm: 0,
            openOrdersVol: 0,
            lastVolClientOrderId: null
          });
          break;
        }
      }
    }
    if (botRow.status === "PAUSED") {
      await exchange.cancelAll(symbol);
      sm.set("PAUSED", "Paused from UI/API");
      setBotStatus("PAUSED", sm.getReason());
      await writeRuntime({
        botId,
        status: "PAUSED",
        reason: sm.getReason(),
        openOrders: 0,
        openOrdersMm: 0,
        openOrdersVol: 0,
        lastVolClientOrderId: null
      });
      // wait until RUNNING
      while (true) {
        await sleep(1500);
        const b = (await loadBotAndConfigs(botId)).bot;
        if (b.status === "RUNNING") {
          sm.set("RUNNING", "");
          setBotStatus("RUNNING");
          fundsAlertSent = false;
          fundsWarnSent = false;
          await writeRuntime({
            botId,
            status: "RUNNING",
            reason: null,
            openOrders: 0,
            openOrdersMm: 0,
            openOrdersVol: 0,
            lastVolClientOrderId: null
          });
          break;
        }
        if (b.status === "STOPPED") {
          sm.set("STOPPED", "Stopped while paused");
          setBotStatus("STOPPED", sm.getReason());
          await writeRuntime({
            botId,
            status: "STOPPED",
            reason: sm.getReason(),
            openOrders: 0,
            openOrdersMm: 0,
            openOrdersVol: 0,
            lastVolClientOrderId: null
          });
          break;
        }
      }
      if (sm.getStatus() === "STOPPED") {
        continue;
      }
    }

    const t0 = Date.now();
    // reload configs periodically (hot apply)
    if (t0 - lastReload > reloadEveryMs) {
      lastReload = t0;
      const loaded = await loadBotAndConfigs(botId);
      mm = loaded.mm;
      vol = loaded.vol;
      risk = loaded.risk;
      notificationConfig = loaded.notificationConfig;
      priceSupportConfig = loaded.priceSupportConfig;
      systemSettings = await loadSystemSettings();
      volSched = new VolumeScheduler(vol);
      riskEngine = new RiskEngine(risk);

      const [botCount, cexCount] = await Promise.all([getBotCount(), getCexCount()]);
      const license = await ensureLicense({
        botCount,
        cexCount,
        usePriceSupport: Boolean(priceSupportConfig?.enabled),
        usePriceFollow: Boolean(botRow.priceFollowEnabled),
        useAiRecommendations: false
      });
      const licenseAllowed = license.ok && (license.enforce?.allowed ?? true);
      if (!licenseAllowed) {
        const reason = license.enforce?.reason ?? license.lastError?.code ?? "LICENSE_INVALID";
        if (!licenseBlocked) {
          try {
            await exchange.cancelAll(symbol);
          } catch {}
        }
        licenseBlocked = true;
        sm.set("PAUSED", reason);
        setBotStatus("PAUSED", sm.getReason());
        await writeRuntime({
          botId,
          status: "PAUSED",
          reason: sm.getReason(),
          openOrders: null,
          openOrdersMm: null,
          openOrdersVol: null,
          lastVolClientOrderId: null
        });
      } else if (licenseBlocked) {
        licenseBlocked = false;
        sm.set("RUNNING", "");
        setBotStatus("RUNNING");
      }
    }

    if (licenseBlocked) {
      await sleep(tickMs);
      continue;
    }

    if (!systemSettings.tradingEnabled) {
      sm.set("PAUSED", "KILL_SWITCH");
      await writeRuntime({
        botId,
        status: "PAUSED",
        reason: sm.getReason(),
        openOrders: null,
        openOrdersMm: null,
        openOrdersVol: null,
        lastVolClientOrderId: null
      });
      await sleep(tickMs);
      continue;
    }

    try {
      const priceFollowEnabled = Boolean(botRow.priceFollowEnabled);
      const masterExchange = (botRow.priceSourceExchange || botRow.exchange).toLowerCase();
      const masterSymbol = botRow.priceSourceSymbol || symbol;
      const masterType = botRow.priceSourceType || "TICKER";

      if (priceFollowEnabled && !botRow.priceSourceExchange) {
        await writeRuntime({
          botId,
          status: "ERROR",
          reason: "Price follow missing master exchange",
          openOrders: 0,
          openOrdersMm: 0,
          openOrdersVol: 0,
          lastVolClientOrderId: null
        });
        await sleep(tickMs);
        continue;
      }

      if (priceFollowEnabled && masterType !== "TICKER") {
        log.warn({ masterType }, "price follow type not supported, using TICKER");
      }

      const masterMid = priceFollowEnabled
        ? await getMarketPrice(masterExchange, masterSymbol)
        : await exchange.getMidPrice(symbol);
      const execMid = priceFollowEnabled ? await exchange.getMidPrice(symbol) : masterMid;
      const deviationPct =
        priceFollowEnabled && execMid.mid > 0
          ? Math.abs(masterMid.mid - execMid.mid) / execMid.mid
          : undefined;
      const mid = priceFollowEnabled ? masterMid : execMid;

      if (priceFollowEnabled && Date.now() - mid.ts > masterStaleMs) {
        setBotStatus("ERROR", "MASTER_FEED_STALE");
        await writeRuntime({
          botId,
          status: "ERROR",
          reason: "MASTER_FEED_STALE",
          mid: Number.isFinite(mid.mid) ? mid.mid : null,
          bid: Number.isFinite(mid.bid) ? mid.bid : null,
          ask: Number.isFinite(mid.ask) ? mid.ask : null,
          openOrders: 0,
          openOrdersMm: 0,
          openOrdersVol: 0,
          lastVolClientOrderId: null
        });
        noteTick();
        await sleep(tickMs);
        continue;
      }
      let balances: Balance[] = lastBalances;
      let balancesStale = false;
      const allowBalanceFallback =
        process.env.COINSTORE_ALLOW_BALANCE_429 !== "0" ||
        process.env.ALLOW_BALANCE_FALLBACK === "1";
      const balanceDebug = process.env.COINSTORE_BALANCE_DEBUG === "1";
      try {
        if (t0 - lastBalancesAt >= balancesTtlMs) {
          balances = await exchange.getBalances();
          lastBalances = balances;
          lastBalancesAt = t0;
        }
      } catch (e) {
        if (lastBalancesAt > 0 && t0 - lastBalancesAt < balancesTtlMs * 2) {
          log.warn({ err: String(e) }, "balances fetch failed, using cache");
          balances = lastBalances;
          balancesStale = true;
        } else if (allowBalanceFallback) {
          log.warn({ err: String(e) }, "balances fetch failed, using fallback");
          if (lastBalances.length > 0) {
            balances = lastBalances;
          } else {
            balances = [];
            lastBalances = balances;
          }
          lastBalancesAt = t0;
          balancesStale = true;
        } else {
          throw e;
        }
      }
      if (balanceDebug) {
        const sample = balances.slice(0, 8).map((b) => ({
          asset: b.asset,
          free: b.free,
          locked: b.locked
        }));
        log.info({ balancesCount: balances.length, sample }, "balances debug");
      }

      let open: Order[] = lastOpenOrders;
      try {
        if (t0 - lastOpenOrdersAt >= openOrdersTtlMs) {
          open = await exchange.getOpenOrders(symbol);
          lastOpenOrders = open;
          lastOpenOrdersAt = t0;
        }
      } catch (e) {
        if (lastOpenOrdersAt > 0 && t0 - lastOpenOrdersAt < openOrdersTtlMs * 2) {
          log.warn({ err: String(e) }, "open orders fetch failed, using cache");
          open = lastOpenOrders;
        } else {
          log.warn({ err: String(e) }, "open orders fetch failed, using empty");
          open = [];
          lastOpenOrders = open;
          lastOpenOrdersAt = t0;
        }
      }
      const midValid =
        Number.isFinite(mid.mid) &&
        mid.mid > 0 &&
        Number.isFinite(mid.bid) &&
        (mid.bid as number) > 0 &&
        Number.isFinite(mid.ask) &&
        (mid.ask as number) > 0;
      const execMidValid =
        Number.isFinite(execMid.mid) &&
        execMid.mid > 0 &&
        Number.isFinite(execMid.bid) &&
        (execMid.bid as number) > 0 &&
        Number.isFinite(execMid.ask) &&
        (execMid.ask as number) > 0;
      if (debug) {
        log.info(
          {
            mid: mid.mid,
            bid: mid.bid ?? null,
            ask: mid.ask ?? null,
            balancesCount: balances.length,
            openOrders: open.length
          },
          "tick snapshot"
        );
      }
      const openMm = open.filter((o) => {
        const cid = o.clientOrderId ?? "";
        return cid.startsWith("mmb") || cid.startsWith("mms");
      });
      const openOther = open.filter((o) => {
        const cid = o.clientOrderId ?? "";
        return !(cid.startsWith("mmb") || cid.startsWith("mms"));
      });
      log.debug({ openTotal: open.length, openMm: openMm.length, openOther: openOther.length }, "open orders split");

      const openVol = openOther.filter((o) => (o.clientOrderId ?? "").startsWith("vol"));

      let lastVolClientOrderId: string | null = null;
      let lastVolTs = -1;
      for (const o of openVol) {
        const cid = o.clientOrderId ?? "";
        const m = cid.match(/^vol(\d+)/);
        if (!m) continue;
        const ts = Number(m[1]);
        if (!Number.isFinite(ts)) continue;
        if (ts > lastVolTs) {
          lastVolTs = ts;
          lastVolClientOrderId = cid;
        }
      }

      log.debug(
        { openTotal: open.length, openMm: openMm.length, openVol: openVol.length, lastVolClientOrderId },
        "open orders breakdown"
      );

      if (t0 - lastFillSync > fillsEveryMs) {
        lastFillSync = t0;
        try {
          const fillRes = await syncVolumeFills({ botId, symbol, exchange });
          volState.tradedNotional = fillRes.tradedNotionalToday;
          if (fillRes.priceSupportSpentDelta > 0) {
            priceSupportConfig.spentUsdt += fillRes.priceSupportSpentDelta;
          }
        } catch (e) {
          log.warn({ err: String(e) }, "fills sync failed");
        }
      }

      if (!botRow.mmEnabled && openMm.length) {
        for (const o of openMm) {
          try {
            await exchange.cancelOrder(symbol, o.id);
          } catch {}
        }
      }

      if (!botRow.volEnabled && openVol.length) {
        for (const o of openVol) {
          try {
            await exchange.cancelOrder(symbol, o.id);
          } catch {}
        }
      }

      if (!midValid) {
        log.warn({ mid }, "market data invalid (bid/ask/mid)");
        await writeRuntime({
          botId,
          status: "RUNNING",
          reason: "Market data unavailable",
          mid: Number.isFinite(mid.mid) ? mid.mid : null,
          bid: Number.isFinite(mid.bid) ? mid.bid : null,
          ask: Number.isFinite(mid.ask) ? mid.ask : null,
          openOrders: open.length,
          openOrdersMm: openMm.length,
          openOrdersVol: openVol.length,
          lastVolClientOrderId,
          freeUsdt: findFree(balances, "USDT"),
          freeBase: findFree(balances, base),
          tradedNotionalToday: volState.tradedNotional
        });
        const elapsed = Date.now() - t0;
        const sleepMs = Math.max(0, tickMs - elapsed);
        await sleep(sleepMs);
        continue;
      }
      if (priceFollowEnabled && !execMidValid) {
        log.warn({ execMid }, "execution market data invalid (bid/ask/mid)");
        await writeRuntime({
          botId,
          status: "ERROR",
          reason: "Execution market data unavailable",
          mid: Number.isFinite(mid.mid) ? mid.mid : null,
          bid: Number.isFinite(mid.bid) ? mid.bid : null,
          ask: Number.isFinite(mid.ask) ? mid.ask : null,
          openOrders: open.length,
          openOrdersMm: openMm.length,
          openOrdersVol: openVol.length,
          lastVolClientOrderId,
          freeUsdt: findFree(balances, "USDT"),
          freeBase: findFree(balances, base),
          tradedNotionalToday: volState.tradedNotional
        });
        const elapsed = Date.now() - t0;
        const sleepMs = Math.max(0, tickMs - elapsed);
        await sleep(sleepMs);
        continue;
      }

      // Volume order TTL cleanup (cancel stale vol-* orders)
      const VOL_TTL_MS = (vol.mode === "ACTIVE" || vol.mode === "MIXED")
        ? volActiveTtlMs
        : 90_000; // shorter in ACTIVE/MIXED
      const nowTs = Date.now();

      for (const o of openOther) {
        const cid = o.clientOrderId ?? "";
        if (!cid.startsWith("vol")) continue;

        const m = cid.match(/^vol(\d+)/);
        if (!m) continue;

        const ts = Number(m[1]);
        if (!Number.isFinite(ts)) continue;

        if (nowTs - ts > VOL_TTL_MS) {
          try {
            await exchange.cancelOrder(symbol, o.id);
            log.info({ orderId: o.id, clientOrderId: cid }, "stale volume order cancelled");
          } catch (e) {
            log.warn({ err: String(e), orderId: o.id }, "failed to cancel stale volume order");
          }
        }
      }

      const invRatio = inventoryRatio(balances, base, mm.budgetBaseToken);
      if (smoothedInvRatio === null || !Number.isFinite(smoothedInvRatio)) {
        smoothedInvRatio = invRatio;
      } else {
        smoothedInvRatio = smoothedInvRatio + (invRatio - smoothedInvRatio) * invAlpha;
      }
      const mmMid = Number.isFinite(mid.last) && (mid.last as number) > 0 ? (mid.last as number) : mid.mid;
      const desiredQuotes = botRow.mmEnabled
        ? buildMmQuotes({
            symbol,
            mid: mmMid,
            cfg: mm,
            inventoryRatio: smoothedInvRatio,
            includeJitter: true
          })
        : [];
      const desiredWithIds = desiredQuotes.map((q) => {
        const cid = q.clientOrderId ?? "";
        const m = cid.match(/^(mmb|mms)(\d+)/);
        if (!m) return q;
        return { ...q, clientOrderId: `${m[1]}${m[2]}${mmRunId}` };
      });
      const desiredFiltered = desiredWithIds.filter((q) => {
        if (q.type !== "limit" || !q.price) return true;
        return q.price * q.qty >= 5;
      });

      const decision = balancesStale
        ? { ok: true, reason: "BALANCES_UNAVAILABLE" }
        : riskEngine.evaluate({
            balances,
            mid,
            deviationPct,
            openOrdersCount: open.length
          });

      const freeUsdt = findFree(balances, "USDT");
      const freeBase = findFree(balances, base);
      if (debug) {
        const sample = balances.slice(0, 8).map((b) => ({ asset: b.asset, free: b.free, locked: b.locked }));
        log.info({ freeUsdt, freeBase, base, sample }, "balances snapshot");
      }

      const mmFundsOk = balancesStale || !botRow.mmEnabled || (
        freeUsdt >= mm.budgetQuoteUsdt &&
        freeBase >= mm.budgetBaseToken
      );
      const volFundsOk = balancesStale || !botRow.volEnabled || (
        freeUsdt >= vol.minTradeUsdt ||
        freeBase * mid.mid >= vol.minTradeUsdt
      );

      if (!mmFundsOk || !volFundsOk) {
        const reasons: string[] = [];
        if (!mmFundsOk && botRow.mmEnabled) {
          reasons.push(`MM funds low (freeUsdt=${freeUsdt}, freeBase=${freeBase})`);
        }
        if (!volFundsOk && botRow.volEnabled) {
          reasons.push(`Volume funds low (freeUsdt=${freeUsdt}, freeBase=${freeBase})`);
        }
        const reason = `Insufficient funds: ${reasons.join("; ")}`;
        log.warn({ freeUsdt, freeBase, reason }, "insufficient funds");

        if (!lowFundsSince) lowFundsSince = t0;
        if (t0 - lowFundsSince >= 60_000 && !fundsAlertSent) {
          const shouldDisable = botRow.mmEnabled || botRow.volEnabled;
          if (shouldDisable) {
            try {
              await exchange.cancelAll(symbol);
            } catch {}
            await updateBotFlags({ botId, mmEnabled: false, volEnabled: false });
          }

          fundsAlertSent = true;
          await writeAlert({
            botId,
            level: "warn",
            title: "Insufficient funds (bots stopped)",
            message: `symbol=${symbol} ${reason}`
          });
          await alert(
            "warn",
            `[FUNDS] ${botName} (${symbol})`,
            `${reason}\nAction: MM/Volume stopped after 60s`
          );
        }

        await writeRuntime({
          botId,
          status: "RUNNING",
          reason: fundsAlertSent ? `Funds low: MM/Volume stopped` : "Funds low: waiting 60s",
          mid: mid.mid,
          bid: mid.bid ?? null,
          ask: mid.ask ?? null,
          openOrders: open.length,
          openOrdersMm: openMm.length,
          openOrdersVol: openVol.length,
          lastVolClientOrderId,
          freeUsdt,
          freeBase,
          tradedNotionalToday: volState.tradedNotional
        });

        const elapsed = Date.now() - t0;
        const sleepMs = Math.max(0, tickMs - elapsed);
        await sleep(sleepMs);
        continue;
      } else {
        lowFundsSince = null;
        fundsAlertSent = false;
        fundsWarnSent = false;
      }

      if (!decision.ok) {
        log.warn({ decision }, "risk triggered");
        await exchange.cancelAll(symbol);

        const nextStatus = "RUNNING";
        sm.set(nextStatus as any, `Risk triggered: ${decision.reason}`);

        const shouldDisable = botRow.mmEnabled || botRow.volEnabled;
        if (shouldDisable) {
          await updateBotFlags({ botId, mmEnabled: false, volEnabled: false });
        }

        await writeRuntime({
          botId,
          status: sm.getStatus(),
          reason: `Risk triggered: ${decision.reason}. Strategies disabled.`,
          mid: mid.mid,
          bid: mid.bid ?? null,
          ask: mid.ask ?? null,
          openOrders: open.length,
          openOrdersMm: openMm.length,
          openOrdersVol: openVol.length,
          lastVolClientOrderId,
          freeUsdt,
          freeBase,
          tradedNotionalToday: volState.tradedNotional
        });

        if (shouldDisable) {
          await writeAlert({
            botId,
            level: "warn",
            title: "Risk triggered",
            message: `reason=${decision.reason} symbol=${symbol} mid=${mid.mid} openOrders=${open.length}`
          });

          await alert(
            "warn",
            `[RISK] ${botName} (${symbol})`,
            `reason=${decision.reason}\nmid=${mid.mid}\nopenOrders=${open.length}`
          );
        }

        const elapsed = Date.now() - t0;
        const sleepMs = Math.max(0, tickMs - elapsed);
        await sleep(sleepMs);
        continue;
      }

      // Price Support (floor defense)
      if (priceSupportConfig.enabled) {
        const remainingUsdt = Math.max(0, priceSupportConfig.budgetUsdt - priceSupportConfig.spentUsdt);
        if (remainingUsdt <= 0) {
          if (priceSupportConfig.active) {
            const nowMs = Date.now();
            const shouldNotify = priceSupportConfig.notifiedBudgetExhaustedAt === 0;
            priceSupportConfig.active = false;
            priceSupportConfig.stoppedReason = "BUDGET_EXHAUSTED";
            priceSupportConfig.notifiedBudgetExhaustedAt = shouldNotify ? nowMs : priceSupportConfig.notifiedBudgetExhaustedAt;
            try {
              await updatePriceSupportConfig(botId, {
                active: false,
                stoppedReason: "BUDGET_EXHAUSTED",
                notifiedBudgetExhaustedAt: BigInt(priceSupportConfig.notifiedBudgetExhaustedAt || nowMs)
              });
            } catch {}

            if (shouldNotify) {
              await alert(
                "warn",
                `[PRICE SUPPORT] ${botName} (${symbol})`,
                `stopped: budget exhausted\nfloor=${priceSupportConfig.floorPrice}\nbudget=${priceSupportConfig.budgetUsdt}\nspent=${priceSupportConfig.spentUsdt}`
              );
            }
          }
        } else if (priceSupportConfig.active && priceSupportConfig.floorPrice) {
          const nowMs = Date.now();
          if (mid.mid < priceSupportConfig.floorPrice) {
            const since = nowMs - priceSupportConfig.lastActionAt;
            if (since >= priceSupportConfig.cooldownMs) {
              const bid = mid.bid ?? mid.mid;
              const ask = mid.ask ?? mid.mid;
              const floor = priceSupportConfig.floorPrice;
              const notional = Math.min(priceSupportConfig.maxOrderUsdt, remainingUsdt, freeUsdt);
              if (notional <= 0) {
                log.info({ remainingUsdt, freeUsdt }, "price support skipped: insufficient USDT");
              } else if (priceSupportConfig.mode === "ACTIVE") {
                const execPrice = Number.isFinite(ask) && ask > 0 ? ask : mid.mid;
                if (Number.isFinite(execPrice) && execPrice > 0) {
                  const qty = notional / execPrice;
                  const order = {
                    symbol,
                    side: "buy" as const,
                    type: "market" as const,
                    qty,
                    quoteQty: notional,
                    clientOrderId: `ps${botId.slice(0, 8)}${nowMs.toString(36)}`
                  };
                  try {
                    const placed = await exchange.placeOrder(order);
                    if (placed?.id && order.clientOrderId) {
                      await upsertOrderMap({
                        botId,
                        symbol,
                        orderId: placed.id,
                        clientOrderId: order.clientOrderId
                      });
                    }
                    priceSupportConfig.lastActionAt = nowMs;
                    await updatePriceSupportConfig(botId, {
                      lastActionAt: BigInt(nowMs)
                    });
                    log.info({ order }, "price support market order submitted");
                  } catch (e) {
                    log.warn({ err: String(e), order }, "price support market order failed");
                  }
                }
              } else {
                const offset = Math.max(volLastMinBumpAbs, bid * 0.00005);
                let price = Math.min(floor, bid + offset);
                if (Number.isFinite(ask) && ask > 0) {
                  price = Math.min(price, ask * (1 - 0.00005));
                }
                if (Number.isFinite(price) && price > 0) {
                  const qty = notional / price;
                  const postOnly = priceSupportConfig.mode !== "MIXED";
                  const order = {
                    symbol,
                    side: "buy" as const,
                    type: "limit" as const,
                    price,
                    qty,
                    postOnly,
                    clientOrderId: `ps${botId.slice(0, 8)}${nowMs.toString(36)}`
                  };
                  try {
                    const placed = await exchange.placeOrder(order);
                    if (placed?.id && order.clientOrderId) {
                      await upsertOrderMap({
                        botId,
                        symbol,
                        orderId: placed.id,
                        clientOrderId: order.clientOrderId
                      });
                    }
                    priceSupportConfig.lastActionAt = nowMs;
                    await updatePriceSupportConfig(botId, {
                      lastActionAt: BigInt(nowMs)
                    });
                    log.info({ order }, "price support order submitted");
                  } catch (e) {
                    log.warn({ err: String(e), order }, "price support order failed");
                  }
                }
              }
            }
          }
        }
      }

      // MM sync (only manage mm-* orders so we don't cancel volume orders)
      const allowReprice =
        openMm.length === 0 ||
        (t0 - lastRepriceAt >= minRepriceMs &&
          t0 - lastVolTradeAt >= volCooldownMs) ||
        (lastRepriceMid > 0 &&
          Math.abs(mid.mid - lastRepriceMid) / lastRepriceMid >= minRepricePct &&
          t0 - lastVolTradeAt >= volCooldownMs);

      const { cancel, place } = allowReprice ? orderMgr.diff(desiredFiltered, openMm) : { cancel: [], place: [] };
      const maxOpen = risk.maxOpenOrders ?? 0;
      const projectedOpen = maxOpen > 0
        ? Math.max(0, open.length - cancel.length) + place.length
        : open.length;

      for (const o of cancel) {
        try {
          await exchange.cancelOrder(symbol, o.id);
        } catch {}
      }

      if (allowReprice && cancel.length === 0) {
        for (const q of place) {
          try {
            await exchange.placeOrder(q);
          } catch (e) {
            log.warn({ err: String(e), q }, "place failed");
          }
        }
      } else if (cancel.length > 0) {
        log.debug({ cancel: cancel.length, place: place.length }, "skip place: cancel pending");
      } else if (!allowReprice) {
        log.debug({ minRepriceMs, minRepricePct, volCooldownMs }, "skip place: reprice cooldown");
      }
      if (allowReprice && (cancel.length > 0 || place.length > 0)) {
        lastRepriceAt = t0;
        lastRepriceMid = mid.mid;
      }


      // Volume bot (PASSIVE-first: post-only limit near mid; MIXED may use rare market)
      if (botRow.volEnabled) {
        const activeVol = vol.mode === "ACTIVE";
        const activeLikeVol = vol.mode === "ACTIVE" || vol.mode === "MIXED";
        if (maxOpen > 0 && projectedOpen >= maxOpen) {
          log.info(
            { openOrders: open.length, projectedOpen, maxOpen },
            "volume skipped: open order cap reached"
          );
        } else if (activeLikeVol && openVol.length > 0) {
          log.info({ openVol: openVol.length }, "volume skipped: active order pending");
        } else {
          const volOrder = volSched.maybeCreateTrade(symbol, mid.mid, volState);
          if (volOrder) {
            let skipVolume = false;
            const safeOrder: Quote = { ...volOrder };
            const allowTaker = activeVol || (vol.mode === "MIXED" && Math.random() < 0.2);
            if (activeLikeVol) {
              const bid = mid.bid ?? mid.mid;
              const ask = mid.ask ?? mid.mid;
              const ref = Number.isFinite(mid.last) && (mid.last as number) > 0 ? (mid.last as number) : mid.mid;
              const notional = safeOrder.quoteQty ?? safeOrder.qty * mid.mid;
              const canSellBase = freeBase * bid >= vol.minTradeUsdt;
              const canBuyUsdt = freeUsdt >= vol.minTradeUsdt;
              if (!canSellBase && !canBuyUsdt) {
                log.info({ freeUsdt, freeBase }, "volume skipped: insufficient balances");
                skipVolume = true;
              }

              if (!skipVolume) {
                const buyTarget = Number.isFinite(vol.buyPct) ? Math.max(0, Math.min(1, vol.buyPct)) : 0.5;
                let nextSide: "buy" | "sell" = Math.random() < buyTarget ? "buy" : "sell";
                if (!canSellBase) nextSide = "buy";
                if (!canBuyUsdt) nextSide = "sell";

                const lastSide = volState.lastSide;
                let streak = volState.sideStreak ?? 0;
                if (canBuyUsdt && canSellBase) {
                  const winBuy = volSideWindow.filter((s) => s === "buy").length;
                  const winSell = volSideWindow.length - winBuy;
                  if (volSideWindow.length >= volSideWindowMax) {
                    if (winBuy / volSideWindowMax > buyTarget + 0.1) nextSide = "sell";
                    else if (winSell / volSideWindowMax > (1 - buyTarget) + 0.1) nextSide = "buy";
                  }
                }

                if (lastSide && nextSide === lastSide && streak >= 5) {
                  nextSide = lastSide === "buy" ? "sell" : "buy";
                }
                streak = nextSide === lastSide ? streak + 1 : 1;

                const desiredAggressiveSide = nextSide;
                const makerSide = desiredAggressiveSide;
                volState.lastSide = desiredAggressiveSide;
                volState.sideStreak = streak;
                safeOrder.side = makerSide;
                log.info(
                  { desiredAggressiveSide, makerSide, streak, buyPct: vol.buyPct },
                  "volume active side selection"
                );

                const bumpBase = Math.max(volLastMinBumpAbs, ref * volLastMinBumpPct);
                const buyBump = bumpBase * Math.max(0, vol.buyBumpTicks ?? volBuyTicks);
                const sellBump = bumpBase * Math.max(0, vol.sellBumpTicks ?? volSellTicks);
                const inside = Math.max(0.00005, volInsideSpreadPct) * volMmSafetyMult;

                if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask <= bid) {
                  log.info({ bid, ask }, "volume skipped: invalid spread");
                  skipVolume = true;
                } else {
                  const floor = bid * (1 + inside);
                  const ceil = ask * (1 - inside);
                  if (floor >= ceil) {
                    log.info({ floor, ceil }, "volume skipped: no room inside spread");
                    skipVolume = true;
                  } else {
                    let price = 0;
                    if (makerSide === "buy") {
                      const target = ref + buyBump;
                      if (target > ceil) {
                        log.info({ ref, target, ceil }, "volume skipped: no room for buy inside spread");
                        skipVolume = true;
                      } else {
                        price = Math.min(Math.max(target, floor), ceil);
                      }
                    } else {
                      const target = Math.max(ref - sellBump, 0);
                      if (target < floor) {
                        log.info({ ref, target, floor }, "volume skipped: no room for sell inside spread");
                        skipVolume = true;
                      } else {
                        price = Math.max(Math.min(target, ceil), floor);
                      }
                    }

                    if (!skipVolume && Number.isFinite(price) && price > 0 && Number.isFinite(notional)) {
                      const qty = notional / price;
                      if (allowTaker) {
                        const takerNeedsUsdt = makerSide === "sell" ? notional : 0;
                        const takerNeedsBase = makerSide === "buy" ? qty : 0;
                        if (
                          (takerNeedsUsdt > 0 && freeUsdt < takerNeedsUsdt) ||
                          (takerNeedsBase > 0 && freeBase < takerNeedsBase)
                        ) {
                          log.info(
                            { takerNeedsUsdt, takerNeedsBase, freeUsdt, freeBase },
                            "volume skipped: insufficient balance for taker"
                          );
                          skipVolume = true;
                        }
                      }

                      if (!skipVolume) {
                        safeOrder.type = "limit";
                        safeOrder.postOnly = true;
                        safeOrder.price = price;
                        safeOrder.qty = qty;
                        safeOrder.quoteQty = undefined;
                        log.info(
                          { ref, price, buyBump, sellBump, bid, ask, makerSide },
                          "volume active pricing"
                        );
                      }
                    }
                  }
                }
              }
            } else if (safeOrder.type === "market" && botRow.mmEnabled) {
              const ref = Number.isFinite(mid.last) && (mid.last as number) > 0 ? (mid.last as number) : mid.mid;
              const halfMin = Math.max(0, volLastBandPct);
              const notional = (safeOrder.quoteQty ?? safeOrder.qty * mid.mid);
              const pct = halfMin > 0 ? halfMin * (0.15 + Math.random() * 0.7) : 0;
              const price = safeOrder.side === "buy"
                ? ref * (1 - pct)
                : ref * (1 + pct);
              if (Number.isFinite(price) && price > 0 && Number.isFinite(notional)) {
                safeOrder.type = "limit";
                safeOrder.postOnly = true;
                safeOrder.price = price;
                safeOrder.qty = notional / price;
                safeOrder.quoteQty = undefined;
              }
            }
            if (!skipVolume && safeOrder.type === "market") {
              if (safeOrder.side === "buy") {
                const quoteQty = Math.min(
                  safeOrder.quoteQty ?? safeOrder.qty * mid.mid,
                  freeUsdt
                );
                if (quoteQty < vol.minTradeUsdt) {
                  log.info({ quoteQty }, "volume skipped: insufficient USDT");
                  skipVolume = true;
                }
                safeOrder.quoteQty = quoteQty;
                safeOrder.qty = quoteQty / mid.mid;
              } else {
                const qty = Math.min(safeOrder.qty, freeBase);
                const notional = qty * mid.mid;
                if (notional < vol.minTradeUsdt) {
                  log.info({ notional }, "volume skipped: insufficient base");
                  skipVolume = true;
                }
                safeOrder.qty = qty;
              }
            }
            if (!skipVolume && safeOrder.type === "limit" && safeOrder.postOnly && botRow.mmEnabled && !activeLikeVol) {
              const ref = Number.isFinite(mid.last) && (mid.last as number) > 0 ? (mid.last as number) : mid.mid;
              const halfMin = Math.max(0, volLastBandPct);
              if (halfMin > 0 && safeOrder.price && safeOrder.qty) {
                const notional = safeOrder.price * safeOrder.qty;
                const pct = halfMin * (0.15 + Math.random() * 0.7);
                const price = safeOrder.side === "buy"
                  ? ref * (1 - pct)
                  : ref * (1 + pct);
                if (Number.isFinite(price) && price > 0 && Number.isFinite(notional)) {
                  safeOrder.price = price;
                  safeOrder.qty = notional / price;
                }
              }
            }

            if (!skipVolume) {
              try {
              const placed = await exchange.placeOrder(safeOrder);
              if (placed?.id && safeOrder.clientOrderId) {
                await upsertOrderMap({
                  botId,
                  symbol,
                  orderId: placed.id,
                  clientOrderId: safeOrder.clientOrderId
                });
              }
              if (activeLikeVol) {
                const statsSide = volState.lastSide ?? safeOrder.side;
                if (statsSide === "buy") {
                  volState.buyCount = (volState.buyCount ?? 0) + 1;
                } else {
                  volState.sellCount = (volState.sellCount ?? 0) + 1;
                }
                volSideWindow.push(statsSide);
                if (volSideWindow.length > volSideWindowMax) volSideWindow.shift();
              }
              lastVolTradeAt = Date.now();
              log.info({ volOrder: safeOrder }, "volume trade submitted");

              if (allowTaker && safeOrder.type === "limit" && safeOrder.price) {
                let skipTaker = false;
                const notional = safeOrder.price * safeOrder.qty;
                const desiredAggressiveSide = volState.lastSide ?? safeOrder.side;
                const takerSide = desiredAggressiveSide === "buy" ? "sell" : "buy";
                const ref = Number.isFinite(mid.last) && (mid.last as number) > 0 ? (mid.last as number) : mid.mid;
                const taker: Quote = takerSide === "buy"
                  ? {
                      symbol,
                      side: "buy",
                      type: activeVol ? "market" : "limit",
                      price: activeVol ? undefined : ref,
                      qty: 0,
                      quoteQty: activeVol ? Math.min(notional, freeUsdt) : undefined,
                      clientOrderId: `vol${Date.now()}t`
                    }
                  : {
                      symbol,
                      side: "sell",
                      type: activeVol ? "market" : "limit",
                      price: activeVol ? undefined : ref,
                      qty: Math.min(safeOrder.qty, freeBase),
                      clientOrderId: `vol${Date.now()}t`
                    };

                if (taker.side === "sell") {
                  const sellNotional = taker.qty * (activeVol ? safeOrder.price : taker.price ?? safeOrder.price);
                  if (!Number.isFinite(taker.qty) || taker.qty <= 0 || sellNotional < vol.minTradeUsdt) {
                    log.info({ sellNotional }, "volume skipped: insufficient base for taker");
                    skipTaker = true;
                  }
                } else {
                  const buyNotional = Math.min(notional, freeUsdt);
                  if (!Number.isFinite(buyNotional) || buyNotional < vol.minTradeUsdt) {
                    log.info({ buyNotional }, "volume skipped: insufficient USDT for taker");
                    skipTaker = true;
                  }
                  if (!activeVol && taker.price) {
                    taker.qty = buyNotional / taker.price;
                  }
                }

                if (!skipTaker) {
                  try {
                    const placedTaker = await exchange.placeOrder(taker);
                    if (placedTaker?.id && taker.clientOrderId) {
                      await upsertOrderMap({
                        botId,
                        symbol,
                        orderId: placedTaker.id,
                        clientOrderId: taker.clientOrderId
                      });
                    }
                    log.info({ volOrder: taker }, "volume trade submitted (taker)");
                  } catch (e) {
                    log.warn({ err: String(e), volOrder: taker }, "volume trade failed (taker)");
                  }
                }
              }
              } catch (e) {
                log.warn({ err: String(e), volOrder: safeOrder }, "volume trade failed");
              }
            }
          }
        }
      }

      if (
        botRow.volEnabled &&
        !volState.dailyAlertSent &&
        volState.tradedNotional >= vol.dailyNotionalUsdt
      ) {
        volState.dailyAlertSent = true;
        await writeAlert({
          botId,
          level: "info",
          title: "Daily volume target reached",
          message: `symbol=${symbol} notional=${volState.tradedNotional}`
        });
        await alert(
          "info",
          `[VOLUME] ${botName} (${symbol})`,
          `dailyTargetReached notional=${volState.tradedNotional}`
        );
      }

      await writeRuntime({
        botId,
        status: "RUNNING",
        reason: null,
        lastHealthyAt: new Date(),
        mid: mid.mid,
        bid: mid.bid ?? null,
        ask: mid.ask ?? null,
        openOrders: open.length,
        openOrdersMm: openMm.length,
        openOrdersVol: openVol.length,
        lastVolClientOrderId,
        freeUsdt,
        freeBase,
        tradedNotionalToday: volState.tradedNotional
      });
      setBotStatus("RUNNING");
      errorBackoffMs = 1000;

      const elapsed = Date.now() - t0;
      const sleepMs = Math.max(0, tickMs - elapsed);
      noteTick();
      await sleep(sleepMs);
    } catch (e) {
      const errStr = String(e);
      const isRateLimit =
        errStr.includes("429") ||
        errStr.toLowerCase().includes("rate limit");
      const isExchangeDown =
        errStr.includes("502") ||
        errStr.includes("503") ||
        errStr.includes("504") ||
        errStr.includes("Bad Gateway") ||
        errStr.includes("Service Unavailable");
      const isDbDown =
        errStr.toLowerCase().includes("prisma") ||
        errStr.toLowerCase().includes("database") ||
        errStr.includes("ECONNREFUSED") ||
        errStr.includes("ETIMEDOUT");
      const isTransient =
        errStr.includes("fetch failed") ||
        errStr.includes("ECONNRESET") ||
        errStr.includes("ENOTFOUND") ||
        errStr.includes("Unexpected token <") ||
        errStr.includes("SyntaxError: Unexpected token") ||
        errStr.includes("non-JSON response") ||
        isExchangeDown ||
        isRateLimit ||
        isDbDown;

      let reason = errStr;
      if (errStr.startsWith("Missing env:")) {
        const envName = errStr.split(":").pop()?.trim() ?? "UNKNOWN";
        reason = `MISSING_ENV:${envName}`;
      } else if (isRateLimit) {
        reason = "EXCHANGE_RATE_LIMIT";
      } else if (isExchangeDown) {
        reason = "EXCHANGE_UNAVAILABLE";
      } else if (isDbDown) {
        reason = "DB_UNAVAILABLE";
      } else if (errStr.includes("MASTER_FEED_STALE")) {
        reason = "MASTER_FEED_STALE";
      }

      if (reason.length > 240) {
        reason = reason.slice(0, 237) + "...";
      }

      if (isTransient) {
        log.warn({ err: errStr, reason }, "transient loop error");
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
        setBotStatus("ERROR", reason);
        const elapsed = Date.now() - t0;
        const sleepMs = Math.max(0, tickMs - elapsed);
        noteTick();
        await sleep(sleepMs);
        continue;
      }

      log.error({ err: errStr, reason }, "loop error");
      try {
        await exchange.cancelAll(symbol);
      } catch {}
      sm.set("ERROR", reason);
      setBotStatus("ERROR", sm.getReason());
      try {
        await writeRuntime({
          botId,
          status: "ERROR",
          reason: sm.getReason(),
          openOrders: 0,
          openOrdersMm: 0,
          openOrdersVol: 0,
          lastVolClientOrderId: null
        });
      } catch {}

      await writeAlert({
        botId,
        level: "error",
        title: "Runner error",
        message: `symbol=${symbol} err=${errStr}`
      });

      await alert(
        "error",
        `[ERROR] ${botName} (${symbol})`,
        `err=${errStr}`
      );
      const sleepMs = errorBackoffMs;
      errorBackoffMs = Math.min(maxBackoffMs, errorBackoffMs * 2);
      noteTick();
      await sleep(sleepMs);
      continue;
    }
    } catch (e) {
      const errStr = String(e);
      log.warn({ err: errStr }, "runner setup error");
      setBotStatus("ERROR", errStr);
      try {
        await writeRuntime({
          botId,
          status: "ERROR",
          reason: errStr,
          openOrders: null,
          openOrdersMm: null,
          openOrdersVol: null,
          lastVolClientOrderId: null
        });
      } catch {}
      const sleepMs = errorBackoffMs;
      errorBackoffMs = Math.min(maxBackoffMs, errorBackoffMs * 2);
      await sleep(sleepMs);
      continue;
    }
  }

  log.info({ status: sm.getStatus(), reason: sm.getReason() }, "runner stopped");
}
