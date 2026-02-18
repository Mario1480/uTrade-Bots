export const PVSRA_RED = "#ff0000";
export const PVSRA_GREEN = "#00ff00";
export const PVSRA_VIOLET = "#ff00ff";
export const PVSRA_BLUE = "#0000ff";
export const PVSRA_REGULAR_UP = "#999999";
export const PVSRA_REGULAR_DOWN = "#4d4d4d";

const PVSRA_LOOKBACK = 10;

export type PvsraCandleInput = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

function toSafeVolume(value: number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isBullCandle(candle: Pick<PvsraCandleInput, "open" | "close">): boolean {
  return candle.close >= candle.open;
}

export function getPvsraCandleColor(
  candles: PvsraCandleInput[],
  index: number
): string {
  const candle = candles[index];
  const bullish = isBullCandle(candle);
  if (index < PVSRA_LOOKBACK) {
    return bullish ? PVSRA_REGULAR_UP : PVSRA_REGULAR_DOWN;
  }

  const previous = candles.slice(index - PVSRA_LOOKBACK, index);
  const avgVol10 =
    previous.reduce((sum, row) => sum + toSafeVolume(row.volume), 0) / PVSRA_LOOKBACK;
  const highestVolSpread10 = previous.reduce((max, row) => {
    const spread = Math.max(0, row.high - row.low);
    const volSpread = spread * toSafeVolume(row.volume);
    return Math.max(max, volSpread);
  }, 0);

  const spread = Math.max(0, candle.high - candle.low);
  const volume = toSafeVolume(candle.volume);
  const volSpread = spread * volume;

  const volumeExtreme = avgVol10 > 0 && volume >= avgVol10 * 2;
  const spreadExtreme = highestVolSpread10 > 0 && volSpread >= highestVolSpread10 * 0.999;
  if (volumeExtreme || spreadExtreme) {
    return bullish ? PVSRA_GREEN : PVSRA_RED;
  }

  const volumeHigh = avgVol10 > 0 && volume >= avgVol10 * 1.5;
  if (volumeHigh) {
    return bullish ? PVSRA_BLUE : PVSRA_VIOLET;
  }

  return bullish ? PVSRA_REGULAR_UP : PVSRA_REGULAR_DOWN;
}
