import type { MyTrade } from "@mm/core";
import type { Exchange } from "@mm/exchange";
import { prisma } from "@mm/db";
import { incrementPriceSupportSpent } from "./db.js";

export function dayKeyUtc(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export async function syncVolumeFills(params: {
  botId: string;
  symbol: string;
  exchange: Exchange;
}): Promise<{ tradedNotionalToday: number; priceSupportSpentDelta: number }> {
  const { botId, symbol, exchange } = params;
  const dayKey = dayKeyUtc();

  const cursor = await prisma.botFillCursor.upsert({
    where: { botId_symbol_dayKey: { botId, symbol, dayKey } },
    create: { botId, symbol, dayKey, tradedNotionalToday: 0, lastTradeTimeMs: null },
    update: {}
  });

  const startTimeMs = cursor.lastTradeTimeMs ? Number(cursor.lastTradeTimeMs) : undefined;
  const trades = await exchange.getMyTrades(symbol, { startTimeMs, limit: 200 });
  const dayTrades = trades.filter((t) => dayKeyUtc(t.timestamp) === dayKey);

  if (dayTrades.length === 0) {
    return { tradedNotionalToday: cursor.tradedNotionalToday, priceSupportSpentDelta: 0 };
  }

  const orderIds = Array.from(
    new Set(dayTrades.map((t) => t.orderId).filter(Boolean) as string[])
  );

  const orderMaps = orderIds.length
    ? await prisma.botOrderMap.findMany({
        where: { botId, symbol, orderId: { in: orderIds } }
      })
    : [];
  const orderIdToClient = new Map(orderMaps.map((m) => [m.orderId, m.clientOrderId]));

  let addedNotional = 0;
  let addedSupportNotional = 0;
  let maxTs = startTimeMs ?? 0;

  for (const t of dayTrades) {
    const cid = t.clientOrderId || (t.orderId ? orderIdToClient.get(t.orderId) : undefined);
    if (!cid || (!cid.startsWith("vol") && !cid.startsWith("ps_"))) continue;

    if (Number.isFinite(t.timestamp) && t.timestamp > maxTs) {
      maxTs = t.timestamp;
    }

    try {
      await prisma.botFillSeen.create({
        data: { botId, symbol, tradeId: t.id }
      });
    } catch {
      continue;
    }

    const notional = Number(t.notional) || (t.price * t.qty);
    if (Number.isFinite(notional)) {
      if (cid.startsWith("vol")) {
        addedNotional += notional;
      } else if (cid.startsWith("ps_")) {
        addedSupportNotional += notional;
      }
    }

  }

  if (addedNotional > 0 || maxTs > (startTimeMs ?? 0)) {
    const nextTotal = cursor.tradedNotionalToday + addedNotional;
    await prisma.botFillCursor.update({
      where: { botId_symbol_dayKey: { botId, symbol, dayKey } },
      data: {
        tradedNotionalToday: nextTotal,
        lastTradeTimeMs: maxTs > 0 ? BigInt(maxTs) : cursor.lastTradeTimeMs
      }
    });
    if (addedSupportNotional > 0) {
      try {
        await incrementPriceSupportSpent(botId, addedSupportNotional);
      } catch {
        // best effort
      }
    }
    return { tradedNotionalToday: nextTotal, priceSupportSpentDelta: addedSupportNotional };
  }

  if (addedSupportNotional > 0) {
    try {
      await incrementPriceSupportSpent(botId, addedSupportNotional);
    } catch {
      // best effort
    }
  }
  return { tradedNotionalToday: cursor.tradedNotionalToday, priceSupportSpentDelta: addedSupportNotional };
}
