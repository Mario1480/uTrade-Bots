"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";
import { apiGet, ApiError } from "../../lib/api";
import type { TradeDeskPrefillPayload } from "../../src/schemas/tradeDeskPrefill";

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
};

const CHART_CANDLE_FETCH_LIMIT = 1000;
const CHART_VISIBLE_CANDLE_COUNT = 200;
const CHART_RIGHT_OFFSET = 8;

type IndicatorToggleState = {
  ema5: boolean;
  ema13: boolean;
  ema50: boolean;
  ema200: boolean;
  ema800: boolean;
  emaCloud50: boolean;
  vwapSession: boolean;
  dailyOpen: boolean;
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
  dailyOpen: false
};

const INDICATOR_PRESETS: Record<IndicatorPresetKey, { label: string; toggles: IndicatorToggleState }> = {
  scalping: {
    label: "Scalping",
    toggles: {
      ema5: true,
      ema13: true,
      ema50: false,
      ema200: false,
      ema800: false,
      emaCloud50: false,
      vwapSession: true,
      dailyOpen: true
    }
  },
  trend: {
    label: "Trend",
    toggles: {
      ema5: false,
      ema13: false,
      ema50: true,
      ema200: true,
      ema800: true,
      emaCloud50: true,
      vwapSession: false,
      dailyOpen: true
    }
  },
  off: {
    label: "Alle aus",
    toggles: {
      ema5: false,
      ema13: false,
      ema50: false,
      ema200: false,
      ema800: false,
      emaCloud50: false,
      vwapSession: false,
      dailyOpen: false
    }
  },
  all: {
    label: "Alle an",
    toggles: {
      ema5: true,
      ema13: true,
      ema50: true,
      ema200: true,
      ema800: true,
      emaCloud50: true,
      vwapSession: true,
      dailyOpen: true
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
    a.dailyOpen === b.dailyOpen
  );
}

function normalizeCandles(items: CandleApiItem[]): Array<CandleApiItem & { ts: number }> {
  return items
    .filter((row): row is CandleApiItem & { ts: number } => row.ts !== null && Number.isFinite(row.ts))
    .slice()
    .sort((a, b) => a.ts - b.ts);
}

function toChartData(items: CandleApiItem[]): CandlestickData[] {
  const out: CandlestickData[] = [];
  for (const row of items) {
    if (!row.ts || !Number.isFinite(row.ts)) continue;
    out.push({
      time: Math.floor(row.ts / 1000) as UTCTimestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close
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

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

export function LightweightChart({
  exchangeAccountId,
  symbol,
  timeframe,
  prefill
}: LightweightChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const prefillLinesRef = useRef<IPriceLine[]>([]);
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
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [statusMessage, setStatusMessage] = useState<string>("Loading candles...");
  const [rawCandles, setRawCandles] = useState<CandleApiItem[]>([]);
  const [lastClose, setLastClose] = useState<number | null>(null);
  const [showUpMarkers, setShowUpMarkers] = useState(false);
  const [showDownMarkers, setShowDownMarkers] = useState(false);
  const [indicatorToggles, setIndicatorToggles] = useState<IndicatorToggleState>(
    DEFAULT_INDICATOR_TOGGLES
  );
  const activePreset = useMemo<IndicatorPresetKey | null>(() => {
    for (const [presetKey, preset] of Object.entries(INDICATOR_PRESETS) as Array<
      [IndicatorPresetKey, { label: string; toggles: IndicatorToggleState }]
    >) {
      if (togglesEqual(indicatorToggles, preset.toggles)) return presetKey;
    }
    return null;
  }, [indicatorToggles]);

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
      chartRef.current = null;
      emaSeriesRef.current = { ema5: null, ema13: null, ema50: null, ema200: null, ema800: null };
      emaCloudUpperRef.current = null;
      emaCloudLowerRef.current = null;
      vwapSeriesRef.current = null;
      dailyOpenSeriesRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!exchangeAccountId || !symbol || !candleSeriesRef.current) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let initialViewportApplied = false;

    const fetchCandles = async () => {
      try {
        const payload = await apiGet<CandlesResponse>(
          `/api/market/candles?exchangeAccountId=${encodeURIComponent(exchangeAccountId)}&symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(normalizedTimeframe)}&limit=${CHART_CANDLE_FETCH_LIMIT}`
        );
        if (!active) return;
        setRawCandles(payload.items ?? []);
        const data = toChartData(payload.items);
        candleSeriesRef.current?.setData(data);
        chartRef.current?.timeScale().applyOptions({ rightOffset: CHART_RIGHT_OFFSET });
        if (!initialViewportApplied && chartRef.current) {
          if (data.length > CHART_VISIBLE_CANDLE_COUNT) {
            const to = data.length - 1;
            const from = Math.max(0, to - CHART_VISIBLE_CANDLE_COUNT + 1);
            chartRef.current.timeScale().setVisibleLogicalRange({ from, to });
          } else {
            chartRef.current.timeScale().fitContent();
          }
          initialViewportApplied = true;
        }
        const close = data.length > 0 ? data[data.length - 1]?.close ?? null : null;
        setLastClose(close ?? null);
        setStatus("ready");
        setStatusMessage(
          data.length > 0
            ? `${Math.min(CHART_VISIBLE_CANDLE_COUNT, data.length)} visible · ${data.length} loaded`
            : "No candles available"
        );
      } catch (error) {
        if (!active) return;
        setStatus("error");
        setStatusMessage(errMsg(error));
      }
    };

    setStatus("loading");
    setStatusMessage("Loading candles...");
    void fetchCandles();
    timer = setInterval(() => {
      void fetchCandles();
    }, 15000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [exchangeAccountId, symbol, normalizedTimeframe]);

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
    if (!candleSeriesRef.current) return;

    const normalized = normalizeCandles(rawCandles);
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
  }, [rawCandles, indicatorToggles]);

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

        markerPluginRef.current.setMarkers(markers);
      } catch {
        if (!active || !markerPluginRef.current) return;
        markerPluginRef.current.setMarkers([]);
      }
    };

    void fetchMarkers();
    timer = setInterval(() => {
      void fetchMarkers();
    }, 30000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      markerPluginRef.current?.setMarkers([]);
    };
  }, [exchangeAccountId, symbol, normalizedTimeframe, showUpMarkers, showDownMarkers]);

  return (
    <div>
      <div ref={hostRef} style={{ width: "100%", height: 520 }} />
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span>Chart engine: lightweight-charts</span>
        <span>
          {status === "error" ? `Chart error: ${statusMessage}` : statusMessage}
        </span>
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={showUpMarkers}
            onChange={(event) => setShowUpMarkers(event.target.checked)}
          />
          Show Up Signals
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={showDownMarkers}
            onChange={(event) => setShowDownMarkers(event.target.checked)}
          />
          Show Down Signals
        </label>
      </div>
      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12 }}>
        <span style={{ opacity: 0.8 }}>Indicators:</span>
        {[
          { key: "ema5", label: "EMA 5" },
          { key: "ema13", label: "EMA 13" },
          { key: "ema50", label: "EMA 50" },
          { key: "ema200", label: "EMA 200" },
          { key: "ema800", label: "EMA 800" },
          { key: "emaCloud50", label: "EMA 50 Cloud" },
          { key: "vwapSession", label: "Session VWAP" },
          { key: "dailyOpen", label: "Daily Open" }
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
      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, opacity: 0.8 }}>Presets:</span>
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
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
