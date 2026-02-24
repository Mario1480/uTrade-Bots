"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeBreakerBlocksOverlay,
  computeSuperOrderBlockFvgBosOverlay,
  normalizeSuperOrderBlockFvgBosSettings,
  type SuperOrderBlockFvgBosOverlay,
  type SuperOrderBlockFvgBosZone
} from "@mm/futures-core";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";
import { useTranslations } from "next-intl";
import { apiGet, ApiError } from "../../lib/api";
import type { TradeDeskPrefillPayload } from "../../src/schemas/tradeDeskPrefill";
import { getPvsraCandleColor } from "../../src/trade/pvsraColor";

type CandleApiItem = {
  ts: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type CandlesResponse = {
  exchangeAccountId: string;
  exchange: string;
  symbol: string;
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  granularity: string;
  items: CandleApiItem[];
};

type PredictionListItem = {
  id: string;
  accountId: string | null;
  symbol: string;
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
  tsCreated: string;
  signal: "up" | "down" | "neutral";
  confidence: number;
};

type LightweightChartProps = {
  exchangeAccountId: string;
  symbol: string;
  timeframe: string;
  prefill: TradeDeskPrefillPayload | null;
  chartPreferences?: {
    indicatorToggles?: Partial<IndicatorToggleState>;
    showUpMarkers?: boolean;
    showDownMarkers?: boolean;
  } | null;
  onChartPreferencesChange?: (next: {
    indicatorToggles: IndicatorToggleState;
    showUpMarkers: boolean;
    showDownMarkers: boolean;
  }) => void;
  selectedPosition?: {
    side: "long" | "short";
    entryPrice: number | null;
    markPrice: number | null;
    takeProfitPrice: number | null;
    stopLossPrice: number | null;
  } | null;
};

const CHART_CANDLE_FETCH_LIMIT = 1000;
const CHART_VISIBLE_CANDLE_COUNT = 200;
const CHART_RIGHT_OFFSET = 14;

type IndicatorToggleState = {
  ema5: boolean;
  ema13: boolean;
  ema50: boolean;
  ema200: boolean;
  ema800: boolean;
  emaCloud50: boolean;
  vwapSession: boolean;
  dailyOpen: boolean;
  smcStructure: boolean;
  volumeOverlay: boolean;
  pvsraVector: boolean;
  breakerBlocks: boolean;
  superOrderBlockFvgBos: boolean;
};

type IndicatorPresetKey = "scalping" | "trend" | "off" | "all";

const DEFAULT_INDICATOR_TOGGLES: IndicatorToggleState = {
  ema5: false,
  ema13: false,
  ema50: true,
  ema200: true,
  ema800: false,
  emaCloud50: false,
  vwapSession: false,
  dailyOpen: false,
  smcStructure: false,
  volumeOverlay: false,
  pvsraVector: false,
  breakerBlocks: false,
  superOrderBlockFvgBos: false
};

const INDICATOR_PRESETS: Record<IndicatorPresetKey, { labelKey: string; toggles: IndicatorToggleState }> = {
  scalping: {
    labelKey: "presets.scalping",
    toggles: {
      ema5: true,
      ema13: true,
      ema50: false,
      ema200: false,
      ema800: false,
      emaCloud50: false,
      vwapSession: true,
      dailyOpen: true,
      smcStructure: false,
      volumeOverlay: true,
      pvsraVector: false,
      breakerBlocks: false,
      superOrderBlockFvgBos: false
    }
  },
  trend: {
    labelKey: "presets.trend",
    toggles: {
      ema5: false,
      ema13: false,
      ema50: true,
      ema200: true,
      ema800: true,
      emaCloud50: true,
      vwapSession: false,
      dailyOpen: true,
      smcStructure: true,
      volumeOverlay: false,
      pvsraVector: false,
      breakerBlocks: true,
      superOrderBlockFvgBos: true
    }
  },
  off: {
    labelKey: "presets.allOff",
    toggles: {
      ema5: false,
      ema13: false,
      ema50: false,
      ema200: false,
      ema800: false,
      emaCloud50: false,
      vwapSession: false,
      dailyOpen: false,
      smcStructure: false,
      volumeOverlay: false,
      pvsraVector: false,
      breakerBlocks: false,
      superOrderBlockFvgBos: false
    }
  },
  all: {
    labelKey: "presets.allOn",
    toggles: {
      ema5: true,
      ema13: true,
      ema50: true,
      ema200: true,
      ema800: true,
      emaCloud50: true,
      vwapSession: true,
      dailyOpen: true,
      smcStructure: true,
      volumeOverlay: true,
      pvsraVector: true,
      breakerBlocks: true,
      superOrderBlockFvgBos: true
    }
  }
};

function togglesEqual(a: IndicatorToggleState, b: IndicatorToggleState): boolean {
  return (
    a.ema5 === b.ema5 &&
    a.ema13 === b.ema13 &&
    a.ema50 === b.ema50 &&
    a.ema200 === b.ema200 &&
    a.ema800 === b.ema800 &&
    a.emaCloud50 === b.emaCloud50 &&
    a.vwapSession === b.vwapSession &&
    a.dailyOpen === b.dailyOpen &&
    a.smcStructure === b.smcStructure &&
    a.volumeOverlay === b.volumeOverlay &&
    a.pvsraVector === b.pvsraVector &&
    a.breakerBlocks === b.breakerBlocks &&
    a.superOrderBlockFvgBos === b.superOrderBlockFvgBos
  );
}

function normalizeCandles(items: CandleApiItem[]): Array<CandleApiItem & { ts: number }> {
  return items
    .filter((row): row is CandleApiItem & { ts: number } => row.ts !== null && Number.isFinite(row.ts))
    .slice()
    .sort((a, b) => a.ts - b.ts);
}

function timeframeToSeconds(timeframe: string): number {
  switch (timeframe) {
    case "1m": return 60;
    case "5m": return 300;
    case "15m": return 900;
    case "1h": return 3600;
    case "4h": return 14400;
    case "1d": return 86400;
    default: return 900;
  }
}

function applyLatestViewport(
  chart: IChartApi | null,
  candles: CandlestickData[],
  timeframe: string,
  visibleCount: number,
  rightOffset: number
): void {
  if (!chart || candles.length === 0) return;
  const _tfSec = timeframeToSeconds(timeframe);
  void _tfSec;
  const to = (candles.length - 1) + rightOffset;
  const from = Math.max(0, to - Math.max(20, visibleCount) + 1);
  chart.timeScale().setVisibleLogicalRange({ from, to });
}

function toChartData(
  items: CandleApiItem[],
  usePvsraVector: boolean,
  hvbColorByTs?: Map<number, string>
): CandlestickData[] {
  const normalized = normalizeCandles(items);
  const out: CandlestickData[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const row = normalized[index];
    const base: CandlestickData = {
      time: Math.floor(row.ts / 1000) as UTCTimestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close
    };
    const hvbColor = hvbColorByTs?.get(row.ts) ?? null;
    if (hvbColor) {
      base.color = hvbColor;
      base.borderColor = hvbColor;
      base.wickColor = hvbColor;
    } else if (usePvsraVector) {
      const pvsraColor = getPvsraCandleColor(normalized, index);
      base.color = pvsraColor;
      base.borderColor = pvsraColor;
      base.wickColor = pvsraColor;
    }
    out.push(base);
  }
  return out;
}

type CanvasRgba = { r: number; g: number; b: number; a: number };

function parseCanvasColor(input: string): CanvasRgba | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(hex[0] + hex[0], 16);
      const g = Number.parseInt(hex[1] + hex[1], 16);
      const b = Number.parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? Number.parseInt(hex[3] + hex[3], 16) / 255 : 1;
      if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a };
    }
    return null;
  }

  const rgb = value.match(/^rgba?\\((.+)\\)$/);
  if (rgb) {
    const parts = rgb[1]?.split(",").map((part) => part.trim()) ?? [];
    if (parts.length < 3) return null;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    const a = parts.length >= 4 ? Number(parts[3]) : 1;
    if ([r, g, b, a].every(Number.isFinite)) {
      return {
        r: Math.max(0, Math.min(255, r)),
        g: Math.max(0, Math.min(255, g)),
        b: Math.max(0, Math.min(255, b)),
        a: Math.max(0, Math.min(1, a))
      };
    }
  }

  return null;
}

function colorWithAlpha(input: string, alphaScale: number): string {
  const rgba = parseCanvasColor(input);
  if (!rgba) return input;
  const alpha = Math.max(0, Math.min(1, rgba.a * alphaScale));
  return `rgba(${Math.round(rgba.r)},${Math.round(rgba.g)},${Math.round(rgba.b)},${alpha.toFixed(4)})`;
}

function buildVolumeHistogram(items: CandleApiItem[]): HistogramData<Time>[] {
  const out: HistogramData<Time>[] = [];
  for (const row of normalizeCandles(items)) {
    const volume = Number(row.volume);
    if (!Number.isFinite(volume)) continue;
    const isUp = row.close >= row.open;
    out.push({
      time: Math.floor(row.ts / 1000) as UTCTimestamp,
      value: Math.max(0, volume),
      color: isUp ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)"
    });
  }
  return out;
}

function buildEmaLine(items: Array<CandleApiItem & { ts: number }>, period: number): LineData<Time>[] {
  if (period <= 0 || items.length < period) return [];
  const out: LineData<Time>[] = [];
  let sum = 0;
  for (let i = 0; i < period; i += 1) {
    sum += items[i].close;
  }
  let ema = sum / period;
  out.push({
    time: Math.floor(items[period - 1].ts / 1000) as UTCTimestamp,
    value: ema
  });

  const alpha = 2 / (period + 1);
  for (let i = period; i < items.length; i += 1) {
    ema = (items[i].close * alpha) + (ema * (1 - alpha));
    out.push({
      time: Math.floor(items[i].ts / 1000) as UTCTimestamp,
      value: ema
    });
  }
  return out;
}

function buildSessionVwapLine(items: Array<CandleApiItem & { ts: number }>): LineData<Time>[] {
  const out: LineData<Time>[] = [];
  let currentDayStart: number | null = null;
  let sumPv = 0;
  let sumV = 0;
  for (const row of items) {
    const dt = new Date(row.ts);
    const dayStart = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 0, 0, 0, 0);
    if (currentDayStart === null || dayStart !== currentDayStart) {
      currentDayStart = dayStart;
      sumPv = 0;
      sumV = 0;
    }
    const volume = Number(row.volume);
    const safeVolume = Number.isFinite(volume) && volume > 0 ? volume : 0;
    const typicalPrice = (row.high + row.low + row.close) / 3;
    sumPv += typicalPrice * safeVolume;
    sumV += safeVolume;
    if (sumV <= 0) continue;
    out.push({
      time: Math.floor(row.ts / 1000) as UTCTimestamp,
      value: sumPv / sumV
    });
  }
  return out;
}

function computeDailyOpenPrice(items: Array<CandleApiItem & { ts: number }>): number | null {
  if (items.length === 0) return null;
  const latest = items[items.length - 1];
  const latestDt = new Date(latest.ts);
  const latestDayStart = Date.UTC(
    latestDt.getUTCFullYear(),
    latestDt.getUTCMonth(),
    latestDt.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const firstSameDay = items.find((row) => {
    const dt = new Date(row.ts);
    const dayStart = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 0, 0, 0, 0);
    return dayStart === latestDayStart;
  });
  return firstSameDay ? firstSameDay.open : null;
}

function buildDailyOpenLine(items: Array<CandleApiItem & { ts: number }>): LineData<Time>[] {
  const dailyOpen = computeDailyOpenPrice(items);
  if (dailyOpen === null || !Number.isFinite(dailyOpen) || items.length === 0) return [];
  const latest = items[items.length - 1];
  const latestDt = new Date(latest.ts);
  const latestDayStart = Date.UTC(
    latestDt.getUTCFullYear(),
    latestDt.getUTCMonth(),
    latestDt.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const out: LineData<Time>[] = [];
  for (const row of items) {
    const dt = new Date(row.ts);
    const dayStart = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 0, 0, 0, 0);
    if (dayStart !== latestDayStart) continue;
    out.push({
      time: Math.floor(row.ts / 1000) as UTCTimestamp,
      value: dailyOpen
    });
  }
  return out;
}

type BreakerSeriesKey =
  | "bbTop"
  | "bbBottom"
  | "bbMid"
  | "line1"
  | "line2"
  | "pd1"
  | "pd2"
  | "tp1"
  | "tp2"
  | "tp3";

const BREAKER_SERIES_KEYS: BreakerSeriesKey[] = [
  "bbTop",
  "bbBottom",
  "bbMid",
  "line1",
  "line2",
  "pd1",
  "pd2",
  "tp1",
  "tp2",
  "tp3"
];

function buildBreakerLine(
  candles: Array<CandleApiItem & { ts: number }>,
  values: Array<number | null>
): LineData<Time>[] {
  const out: LineData<Time>[] = [];
  const size = Math.min(candles.length, values.length);
  for (let i = 0; i < size; i += 1) {
    const value = values[i];
    if (value === null || !Number.isFinite(value)) continue;
    out.push({
      time: Math.floor(candles[i].ts / 1000) as UTCTimestamp,
      value
    });
  }
  return out;
}

type SmcPivotState = {
  level: number | null;
  crossed: boolean;
};

function isPivotHigh(items: Array<CandleApiItem & { ts: number }>, index: number, size: number): boolean {
  if (index - size < 0 || index + size >= items.length) return false;
  const level = items[index].high;
  for (let i = index - size; i <= index + size; i += 1) {
    if (i === index) continue;
    if (items[i].high >= level) return false;
  }
  return true;
}

function isPivotLow(items: Array<CandleApiItem & { ts: number }>, index: number, size: number): boolean {
  if (index - size < 0 || index + size >= items.length) return false;
  const level = items[index].low;
  for (let i = index - size; i <= index + size; i += 1) {
    if (i === index) continue;
    if (items[i].low <= level) return false;
  }
  return true;
}

function buildSmcMarkersForPivotSize(
  items: Array<CandleApiItem & { ts: number }>,
  pivotSize: number,
  mode: "internal" | "swing"
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  const highPivot: SmcPivotState = { level: null, crossed: false };
  const lowPivot: SmcPivotState = { level: null, crossed: false };
  let trendBias = 0;

  for (let i = 1; i < items.length; i += 1) {
    if (isPivotHigh(items, i, pivotSize)) {
      highPivot.level = items[i].high;
      highPivot.crossed = false;
    }
    if (isPivotLow(items, i, pivotSize)) {
      lowPivot.level = items[i].low;
      lowPivot.crossed = false;
    }

    const prevClose = items[i - 1].close;
    const close = items[i].close;
    const time = Math.floor(items[i].ts / 1000) as UTCTimestamp;

    if (
      highPivot.level !== null &&
      !highPivot.crossed &&
      prevClose <= highPivot.level &&
      close > highPivot.level
    ) {
      const eventType = trendBias < 0 ? "CHoCH" : "BOS";
      trendBias = 1;
      highPivot.crossed = true;
      markers.push({
        time,
        position: "belowBar",
        shape: mode === "swing" ? "arrowUp" : "circle",
        color: eventType === "CHoCH" ? "#2dd4bf" : "#22c55e",
        text: mode === "swing" ? eventType : `i${eventType}`
      });
    }

    if (
      lowPivot.level !== null &&
      !lowPivot.crossed &&
      prevClose >= lowPivot.level &&
      close < lowPivot.level
    ) {
      const eventType = trendBias > 0 ? "CHoCH" : "BOS";
      trendBias = -1;
      lowPivot.crossed = true;
      markers.push({
        time,
        position: "aboveBar",
        shape: mode === "swing" ? "arrowDown" : "circle",
        color: eventType === "CHoCH" ? "#f59e0b" : "#ef4444",
        text: mode === "swing" ? eventType : `i${eventType}`
      });
    }
  }

  return markers;
}

function buildSmcStructureMarkers(
  items: Array<CandleApiItem & { ts: number }>
): SeriesMarker<Time>[] {
  const internal = buildSmcMarkersForPivotSize(items, 5, "internal");
  const swing = buildSmcMarkersForPivotSize(items, 50, "swing");
  const merged = [...internal, ...swing].sort((a, b) => Number(a.time) - Number(b.time));
  const maxMarkers = 120;
  return merged.length > maxMarkers ? merged.slice(merged.length - maxMarkers) : merged;
}

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

export function LightweightChart({
  exchangeAccountId,
  symbol,
  timeframe,
  prefill,
  chartPreferences,
  onChartPreferencesChange,
  selectedPosition
}: LightweightChartProps) {
  const t = useTranslations("system.trade.chart");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const prefillLinesRef = useRef<IPriceLine[]>([]);
  const selectedPositionLinesRef = useRef<IPriceLine[]>([]);
  const emaSeriesRef = useRef<Record<"ema5" | "ema13" | "ema50" | "ema200" | "ema800", ISeriesApi<"Line"> | null>>({
    ema5: null,
    ema13: null,
    ema50: null,
    ema200: null,
    ema800: null
  });
  const emaCloudUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaCloudLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const dailyOpenSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const breakerSeriesRef = useRef<Record<BreakerSeriesKey, ISeriesApi<"Line"> | null>>({
    bbTop: null,
    bbBottom: null,
    bbMid: null,
    line1: null,
    line2: null,
    pd1: null,
    pd2: null,
    tp1: null,
    tp2: null,
    tp3: null
  });
  const superPivotSeriesRef = useRef<{ top: ISeriesApi<"Line"> | null; bottom: ISeriesApi<"Line"> | null }>({
    top: null,
    bottom: null
  });
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const superOverlayRef = useRef<SuperOrderBlockFvgBosOverlay | null>(null);
  const shouldResetViewportRef = useRef(true);
  const serializedPrefsRef = useRef<string>("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [statusMessage, setStatusMessage] = useState<string>(t("status.loadingCandles"));
  const [rawCandles, setRawCandles] = useState<CandleApiItem[]>([]);
  const [lastClose, setLastClose] = useState<number | null>(null);
  const [showUpMarkers, setShowUpMarkers] = useState(Boolean(chartPreferences?.showUpMarkers));
  const [showDownMarkers, setShowDownMarkers] = useState(Boolean(chartPreferences?.showDownMarkers));
  const [predictionMarkers, setPredictionMarkers] = useState<SeriesMarker<Time>[]>([]);
  const [smcMarkers, setSmcMarkers] = useState<SeriesMarker<Time>[]>([]);
  const [breakerMarkers, setBreakerMarkers] = useState<SeriesMarker<Time>[]>([]);
  const [superMarkers, setSuperMarkers] = useState<SeriesMarker<Time>[]>([]);
  const [indicatorToggles, setIndicatorToggles] = useState<IndicatorToggleState>(
    {
      ...DEFAULT_INDICATOR_TOGGLES,
      ...(chartPreferences?.indicatorToggles ?? {})
    }
  );
  const activePreset = useMemo<IndicatorPresetKey | null>(() => {
    for (const [presetKey, preset] of Object.entries(INDICATOR_PRESETS) as Array<
      [IndicatorPresetKey, { labelKey: string; toggles: IndicatorToggleState }]
    >) {
      if (togglesEqual(indicatorToggles, preset.toggles)) return presetKey;
    }
    return null;
  }, [indicatorToggles]);

  const drawSuperOverlayCanvas = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const overlay = superOverlayRef.current;
    if (!canvas || !chart || !candleSeries || !overlay || !indicatorToggles.superOrderBlockFvgBos) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;

    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(width * ratio));
    const pixelHeight = Math.max(1, Math.floor(height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(ratio, ratio);

    const toTime = (ts: number | null): UTCTimestamp | null => {
      if (!Number.isFinite(ts)) return null;
      return Math.floor((ts as number) / 1000) as UTCTimestamp;
    };

    const setDash = (style: SuperOrderBlockFvgBosZone["borderStyle"]) => {
      if (style === "dashed") {
        ctx.setLineDash([6, 4]);
        return;
      }
      if (style === "dotted") {
        ctx.setLineDash([2, 4]);
        return;
      }
      ctx.setLineDash([]);
    };

    for (const box of overlay.rectangles) {
      const leftTime = toTime(box.leftTs);
      const rightTime = toTime(box.rightTs);
      if (leftTime === null || rightTime === null) continue;
      const x1 = chart.timeScale().timeToCoordinate(leftTime);
      const x2 = chart.timeScale().timeToCoordinate(rightTime);
      const y1 = candleSeries.priceToCoordinate(box.top);
      const y2 = candleSeries.priceToCoordinate(box.bottom);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;

      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const widthPx = Math.max(1, Math.abs(x2 - x1));
      const heightPx = Math.max(1, Math.abs(y2 - y1));

      ctx.fillStyle = colorWithAlpha(box.fillColor, box.mitigated ? 0.75 : 1);
      ctx.fillRect(left, top, widthPx, heightPx);

      ctx.strokeStyle = colorWithAlpha(box.borderColor, box.mitigated ? 0.85 : 1);
      ctx.lineWidth = 1;
      setDash(box.borderStyle);
      ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, widthPx - 1), Math.max(0, heightPx - 1));

      if (box.label) {
        ctx.setLineDash([]);
        ctx.fillStyle = colorWithAlpha(box.labelColor, 0.95);
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(box.label, left + widthPx - 3, top + heightPx - 2);
      }
    }
    ctx.setLineDash([]);
  }, [indicatorToggles.superOrderBlockFvgBos]);

  useEffect(() => {
    if (!chartPreferences) return;
    const nextToggles: IndicatorToggleState = {
      ...DEFAULT_INDICATOR_TOGGLES,
      ...(chartPreferences.indicatorToggles ?? {})
    };
    setIndicatorToggles(nextToggles);
    setShowUpMarkers(Boolean(chartPreferences.showUpMarkers));
    setShowDownMarkers(Boolean(chartPreferences.showDownMarkers));
    serializedPrefsRef.current = JSON.stringify({
      indicatorToggles: nextToggles,
      showUpMarkers: Boolean(chartPreferences.showUpMarkers),
      showDownMarkers: Boolean(chartPreferences.showDownMarkers)
    });
  }, [chartPreferences]);

  useEffect(() => {
    const serialized = JSON.stringify({
      indicatorToggles,
      showUpMarkers,
      showDownMarkers
    });
    if (serialized === serializedPrefsRef.current) return;
    serializedPrefsRef.current = serialized;
    onChartPreferencesChange?.({
      indicatorToggles,
      showUpMarkers,
      showDownMarkers
    });
  }, [indicatorToggles, onChartPreferencesChange, showDownMarkers, showUpMarkers]);

  const normalizedTimeframe = useMemo(() => {
    if (timeframe === "1m" || timeframe === "5m" || timeframe === "15m" || timeframe === "1h" || timeframe === "4h" || timeframe === "1d") {
      return timeframe;
    }
    return "15m";
  }, [timeframe]);

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = createChart(hostRef.current, {
      autoSize: true,
      height: 520,
      layout: {
        background: { type: ColorType.Solid, color: "#07101f" },
        textColor: "#c7d2e2"
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,.08)" },
        horzLines: { color: "rgba(148,163,184,.08)" }
      },
      rightPriceScale: {
        borderColor: "rgba(148,163,184,.25)"
      },
      timeScale: {
        borderColor: "rgba(148,163,184,.25)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: CHART_RIGHT_OFFSET
      },
      crosshair: {
        vertLine: { color: "rgba(255,255,255,.22)", width: 1 },
        horzLine: { color: "rgba(255,255,255,.22)", width: 1 }
      }
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444"
    });
    volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false
    });
    chart.priceScale("").applyOptions({
      scaleMargins: { top: 0.72, bottom: 0 }
    });
    emaSeriesRef.current.ema5 = chart.addSeries(LineSeries, {
      color: "#f7d047",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    emaSeriesRef.current.ema13 = chart.addSeries(LineSeries, {
      color: "#f87171",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    emaSeriesRef.current.ema50 = chart.addSeries(LineSeries, {
      color: "#22d3ee",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    emaSeriesRef.current.ema200 = chart.addSeries(LineSeries, {
      color: "#e2e8f0",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    emaSeriesRef.current.ema800 = chart.addSeries(LineSeries, {
      color: "#8b5cf6",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    emaCloudUpperRef.current = chart.addSeries(LineSeries, {
      color: "rgba(34,211,238,.45)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    emaCloudLowerRef.current = chart.addSeries(LineSeries, {
      color: "rgba(34,211,238,.45)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    vwapSeriesRef.current = chart.addSeries(LineSeries, {
      color: "#f97316",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    dailyOpenSeriesRef.current = chart.addSeries(LineSeries, {
      color: "rgba(250,204,21,.9)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    breakerSeriesRef.current.bbTop = chart.addSeries(LineSeries, {
      color: "rgba(34,197,94,.8)",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    breakerSeriesRef.current.bbBottom = chart.addSeries(LineSeries, {
      color: "rgba(34,197,94,.8)",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    breakerSeriesRef.current.bbMid = chart.addSeries(LineSeries, {
      color: "rgba(192,192,192,.85)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    breakerSeriesRef.current.line1 = chart.addSeries(LineSeries, {
      color: "rgba(148,163,184,.9)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    breakerSeriesRef.current.line2 = chart.addSeries(LineSeries, {
      color: "rgba(148,163,184,.9)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    breakerSeriesRef.current.pd1 = chart.addSeries(LineSeries, {
      color: "rgba(239,68,68,.75)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    breakerSeriesRef.current.pd2 = chart.addSeries(LineSeries, {
      color: "rgba(20,184,166,.75)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    breakerSeriesRef.current.tp1 = chart.addSeries(LineSeries, {
      color: "rgba(33,87,243,.9)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    breakerSeriesRef.current.tp2 = chart.addSeries(LineSeries, {
      color: "rgba(33,87,243,.9)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    breakerSeriesRef.current.tp3 = chart.addSeries(LineSeries, {
      color: "rgba(33,87,243,.9)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    superPivotSeriesRef.current.top = chart.addSeries(LineSeries, {
      color: "rgba(192,192,192,.9)",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    superPivotSeriesRef.current.bottom = chart.addSeries(LineSeries, {
      color: "rgba(192,192,192,.9)",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false
    });
    markerPluginRef.current = createSeriesMarkers(candleSeries, []);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    return () => {
      for (const line of prefillLinesRef.current) {
        candleSeries.removePriceLine(line);
      }
      prefillLinesRef.current = [];
      markerPluginRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      chartRef.current = null;
      emaSeriesRef.current = { ema5: null, ema13: null, ema50: null, ema200: null, ema800: null };
      emaCloudUpperRef.current = null;
      emaCloudLowerRef.current = null;
      vwapSeriesRef.current = null;
      dailyOpenSeriesRef.current = null;
      breakerSeriesRef.current = {
        bbTop: null,
        bbBottom: null,
        bbMid: null,
        line1: null,
        line2: null,
        pd1: null,
        pd2: null,
        tp1: null,
        tp2: null,
        tp3: null
      };
      superPivotSeriesRef.current = { top: null, bottom: null };
      for (const line of selectedPositionLinesRef.current) {
        candleSeries.removePriceLine(line);
      }
      selectedPositionLinesRef.current = [];
      superOverlayRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !host) return;

    const redraw = () => {
      drawSuperOverlayCanvas();
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    const resizeObserver = new ResizeObserver(redraw);
    resizeObserver.observe(host);

    redraw();

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(redraw);
      resizeObserver.disconnect();
    };
  }, [drawSuperOverlayCanvas]);

  useEffect(() => {
    if (!exchangeAccountId || !symbol || !candleSeriesRef.current) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    shouldResetViewportRef.current = true;

    const fetchCandles = async () => {
      try {
        const payload = await apiGet<CandlesResponse>(
          `/api/market/candles?exchangeAccountId=${encodeURIComponent(exchangeAccountId)}&symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(normalizedTimeframe)}&limit=${CHART_CANDLE_FETCH_LIMIT}`
        );
        if (!active) return;
        setRawCandles(payload.items ?? []);
        const data = toChartData(payload.items, false);
        const close = data.length > 0 ? data[data.length - 1]?.close ?? null : null;
        setLastClose(close ?? null);
        setStatus("ready");
        setStatusMessage(
          data.length > 0
            ? t("status.visibleLoaded", {
                visible: String(Math.min(CHART_VISIBLE_CANDLE_COUNT, data.length)),
                loaded: String(data.length)
              })
            : t("status.noCandles")
        );
      } catch (error) {
        if (!active) return;
        setStatus("error");
        setStatusMessage(t("status.chartError", { error: errMsg(error) }));
      }
    };

    setStatus("loading");
    setStatusMessage(t("status.loadingCandles"));
    void fetchCandles();
    timer = setInterval(() => {
      void fetchCandles();
    }, 15000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [exchangeAccountId, symbol, normalizedTimeframe, t]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    for (const line of prefillLinesRef.current) {
      series.removePriceLine(line);
    }
    prefillLinesRef.current = [];

    if (!prefill) return;

    const lines: IPriceLine[] = [];
    const suggestedEntry =
      prefill.suggestedEntry?.type === "limit" && typeof prefill.suggestedEntry.price === "number"
        ? prefill.suggestedEntry.price
        : lastClose;

    if (typeof suggestedEntry === "number" && Number.isFinite(suggestedEntry)) {
      lines.push(
        series.createPriceLine({
          price: suggestedEntry,
          color: "#38bdf8",
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          title: "Entry"
        })
      );
    }

    if (typeof prefill.suggestedTakeProfit === "number" && Number.isFinite(prefill.suggestedTakeProfit)) {
      lines.push(
        series.createPriceLine({
          price: prefill.suggestedTakeProfit,
          color: "#22c55e",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: "TP"
        })
      );
    }

    if (typeof prefill.suggestedStopLoss === "number" && Number.isFinite(prefill.suggestedStopLoss)) {
      lines.push(
        series.createPriceLine({
          price: prefill.suggestedStopLoss,
          color: "#ef4444",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: "SL"
        })
      );
    }

    prefillLinesRef.current = lines;
  }, [prefill, lastClose]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const line of selectedPositionLinesRef.current) {
      series.removePriceLine(line);
    }
    selectedPositionLinesRef.current = [];
    if (!selectedPosition) return;

    const nextLines: IPriceLine[] = [];
    if (typeof selectedPosition.entryPrice === "number" && Number.isFinite(selectedPosition.entryPrice)) {
      nextLines.push(
        series.createPriceLine({
          price: selectedPosition.entryPrice,
          color: "#60a5fa",
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          title: t("position.entry")
        })
      );
    }
    if (typeof selectedPosition.markPrice === "number" && Number.isFinite(selectedPosition.markPrice)) {
      nextLines.push(
        series.createPriceLine({
          price: selectedPosition.markPrice,
          color: "#f59e0b",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          title: t("position.mark")
        })
      );
    }
    if (typeof selectedPosition.takeProfitPrice === "number" && Number.isFinite(selectedPosition.takeProfitPrice)) {
      nextLines.push(
        series.createPriceLine({
          price: selectedPosition.takeProfitPrice,
          color: "#22c55e",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: t("position.tp")
        })
      );
    }
    if (typeof selectedPosition.stopLossPrice === "number" && Number.isFinite(selectedPosition.stopLossPrice)) {
      nextLines.push(
        series.createPriceLine({
          price: selectedPosition.stopLossPrice,
          color: "#ef4444",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: t("position.sl")
        })
      );
    }
    selectedPositionLinesRef.current = nextLines;
  }, [selectedPosition, t]);

  useEffect(() => {
    if (!candleSeriesRef.current) return;

    const normalized = normalizeCandles(rawCandles);
    const superOverlay = indicatorToggles.superOrderBlockFvgBos
      ? computeSuperOrderBlockFvgBosOverlay(
        normalized.map((row) => ({
          ts: row.ts,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume
        })),
        normalizeSuperOrderBlockFvgBosSettings()
      )
      : null;
    superOverlayRef.current = superOverlay;

    const hvbColorByTs = new Map<number, string>();
    if (superOverlay && superOverlay.hvbColors.length > 0) {
      for (let i = 0; i < superOverlay.hvbColors.length && i < normalized.length; i += 1) {
        const color = superOverlay.hvbColors[i];
        if (!color) continue;
        hvbColorByTs.set(normalized[i].ts, color);
      }
    }

    const candleData = toChartData(rawCandles, indicatorToggles.pvsraVector, hvbColorByTs);
    candleSeriesRef.current.setData(candleData);
    chartRef.current?.timeScale().applyOptions({ rightOffset: CHART_RIGHT_OFFSET });
    if (shouldResetViewportRef.current) {
      requestAnimationFrame(() => {
        applyLatestViewport(
          chartRef.current,
          candleData,
          normalizedTimeframe,
          CHART_VISIBLE_CANDLE_COUNT,
          CHART_RIGHT_OFFSET
        );
      });
      shouldResetViewportRef.current = false;
    }

    if (indicatorToggles.volumeOverlay) {
      const volumeData = buildVolumeHistogram(rawCandles);
      volumeSeriesRef.current?.setData(volumeData);
      volumeSeriesRef.current?.applyOptions({ visible: volumeData.length > 0 });
    } else {
      volumeSeriesRef.current?.setData([]);
      volumeSeriesRef.current?.applyOptions({ visible: false });
    }

    if (normalized.length === 0) {
      for (const key of ["ema5", "ema13", "ema50", "ema200", "ema800"] as const) {
        emaSeriesRef.current[key]?.setData([]);
        emaSeriesRef.current[key]?.applyOptions({ visible: false });
      }
      emaCloudUpperRef.current?.setData([]);
      emaCloudLowerRef.current?.setData([]);
      emaCloudUpperRef.current?.applyOptions({ visible: false });
      emaCloudLowerRef.current?.applyOptions({ visible: false });
      vwapSeriesRef.current?.setData([]);
      vwapSeriesRef.current?.applyOptions({ visible: false });
      dailyOpenSeriesRef.current?.setData([]);
      dailyOpenSeriesRef.current?.applyOptions({ visible: false });
      for (const key of BREAKER_SERIES_KEYS) {
        breakerSeriesRef.current[key]?.setData([]);
        breakerSeriesRef.current[key]?.applyOptions({ visible: false });
      }
      superPivotSeriesRef.current.top?.setData([]);
      superPivotSeriesRef.current.top?.applyOptions({ visible: false });
      superPivotSeriesRef.current.bottom?.setData([]);
      superPivotSeriesRef.current.bottom?.applyOptions({ visible: false });
      setSmcMarkers([]);
      setBreakerMarkers([]);
      setSuperMarkers([]);
      drawSuperOverlayCanvas();
      return;
    }

    const emaDefs: Array<{ key: keyof IndicatorToggleState; seriesKey: keyof typeof emaSeriesRef.current; period: number }> = [
      { key: "ema5", seriesKey: "ema5", period: 5 },
      { key: "ema13", seriesKey: "ema13", period: 13 },
      { key: "ema50", seriesKey: "ema50", period: 50 },
      { key: "ema200", seriesKey: "ema200", period: 200 },
      { key: "ema800", seriesKey: "ema800", period: 800 }
    ];

    for (const def of emaDefs) {
      const series = emaSeriesRef.current[def.seriesKey];
      if (!series) continue;
      if (!indicatorToggles[def.key]) {
        series.applyOptions({ visible: false });
        series.setData([]);
        continue;
      }
      const points = buildEmaLine(normalized, def.period);
      series.setData(points);
      series.applyOptions({ visible: points.length > 0 });
    }

    const ema50ForCloud = buildEmaLine(normalized, 50);
    if (indicatorToggles.emaCloud50 && ema50ForCloud.length > 0) {
      const closes = normalized.map((row) => row.close);
      const stdevWindow = 100;
      const upper: LineData<Time>[] = [];
      const lower: LineData<Time>[] = [];
      for (let i = 0; i < ema50ForCloud.length; i += 1) {
        const sourceIndex = (50 - 1) + i;
        if (sourceIndex < stdevWindow - 1) continue;
        const start = sourceIndex - stdevWindow + 1;
        const window = closes.slice(start, sourceIndex + 1);
        const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
        let variance = 0;
        for (const value of window) {
          const delta = value - mean;
          variance += delta * delta;
        }
        const stdev = Math.sqrt(variance / window.length);
        const cloudSize = stdev / 4;
        const mid = ema50ForCloud[i].value;
        const top = mid + cloudSize;
        const bottom = mid - cloudSize;
        upper.push({ time: ema50ForCloud[i].time, value: top });
        lower.push({ time: ema50ForCloud[i].time, value: bottom });
      }
      emaCloudUpperRef.current?.setData(upper);
      emaCloudLowerRef.current?.setData(lower);
      emaCloudUpperRef.current?.applyOptions({ visible: upper.length > 0 });
      emaCloudLowerRef.current?.applyOptions({ visible: lower.length > 0 });
    } else {
      emaCloudUpperRef.current?.setData([]);
      emaCloudLowerRef.current?.setData([]);
      emaCloudUpperRef.current?.applyOptions({ visible: false });
      emaCloudLowerRef.current?.applyOptions({ visible: false });
    }

    if (indicatorToggles.vwapSession) {
      const points = buildSessionVwapLine(normalized);
      vwapSeriesRef.current?.setData(points);
      vwapSeriesRef.current?.applyOptions({ visible: points.length > 0 });
    } else {
      vwapSeriesRef.current?.setData([]);
      vwapSeriesRef.current?.applyOptions({ visible: false });
    }

    if (indicatorToggles.dailyOpen) {
      const points = buildDailyOpenLine(normalized);
      dailyOpenSeriesRef.current?.setData(points);
      dailyOpenSeriesRef.current?.applyOptions({ visible: points.length > 0 });
    } else {
      dailyOpenSeriesRef.current?.setData([]);
      dailyOpenSeriesRef.current?.applyOptions({ visible: false });
    }

    if (indicatorToggles.smcStructure) {
      setSmcMarkers(buildSmcStructureMarkers(normalized));
    } else {
      setSmcMarkers([]);
    }

    if (indicatorToggles.breakerBlocks) {
      const overlay = computeBreakerBlocksOverlay(
        normalized.map((row) => ({
          ts: row.ts,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume
        }))
      );

      breakerSeriesRef.current.bbTop?.applyOptions({
        color: overlay.state.dir === -1 ? overlay.colors.bbMinusB : overlay.colors.bbPlusB
      });
      breakerSeriesRef.current.bbBottom?.applyOptions({
        color: overlay.state.dir === -1 ? overlay.colors.bbMinusB : overlay.colors.bbPlusB
      });
      breakerSeriesRef.current.bbMid?.applyOptions({
        color: overlay.colors.pdLine
      });
      breakerSeriesRef.current.line1?.applyOptions({
        color: overlay.colors.pdLine
      });
      breakerSeriesRef.current.line2?.applyOptions({
        color: overlay.colors.pdLine
      });
      breakerSeriesRef.current.pd1?.applyOptions({
        color: overlay.colors.swingBull
      });
      breakerSeriesRef.current.pd2?.applyOptions({
        color: overlay.colors.swingBear
      });
      breakerSeriesRef.current.tp1?.applyOptions({
        color: overlay.colors.tp
      });
      breakerSeriesRef.current.tp2?.applyOptions({
        color: overlay.colors.tp
      });
      breakerSeriesRef.current.tp3?.applyOptions({
        color: overlay.colors.tp
      });

      for (const key of BREAKER_SERIES_KEYS) {
        const points = buildBreakerLine(normalized, overlay.series[key]);
        breakerSeriesRef.current[key]?.setData(points);
        breakerSeriesRef.current[key]?.applyOptions({ visible: points.length > 0 });
      }

      const events = overlay.events.length > 250
        ? overlay.events.slice(overlay.events.length - 250)
        : overlay.events;
      const markers: SeriesMarker<Time>[] = [];
      for (const event of events) {
        if (!Number.isFinite(event.ts)) continue;
        const direction = event.direction;
        markers.push({
          time: Math.floor((event.ts as number) / 1000) as UTCTimestamp,
          position:
            direction === "up"
              ? "belowBar"
              : direction === "down"
                ? "aboveBar"
                : "inBar",
          shape:
            direction === "up"
              ? "arrowUp"
              : direction === "down"
                ? "arrowDown"
                : "circle",
          color:
            direction === "up"
              ? "#22c55e"
              : direction === "down"
                ? "#ef4444"
                : "#eab308",
          text: event.key
        });
      }
      setBreakerMarkers(markers);
    } else {
      for (const key of BREAKER_SERIES_KEYS) {
        breakerSeriesRef.current[key]?.setData([]);
        breakerSeriesRef.current[key]?.applyOptions({ visible: false });
      }
      setBreakerMarkers([]);
    }

    if (superOverlay) {
      const topPoints = buildBreakerLine(normalized, superOverlay.pivotTop);
      const bottomPoints = buildBreakerLine(normalized, superOverlay.pivotBottom);
      superPivotSeriesRef.current.top?.setData(topPoints);
      superPivotSeriesRef.current.top?.applyOptions({
        visible: indicatorToggles.superOrderBlockFvgBos && topPoints.length > 0,
        color: superOverlay.settings.pvtTopColor
      });
      superPivotSeriesRef.current.bottom?.setData(bottomPoints);
      superPivotSeriesRef.current.bottom?.applyOptions({
        visible: indicatorToggles.superOrderBlockFvgBos && bottomPoints.length > 0,
        color: superOverlay.settings.pvtBottomColor
      });

      const recent = superOverlay.markers.length > 350
        ? superOverlay.markers.slice(superOverlay.markers.length - 350)
        : superOverlay.markers;
      const markers: SeriesMarker<Time>[] = [];
      for (const marker of recent) {
        if (!Number.isFinite(marker.ts)) continue;
        const shape = marker.shape;
        const seriesShape: SeriesMarker<Time>["shape"] =
          shape === "triangle_up"
            ? "arrowUp"
            : shape === "triangle_down"
              ? "arrowDown"
              : shape === "diamond"
                ? "square"
                : "circle";
        const position: SeriesMarker<Time>["position"] =
          marker.side === "bull" ? "belowBar" : "aboveBar";
        markers.push({
          time: Math.floor((marker.ts as number) / 1000) as UTCTimestamp,
          position,
          shape: seriesShape,
          color: marker.color,
          text:
            marker.type === "ppdd"
              ? "PPDD"
              : marker.type === "ppdd_weak"
                ? "PPDD1"
                : "OB+FVG"
        });
      }
      setSuperMarkers(markers);
    } else {
      superPivotSeriesRef.current.top?.setData([]);
      superPivotSeriesRef.current.top?.applyOptions({ visible: false });
      superPivotSeriesRef.current.bottom?.setData([]);
      superPivotSeriesRef.current.bottom?.applyOptions({ visible: false });
      setSuperMarkers([]);
    }

    drawSuperOverlayCanvas();
  }, [rawCandles, indicatorToggles, normalizedTimeframe, drawSuperOverlayCanvas]);

  useEffect(() => {
    if (!exchangeAccountId || !symbol || !markerPluginRef.current) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchMarkers = async () => {
      try {
        const payload = await apiGet<{ items: PredictionListItem[] }>(
          "/api/predictions?limit=200&mode=history"
        );
        if (!active || !markerPluginRef.current) return;
        const filtered = (payload.items ?? []).filter(
          (row) =>
            row.symbol?.toUpperCase() === symbol.toUpperCase() &&
            row.timeframe === normalizedTimeframe &&
            row.signal !== "neutral" &&
            ((row.signal === "up" && showUpMarkers) || (row.signal === "down" && showDownMarkers)) &&
            (!!row.accountId ? row.accountId === exchangeAccountId : true)
        );

        const markers: SeriesMarker<Time>[] = [];
        for (const row of filtered) {
          const ts = new Date(row.tsCreated).getTime();
          if (!Number.isFinite(ts)) continue;
          const time = Math.floor(ts / 1000) as UTCTimestamp;
          if (row.signal === "up") {
            markers.push({
              time,
              position: "belowBar",
              shape: "arrowUp",
              color: "#22c55e",
              text: `UP ${Number.isFinite(row.confidence) ? `${row.confidence.toFixed(0)}%` : ""}`
            });
            continue;
          }
          if (row.signal === "down") {
            markers.push({
              time,
              position: "aboveBar",
              shape: "arrowDown",
              color: "#ef4444",
              text: `DOWN ${Number.isFinite(row.confidence) ? `${row.confidence.toFixed(0)}%` : ""}`
            });
            continue;
          }
          markers.push({
            time,
            position: "inBar",
            shape: "circle",
            color: "#94a3b8",
            text: "NEUTRAL"
          });
        }

        setPredictionMarkers(markers);
      } catch {
        if (!active) return;
        setPredictionMarkers([]);
      }
    };

    void fetchMarkers();
    timer = setInterval(() => {
      void fetchMarkers();
    }, 30000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      setPredictionMarkers([]);
    };
  }, [exchangeAccountId, symbol, normalizedTimeframe, showUpMarkers, showDownMarkers]);

  useEffect(() => {
    if (!markerPluginRef.current) return;
    const merged = [...predictionMarkers, ...smcMarkers, ...breakerMarkers, ...superMarkers].sort(
      (a, b) => Number(a.time) - Number(b.time)
    );
    markerPluginRef.current.setMarkers(merged);
  }, [predictionMarkers, smcMarkers, breakerMarkers, superMarkers]);

  return (
    <div>
      <div style={{ position: "relative", width: "100%", height: "clamp(280px, 55vh, 520px)" }}>
        <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
        <canvas
          ref={overlayCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none"
          }}
        />
      </div>
      <div className="tradeChartMeta" style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span>{t("engine")}</span>
        <span>
          {statusMessage}
        </span>
      </div>
      <div className="tradeChartMarkerToggles" style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={showUpMarkers}
            onChange={(event) => setShowUpMarkers(event.target.checked)}
          />
          {t("markers.showUp")}
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={showDownMarkers}
            onChange={(event) => setShowDownMarkers(event.target.checked)}
          />
          {t("markers.showDown")}
        </label>
      </div>
      <div className="tradeChartIndicatorToggles" style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12 }}>
        <span style={{ opacity: 0.8 }}>{t("indicators.title")}</span>
        {[
          { key: "ema5", label: t("indicators.ema5") },
          { key: "ema13", label: t("indicators.ema13") },
          { key: "ema50", label: t("indicators.ema50") },
          { key: "ema200", label: t("indicators.ema200") },
          { key: "ema800", label: t("indicators.ema800") },
          { key: "emaCloud50", label: t("indicators.emaCloud50") },
          { key: "vwapSession", label: t("indicators.vwapSession") },
          { key: "dailyOpen", label: t("indicators.dailyOpen") },
          { key: "smcStructure", label: t("indicators.smcStructure") },
          { key: "volumeOverlay", label: t("indicators.volumeOverlay") },
          { key: "pvsraVector", label: t("indicators.pvsraVector") },
          { key: "breakerBlocks", label: t("indicators.breakerBlocks") },
          { key: "superOrderBlockFvgBos", label: t("indicators.superOrderBlockFvgBos") }
        ].map((item) => (
          <label key={item.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={indicatorToggles[item.key as keyof IndicatorToggleState]}
              onChange={(event) =>
                setIndicatorToggles((prev) => ({
                  ...prev,
                  [item.key]: event.target.checked
                }))
              }
            />
            {item.label}
          </label>
        ))}
      </div>
      <div className="tradeChartPresets" style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, opacity: 0.8 }}>{t("presets.title")}</span>
        {(Object.keys(INDICATOR_PRESETS) as IndicatorPresetKey[]).map((presetKey) => {
          const preset = INDICATOR_PRESETS[presetKey];
          const selected = activePreset === presetKey;
          return (
            <button
              key={presetKey}
              type="button"
              className="btn"
              onClick={() => setIndicatorToggles(preset.toggles)}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                minHeight: 0,
                borderColor: selected ? "rgba(56,189,248,.95)" : undefined,
                color: selected ? "#38bdf8" : undefined
              }}
            >
              {t(preset.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
