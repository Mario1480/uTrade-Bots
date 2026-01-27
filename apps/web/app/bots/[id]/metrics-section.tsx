"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend
} from "recharts";
import { ApiError, apiGet } from "../../../lib/api";

type MetricsRange = "1h" | "6h" | "24h" | "7d" | "30d";

type MetricPoint = {
  ts: string;
  mid?: number;
  spreadPct?: number;
  freeQuote?: number;
  freeBase?: number;
  openOrders?: number;
  tradedNotionalToday?: number;
  status?: string;
  reason?: string;
};

type MetricsResponse = {
  range: string;
  from: string;
  to: string;
  stepSec: number;
  points: MetricPoint[];
};

type MetricsSectionProps = {
  botId: string;
  symbol?: string | null;
};

type ChartPoint = {
  ts: number;
  mid: number | null;
  spreadPct: number | null;
  freeQuote: number | null;
  freeBase: number | null;
  tradedNotionalToday: number | null;
};

const RANGES: MetricsRange[] = ["1h", "6h", "24h", "7d", "30d"];

const rangeConfig: Record<MetricsRange, { maxPoints: number; label: string }> = {
  "1h": { maxPoints: 600, label: "1h" },
  "6h": { maxPoints: 600, label: "6h" },
  "24h": { maxPoints: 600, label: "24h" },
  "7d": { maxPoints: 600, label: "7d" },
  "30d": { maxPoints: 600, label: "30d" }
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e instanceof Error) return e.message;
  return String(e);
}

function clampPoints(points: MetricPoint[], maxPoints: number): MetricPoint[] {
  if (points.length <= maxPoints) return points;
  return points.slice(points.length - maxPoints);
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  const sum = nums.reduce((acc, v) => acc + v, 0);
  return sum / nums.length;
}

function formatNum(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Number(value).toFixed(decimals);
}

function formatTime(ts: number, range: MetricsRange): string {
  const date = new Date(ts);
  if (range === "7d" || range === "30d") {
    return date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" });
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function lastDefined<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  return values[values.length - 1] ?? null;
}

function getBaseSymbol(symbol?: string | null): string {
  if (!symbol) return "Base";
  const raw = String(symbol);
  return raw.split(/[/_-]/)[0] || "Base";
}

export default function MetricsSection(props: MetricsSectionProps) {
  const { botId, symbol } = props;

  const [range, setRange] = useState<MetricsRange>("1h");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MetricsResponse | null>(null);

  const baseSymbol = useMemo(() => getBaseSymbol(symbol), [symbol]);

  const loadMetrics = useCallback(async () => {
    if (!botId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await apiGet<MetricsResponse>(`/bots/${botId}/metrics?range=${range}`);
      const maxPoints = rangeConfig[range].maxPoints;
      const limited = clampPoints(res.points ?? [], maxPoints);
      setData({ ...res, points: limited });
    } catch (e) {
      setError(errMsg(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [botId, range]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const points = data?.points ?? [];

  const chartPoints: ChartPoint[] = useMemo(() => {
    return points
      .map((p) => {
        const ts = new Date(p.ts).getTime();
        if (!Number.isFinite(ts)) return null;
        return {
          ts,
          mid: typeof p.mid === "number" ? p.mid : null,
          spreadPct: typeof p.spreadPct === "number" ? p.spreadPct : null,
          freeQuote: typeof p.freeQuote === "number" ? p.freeQuote : null,
          freeBase: typeof p.freeBase === "number" ? p.freeBase : null,
          tradedNotionalToday:
            typeof p.tradedNotionalToday === "number" ? p.tradedNotionalToday : null
        } satisfies ChartPoint;
      })
      .filter((p): p is ChartPoint => Boolean(p));
  }, [points]);

  const latest = lastDefined(chartPoints);

  const avgSpread = useMemo(() => avg(chartPoints.map((p) => p.spreadPct)), [chartPoints]);

  const inventoryValue = useMemo(() => {
    if (!latest) return null;
    const mid = latest.mid;
    const freeQuote = latest.freeQuote ?? 0;
    const freeBase = latest.freeBase ?? 0;
    if (!Number.isFinite(mid ?? NaN)) return freeQuote;
    return freeQuote + freeBase * (mid as number);
  }, [latest]);

  const lastUpdateLabel = latest ? new Date(latest.ts).toLocaleTimeString() : "—";

  const kpiGridStyle: CSSProperties = {
    display: "grid",
    gap: 8,
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))"
  };

  const chartGridStyle: CSSProperties = {
    display: "grid",
    gap: 10,
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))"
  };

  const chartCardStyle: CSSProperties = {
    padding: 10,
    minHeight: 220,
    display: "flex",
    flexDirection: "column",
    gap: 8
  };

  const showEmpty = !loading && !error && chartPoints.length === 0;

  return (
    <section className="card" style={{ padding: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap"
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 0 }}>Metrics</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {RANGES.map((r) => (
              <button
                key={r}
                className={`btn ${range === r ? "btnPrimary" : ""} ${loading ? "btnDisabled" : ""}`}
                onClick={() => setRange(r)}
                disabled={loading}
                type="button"
              >
                {rangeConfig[r].label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Last update: {lastUpdateLabel}</div>
        </div>
      </div>

      {error ? (
        <div
          className="card"
          style={{
            marginTop: 10,
            padding: "10px 12px",
            border: "1px solid #ef4444",
            background: "rgba(239,68,68,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap"
          }}
        >
          <div style={{ fontSize: 13 }}>Metrics failed: {error}</div>
          <button className="btn" onClick={() => void loadMetrics()} type="button">
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>Loading metrics…</div>
      ) : null}

      {showEmpty ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
          No metrics yet. Runner must be running to collect metrics.
        </div>
      ) : null}

      {chartPoints.length > 0 ? (
        <>
          <div style={{ marginTop: 12 }}>
            <div className="gridTwoCol" style={kpiGridStyle}>
              <KpiCard label="Mid" value={formatNum(latest?.mid, 6)} />
              <KpiCard label="Avg Spread %" value={formatNum(avgSpread, 4)} />
              <KpiCard label="Inventory Value" value={formatNum(inventoryValue, 2)} suffix="USDT" />
              <KpiCard
                label="Volume Today"
                value={formatNum(latest?.tradedNotionalToday, 2)}
                suffix="USDT"
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="gridTwoCol" style={chartGridStyle}>
              <ChartCard title="Mid Price Over Time" style={chartCardStyle}>
                <ResponsiveContainer width="100%" height={190}>
                  <LineChart data={chartPoints} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      scale="time"
                      tickFormatter={(value) => formatTime(Number(value), range)}
                      domain={["dataMin", "dataMax"]}
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                      width={70}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip content={<MetricsTooltip range={range} />} />
                    <Line
                      type="monotone"
                      dataKey="mid"
                      stroke="var(--brand)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Spread % Over Time" style={chartCardStyle}>
                <ResponsiveContainer width="100%" height={190}>
                  <LineChart data={chartPoints} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      scale="time"
                      tickFormatter={(value) => formatTime(Number(value), range)}
                      domain={["dataMin", "dataMax"]}
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                      width={70}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip content={<MetricsTooltip range={range} />} />
                    <Line
                      type="monotone"
                      dataKey="spreadPct"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Inventory Over Time" style={chartCardStyle}>
                <ResponsiveContainer width="100%" height={190}>
                  <LineChart data={chartPoints} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      scale="time"
                      tickFormatter={(value) => formatTime(Number(value), range)}
                      domain={["dataMin", "dataMax"]}
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                      width={70}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip content={<MetricsTooltip range={range} />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted)" }} />
                    <Line
                      name="Free USDT"
                      type="monotone"
                      dataKey="freeQuote"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      name={`Free ${baseSymbol}`}
                      type="monotone"
                      dataKey="freeBase"
                      stroke="#a78bfa"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Volume Today" style={chartCardStyle}>
                <ResponsiveContainer width="100%" height={190}>
                  <LineChart data={chartPoints} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      scale="time"
                      tickFormatter={(value) => formatTime(Number(value), range)}
                      domain={["dataMin", "dataMax"]}
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                      width={70}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip content={<MetricsTooltip range={range} />} />
                    <Line
                      type="monotone"
                      dataKey="tradedNotionalToday"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function KpiCard(props: { label: string; value: string; suffix?: string }) {
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="adminMeta">{props.label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
        {props.value}
        {props.suffix ? (
          <span style={{ fontSize: 12, marginLeft: 6, color: "var(--muted)" }}>{props.suffix}</span>
        ) : null}
      </div>
    </div>
  );
}

function ChartCard(props: { title: string; style?: CSSProperties; children: React.ReactNode }) {
  return (
    <div className="card" style={props.style}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{props.title}</div>
      <div style={{ flex: 1 }}>{props.children}</div>
    </div>
  );
}

function MetricsTooltip(props: { active?: boolean; payload?: any[]; label?: number; range: MetricsRange }) {
  const { active, payload, label } = props;
  if (!active || !payload || payload.length === 0 || !label) return null;
  const timeLabel = new Date(label).toLocaleString();
  const entries = payload.filter((p) => typeof p?.value === "number" && Number.isFinite(p.value));
  if (entries.length === 0) return null;

  return (
    <div
      className="card"
      style={{
        padding: 8,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(5,10,18,0.96)",
        minWidth: 160
      }}
    >
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{timeLabel}</div>
      <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
        {entries.map((entry) => (
          <div key={entry.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ color: entry.color }}>{entry.name ?? entry.dataKey}</span>
            <span>{formatNum(entry.value, entry.dataKey === "mid" ? 6 : 4)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
