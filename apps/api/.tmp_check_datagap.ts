import { prisma } from "@mm/db";

function asObj(v: unknown): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

async function main() {
  const rows = await (prisma as any).predictionState.findMany({
    orderBy: { tsUpdated: "desc" },
    take: 12,
    select: {
      id: true,
      symbol: true,
      timeframe: true,
      tsUpdated: true,
      signal: true,
      confidence: true,
      featuresSnapshot: true,
      tags: true
    }
  });

  const out = rows.map((r: any) => {
    const fs = asObj(r.featuresSnapshot);
    const indicators = asObj(fs.indicators);
    const advanced = asObj(fs.advancedIndicators);
    const riskFlags = asObj(fs.riskFlags);
    const cloud = asObj(advanced.cloud);
    const emas = asObj(advanced.emas);
    return {
      id: r.id,
      symbol: r.symbol,
      timeframe: r.timeframe,
      tsUpdated: r.tsUpdated,
      signal: r.signal,
      confidence: r.confidence,
      tags: r.tags,
      riskFlagsDataGap: riskFlags.dataGap ?? null,
      indicatorsDataGap: indicators.dataGap ?? null,
      advancedDataGap: advanced.dataGap ?? null,
      atrPct: indicators.atr_pct ?? null,
      ema800: emas.ema_800 ?? null,
      cloudPricePos: cloud.price_pos ?? null,
      mtfRun: asObj(fs.mtf).runTimeframe ?? null,
      mtfTfs: Array.isArray(asObj(fs.mtf).timeframes) ? asObj(fs.mtf).timeframes : null
    };
  });

  console.log(JSON.stringify(out, null, 2));
}

main().finally(async () => {
  await prisma.$disconnect();
});
