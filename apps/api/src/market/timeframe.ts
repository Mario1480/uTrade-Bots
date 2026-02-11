export type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d";
export type IntradayTF = Exclude<Timeframe, "1d">;

export type Candle = {
  ts: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type BucketedCandle = Candle & { ts: number };

const TIMEFRAME_MS: Record<Timeframe, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000
};

export function timeframeToMs(tf: Timeframe): number {
  return TIMEFRAME_MS[tf];
}

export function isIntradayTimeframe(tf: Timeframe): tf is IntradayTF {
  return tf !== "1d";
}

export function toBucketStart(tsMs: number, tf: Timeframe): number {
  if (!Number.isFinite(tsMs)) return NaN;
  const tfMs = timeframeToMs(tf);
  return Math.floor(tsMs / tfMs) * tfMs;
}

function toBucketedCandle(input: Candle, bucketStart: number): BucketedCandle {
  return {
    ts: bucketStart,
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    volume: input.volume
  };
}

export function bucketCandlesWithMeta(
  candles: Candle[],
  tf: Timeframe
): {
  candles: BucketedCandle[];
  candleBucketed: boolean;
  bucketMismatchCount: number;
  droppedInvalidTsCount: number;
} {
  const sorted = candles
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => row.ts !== null && Number.isFinite(row.ts))
    .sort((a, b) => {
      const ats = a.row.ts as number;
      const bts = b.row.ts as number;
      if (ats !== bts) return ats - bts;
      return a.idx - b.idx;
    });

  const byBucket = new Map<number, BucketedCandle>();
  let bucketMismatchCount = 0;
  for (const item of sorted) {
    const ts = item.row.ts as number;
    const bucketStart = toBucketStart(ts, tf);
    if (bucketStart !== ts) bucketMismatchCount += 1;
    byBucket.set(bucketStart, toBucketedCandle(item.row, bucketStart));
  }

  const bucketed = [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row);

  return {
    candles: bucketed,
    candleBucketed: bucketMismatchCount > 0 || sorted.length !== bucketed.length,
    bucketMismatchCount,
    droppedInvalidTsCount: candles.length - sorted.length
  };
}

export function bucketCandles(candles: Candle[], tf: Timeframe): Candle[] {
  return bucketCandlesWithMeta(candles, tf).candles;
}
