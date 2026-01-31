"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, apiGet } from "../../../lib/api";

type Insight = {
  severity: "info" | "warning" | "critical";
  category: string;
  title: string;
  message: string;
  recommendation: string;
  confidence?: "low" | "medium" | "high";
  evidence?: Record<string, any>;
};

type InsightsResponse = {
  range: string;
  generatedAt: string;
  healthScore: number;
  aiEnabled: boolean;
  insights: Insight[];
  warning?: string;
};

type RangeKey = "24h" | "7d";

function errMsg(e: any): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  return e?.message ? String(e.message) : String(e);
}

function severityColor(sev: Insight["severity"]) {
  if (sev === "critical") return "#ef4444";
  if (sev === "warning") return "#f59e0b";
  return "#3b82f6";
}

function healthLabel(score: number) {
  if (score >= 80) return { label: "Healthy", color: "#22c55e" };
  if (score >= 50) return { label: "Needs attention", color: "#f59e0b" };
  return { label: "Unstable", color: "#ef4444" };
}

export default function AiInsightsSection({ botId }: { botId: string }) {
  const [range, setRange] = useState<RangeKey>("24h");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InsightsResponse | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<InsightsResponse>(`/bots/${botId}/ai/insights?range=${range}`);
      setData(res);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, botId]);

  const lastUpdated = useMemo(() => {
    if (!data?.generatedAt) return "—";
    const d = new Date(data.generatedAt);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString();
  }, [data?.generatedAt]);

  const insights = data?.insights ?? [];
  const hasData = Boolean(data);
  const score = hasData && Number.isFinite(data?.healthScore ?? NaN) ? (data?.healthScore ?? 0) : null;
  const health = score !== null ? healthLabel(score) : null;

  return (
    <section className="card" style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ marginTop: 0, marginBottom: 0 }}>AI Insights (Read‑Only)</h3>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span
            className="badge"
            style={{
              borderColor: health ? health.color : "#64748b",
              color: health ? health.color : "#94a3b8"
            }}
          >
            {health ? `Health ${score} · ${health.label}` : "Health —"}
          </span>
          {data?.aiEnabled ? (
            <span className="badge" style={{ borderColor: "#22c55e", color: "#22c55e" }}>
              AI enabled
            </span>
          ) : (
            <span className="badge" style={{ borderColor: "#9ca3af", color: "#9ca3af" }}>
              AI disabled
            </span>
          )}
          {(["24h", "7d"] as RangeKey[]).map((r) => (
            <button
              key={r}
              className={`btn ${range === r ? "btnPrimary" : ""}`}
              onClick={() => setRange(r)}
              disabled={loading}
            >
              {r}
            </button>
          ))}
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Last update: {lastUpdated}</div>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "#ff6b6b" }}>{error}</div>
      ) : null}

      {!error && data?.warning ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "#f59e0b" }}>
          AI unavailable. Showing rule‑based insights only.
        </div>
      ) : null}

      {hasData && !data?.aiEnabled ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
          AI is disabled. Showing rule‑based insights only.
        </div>
      ) : null}

      {!loading && insights.length === 0 ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
          No insights detected. Bot behavior looks healthy.
        </div>
      ) : null}

      {insights.length > 0 ? (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {insights.map((ins, idx) => (
            <div key={`${ins.title}-${idx}`} className="card" style={{ padding: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span
                  className="badge"
                  style={{ borderColor: severityColor(ins.severity), color: severityColor(ins.severity) }}
                >
                  {ins.severity}
                </span>
                {ins.confidence ? (
                  <span className="badge" style={{ borderColor: "#64748b", color: "#94a3b8" }}>
                    {ins.confidence}
                  </span>
                ) : null}
                <div style={{ fontWeight: 700 }}>{ins.title}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{ins.message}</div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <span style={{ color: "var(--muted)" }}>Recommendation: </span>
                <span style={{ fontWeight: 600 }}>{ins.recommendation}</span>
              </div>
              {ins.evidence ? (
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
                  Evidence: {JSON.stringify(ins.evidence)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
        AI provides suggestions only. Changes must be applied manually.
      </div>
    </section>
  );
}
