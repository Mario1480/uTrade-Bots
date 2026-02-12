import type { Candle } from "../timeframe.js";

type NullableNumber = number | null;

type VectorColor = "green" | "red" | "blue" | "violet" | "regular";
type VectorTier = "extreme" | "high" | "none";
type VectorDirection = "bull" | "bear";

export type TradersRealityPvsraSnapshot = {
  avgVol10: NullableNumber;
  spread: NullableNumber;
  volSpread: NullableNumber;
  highestVolSpread10: NullableNumber;
  vectorTier: VectorTier;
  direction: VectorDirection | null;
  vectorColor: VectorColor;
  patterns: {
    redGreen: boolean;
    greenRed: boolean;
    redBlue: boolean;
    blueRed: boolean;
    greenPurple: boolean;
    purpleGreen: boolean;
    bluePurple: boolean;
    purpleBlue: boolean;
  };
};

function round(value: number | null, decimals = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function classifyVectorColor(
  candle: Candle,
  avgVol10: number | null,
  highestVolSpread10: number | null
): { tier: VectorTier; direction: VectorDirection | null; color: VectorColor; spread: number; volSpread: number } {
  const volume = Number(candle.volume);
  const safeVolume = Number.isFinite(volume) && volume >= 0 ? volume : 0;
  const spread = Math.max(0, candle.high - candle.low);
  const volSpread = spread * safeVolume;
  const isBull = candle.close >= candle.open;
  const direction: VectorDirection = isBull ? "bull" : "bear";
  const volumeExtreme = avgVol10 !== null && safeVolume >= avgVol10 * 2;
  const volumeHigh = avgVol10 !== null && safeVolume >= avgVol10 * 1.5;
  const spreadExtreme =
    highestVolSpread10 !== null && highestVolSpread10 > 0 && volSpread >= highestVolSpread10 * 0.999;
  const spreadHigh =
    highestVolSpread10 !== null && highestVolSpread10 > 0 && volSpread >= highestVolSpread10 * 0.8;

  if (volumeExtreme || spreadExtreme) {
    return {
      tier: "extreme",
      direction,
      color: isBull ? "green" : "red",
      spread,
      volSpread
    };
  }
  if (volumeHigh || spreadHigh) {
    return {
      tier: "high",
      direction,
      color: isBull ? "blue" : "violet",
      spread,
      volSpread
    };
  }
  return {
    tier: "none",
    direction,
    color: "regular",
    spread,
    volSpread
  };
}

export function computeTradersRealityPvsra(candles: Candle[]): TradersRealityPvsraSnapshot {
  if (candles.length === 0) {
    return {
      avgVol10: null,
      spread: null,
      volSpread: null,
      highestVolSpread10: null,
      vectorTier: "none",
      direction: null,
      vectorColor: "regular",
      patterns: {
        redGreen: false,
        greenRed: false,
        redBlue: false,
        blueRed: false,
        greenPurple: false,
        purpleGreen: false,
        bluePurple: false,
        purpleBlue: false
      }
    };
  }

  const tail10 = candles.slice(-10);
  const volumes = tail10.map((row) => {
    const parsed = Number(row.volume);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });
  const avgVol10 =
    volumes.length > 0
      ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length
      : null;

  const volSpreadSeries = tail10.map((row) => {
    const volume = Number(row.volume);
    const safeVolume = Number.isFinite(volume) && volume >= 0 ? volume : 0;
    return Math.max(0, row.high - row.low) * safeVolume;
  });
  const highestVolSpread10 =
    volSpreadSeries.length > 0 ? Math.max(...volSpreadSeries) : null;

  const current = classifyVectorColor(
    candles[candles.length - 1],
    avgVol10,
    highestVolSpread10
  );
  const prev = candles.length > 1
    ? classifyVectorColor(candles[candles.length - 2], avgVol10, highestVolSpread10)
    : null;

  return {
    avgVol10: round(avgVol10, 6),
    spread: round(current.spread, 6),
    volSpread: round(current.volSpread, 6),
    highestVolSpread10: round(highestVolSpread10, 6),
    vectorTier: current.tier,
    direction: current.direction,
    vectorColor: current.color,
    patterns: {
      redGreen: prev?.color === "red" && current.color === "green",
      greenRed: prev?.color === "green" && current.color === "red",
      redBlue: prev?.color === "red" && current.color === "blue",
      blueRed: prev?.color === "blue" && current.color === "red",
      greenPurple: prev?.color === "green" && current.color === "violet",
      purpleGreen: prev?.color === "violet" && current.color === "green",
      bluePurple: prev?.color === "blue" && current.color === "violet",
      purpleBlue: prev?.color === "violet" && current.color === "blue"
    }
  };
}
