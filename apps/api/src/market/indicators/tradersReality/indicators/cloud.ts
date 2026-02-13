import { clamp, round, std } from "./shared.js";

type NullableNumber = number | null;

export type TradersRealityCloudSnapshot = {
  cloud_size: NullableNumber;
  upper: NullableNumber;
  lower: NullableNumber;
  width_pct: NullableNumber;
  price_pos: NullableNumber;
};

export function computeTradersRealityCloud(
  closes: number[],
  ema50Latest: number | null,
  lastClose: number | null
): TradersRealityCloudSnapshot {
  const cloudLen = 100;
  const cloudWindow = closes.length >= cloudLen ? closes.slice(-cloudLen) : [];
  const cloudStd = cloudWindow.length === cloudLen ? std(cloudWindow) : null;
  const cloudSize = cloudStd !== null ? cloudStd / 4 : null;
  const cloudUpper =
    cloudSize !== null && ema50Latest !== null ? ema50Latest + cloudSize : null;
  const cloudLower =
    cloudSize !== null && ema50Latest !== null ? ema50Latest - cloudSize : null;
  const cloudWidthPct =
    cloudUpper !== null &&
    cloudLower !== null &&
    ema50Latest !== null &&
    ema50Latest !== 0
      ? ((cloudUpper - cloudLower) / ema50Latest) * 100
      : null;
  const cloudPricePos =
    cloudUpper !== null &&
    cloudLower !== null &&
    lastClose !== null &&
    cloudUpper !== cloudLower
      ? clamp((lastClose - cloudLower) / (cloudUpper - cloudLower), 0, 1)
      : null;

  return {
    cloud_size: round(cloudSize, 6),
    upper: round(cloudUpper, 6),
    lower: round(cloudLower, 6),
    width_pct: round(cloudWidthPct, 6),
    price_pos: round(cloudPricePos, 6)
  };
}
