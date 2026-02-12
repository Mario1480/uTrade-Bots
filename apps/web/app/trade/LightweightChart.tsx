"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createSeriesMarkers,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
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

const CHART_CANDLE_LIMIT = 200;
const CHART_RIGHT_OFFSET = 8;

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
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const prefillLinesRef = useRef<IPriceLine[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [statusMessage, setStatusMessage] = useState<string>("Loading candles...");
  const [lastClose, setLastClose] = useState<number | null>(null);
  const [showUpMarkers, setShowUpMarkers] = useState(false);
  const [showDownMarkers, setShowDownMarkers] = useState(false);

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
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!exchangeAccountId || !symbol || !candleSeriesRef.current) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchCandles = async () => {
      try {
        const payload = await apiGet<CandlesResponse>(
          `/api/market/candles?exchangeAccountId=${encodeURIComponent(exchangeAccountId)}&symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(normalizedTimeframe)}&limit=${CHART_CANDLE_LIMIT}`
        );
        if (!active) return;
        const data = toChartData(payload.items);
        candleSeriesRef.current?.setData(data);
        chartRef.current?.timeScale().fitContent();
        chartRef.current?.timeScale().applyOptions({ rightOffset: CHART_RIGHT_OFFSET });
        const close = data.length > 0 ? data[data.length - 1]?.close ?? null : null;
        setLastClose(close ?? null);
        setStatus("ready");
        setStatusMessage(data.length > 0 ? `${data.length} candles loaded` : "No candles available");
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
    </div>
  );
}
