"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";

type AiTraceSettingsResponse = {
  enabled: boolean;
  maxSystemMessageChars: number;
  maxUserPayloadChars: number;
  maxRawResponseChars: number;
  updatedAt: string | null;
  source: "db" | "default";
  defaults: {
    enabled: boolean;
    maxSystemMessageChars: number;
    maxUserPayloadChars: number;
    maxRawResponseChars: number;
  };
};

type AiTraceLogItem = {
  id: string;
  createdAt: string | null;
  retryUsed: boolean;
  retryCount: number;
  scope: string;
  provider: string | null;
  model: string | null;
  symbol: string | null;
  marketType: string | null;
  timeframe: string | null;
  promptTemplateId: string | null;
  promptTemplateName: string | null;
  systemMessage: string | null;
  userPayload: unknown;
  rawResponse: string | null;
  parsedResponse: unknown;
  success: boolean;
  error: string | null;
  fallbackUsed: boolean;
  cacheHit: boolean;
  rateLimited: boolean;
  latencyMs: number | null;
};

type AiTraceLogsResponse = {
  enabled: boolean;
  source: "db" | "default";
  total: number;
  limit: number;
  items: AiTraceLogItem[];
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminAiTracePage() {
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [settings, setSettings] = useState<AiTraceSettingsResponse | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [maxSystemMessageChars, setMaxSystemMessageChars] = useState("12000");
  const [maxUserPayloadChars, setMaxUserPayloadChars] = useState("60000");
  const [maxRawResponseChars, setMaxRawResponseChars] = useState("12000");

  const [logs, setLogs] = useState<AiTraceLogItem[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [logLimit, setLogLimit] = useState("100");
  const [olderThanDays, setOlderThanDays] = useState("30");

  async function loadLogs(limitOverride?: number) {
    setLoadingLogs(true);
    try {
      const limit = Number.isFinite(limitOverride) && limitOverride ? limitOverride : Number(logLimit);
      const payload = await apiGet<AiTraceLogsResponse>(`/admin/ai-trace/logs?limit=${encodeURIComponent(String(limit))}`);
      setLogs(Array.isArray(payload.items) ? payload.items : []);
      setTotalLogs(Number.isFinite(Number(payload.total)) ? Number(payload.total) : 0);
    } catch (e) {
      setError(errMsg(e));
      setLogs([]);
      setTotalLogs(0);
    } finally {
      setLoadingLogs(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!me?.isSuperadmin) {
        setIsSuperadmin(false);
        setError("Superadmin access required.");
        return;
      }
      setIsSuperadmin(true);

      const settingsRes = await apiGet<AiTraceSettingsResponse>("/admin/settings/ai-trace");
      setSettings(settingsRes);
      setEnabled(Boolean(settingsRes.enabled));
      setMaxSystemMessageChars(String(settingsRes.maxSystemMessageChars));
      setMaxUserPayloadChars(String(settingsRes.maxUserPayloadChars));
      setMaxRawResponseChars(String(settingsRes.maxRawResponseChars));
      await loadLogs(Number(logLimit));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSettings() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        enabled,
        maxSystemMessageChars: Number(maxSystemMessageChars),
        maxUserPayloadChars: Number(maxUserPayloadChars),
        maxRawResponseChars: Number(maxRawResponseChars)
      };
      const saved = await apiPut<AiTraceSettingsResponse>("/admin/settings/ai-trace", payload);
      setSettings(saved);
      setEnabled(Boolean(saved.enabled));
      setMaxSystemMessageChars(String(saved.maxSystemMessageChars));
      setMaxUserPayloadChars(String(saved.maxUserPayloadChars));
      setMaxRawResponseChars(String(saved.maxRawResponseChars));
      setNotice("AI trace settings saved.");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function cleanupOldLogs() {
    setCleanupLoading(true);
    setError(null);
    setNotice(null);
    try {
      const days = Number(olderThanDays);
      const res = await apiPost<{ deletedCount: number }>("/admin/ai-trace/logs/cleanup", {
        deleteAll: false,
        olderThanDays: days
      });
      setNotice(`Deleted ${res.deletedCount} old AI trace logs.`);
      await loadLogs(Number(logLimit));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCleanupLoading(false);
    }
  }

  async function cleanupAllLogs() {
    if (!confirm("Delete all AI trace logs?")) return;
    setCleanupLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiPost<{ deletedCount: number }>("/admin/ai-trace/logs/cleanup", {
        deleteAll: true
      });
      setNotice(`Deleted ${res.deletedCount} AI trace logs.`);
      await loadLogs(Number(logLimit));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCleanupLoading(false);
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href="/admin" className="btn">
          ← Back to admin
        </Link>
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
      </div>

      <h2 style={{ marginTop: 0 }}>Admin · AI Trace Logs</h2>
      <div className="adminPageIntro">
        Track OpenAI request payloads and responses for debugging. Disable when not needed.
      </div>

      {loading ? <div className="settingsMutedText">Loading...</div> : null}
      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">{error}</div>
      ) : null}
      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div>
      ) : null}

      {isSuperadmin ? (
        <>
          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>Trace Settings</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              Source: {settings?.source ?? "default"} · Last updated:{" "}
              {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : "never"}
            </div>

            <div className="indicatorScopeGrid">
              <label className="inlineCheck">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Enable AI trace logging
              </label>
            </div>

            <div className="indicatorScopeGrid" style={{ marginTop: 10 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Max systemMessage chars</span>
                <input
                  className="input"
                  type="number"
                  min={500}
                  max={50000}
                  value={maxSystemMessageChars}
                  onChange={(e) => setMaxSystemMessageChars(e.target.value)}
                />
              </label>

              <label className="settingsField">
                <span className="settingsFieldLabel">Max userPayload chars</span>
                <input
                  className="input"
                  type="number"
                  min={1000}
                  max={250000}
                  value={maxUserPayloadChars}
                  onChange={(e) => setMaxUserPayloadChars(e.target.value)}
                />
              </label>

              <label className="settingsField">
                <span className="settingsFieldLabel">Max rawResponse chars</span>
                <input
                  className="input"
                  type="number"
                  min={500}
                  max={50000}
                  value={maxRawResponseChars}
                  onChange={(e) => setMaxRawResponseChars(e.target.value)}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button className="btn btnPrimary" type="button" disabled={saving} onClick={() => void saveSettings()}>
                {saving ? "Saving..." : "Save settings"}
              </button>
              <button className="btn" type="button" onClick={() => void loadAll()}>
                Reload
              </button>
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>Trace Logs ({totalLogs})</h3>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <label className="settingsField" style={{ minWidth: 160 }}>
                <span className="settingsFieldLabel">Limit</span>
                <select className="input" value={logLimit} onChange={(e) => setLogLimit(e.target.value)}>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                  <option value="500">500</option>
                </select>
              </label>

              <label className="settingsField" style={{ minWidth: 200 }}>
                <span className="settingsFieldLabel">Delete logs older than (days)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={3650}
                  value={olderThanDays}
                  onChange={(e) => setOlderThanDays(e.target.value)}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <button className="btn" type="button" disabled={loadingLogs} onClick={() => void loadLogs(Number(logLimit))}>
                {loadingLogs ? "Loading..." : "Refresh logs"}
              </button>
              <button className="btn" type="button" disabled={cleanupLoading} onClick={() => void cleanupOldLogs()}>
                Delete old logs
              </button>
              <button className="btn" type="button" disabled={cleanupLoading} onClick={() => void cleanupAllLogs()}>
                Delete all logs
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="settingsMutedText">No trace logs available.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {logs.map((row) => (
                  <details key={row.id} className="card" style={{ margin: 0 }}>
                    <summary style={{ cursor: "pointer", fontSize: 13 }}>
                      {(row.createdAt ? new Date(row.createdAt).toLocaleString() : "-")}
                      {" · "}
                      {row.symbol ?? "-"} {row.timeframe ?? "-"} {row.marketType ?? "-"}
                      {" · "}
                      {row.success ? "success" : "error"}
                      {row.fallbackUsed ? " · fallback" : ""}
                      {row.retryUsed ? ` · retry x${row.retryCount}` : ""}
                      {row.cacheHit ? " · cache-hit" : ""}
                      {row.rateLimited ? " · rate-limited" : ""}
                      {row.latencyMs !== null ? ` · ${row.latencyMs}ms` : ""}
                    </summary>
                    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                      <div className="settingsMutedText">
                        Prompt: <strong>{row.promptTemplateName ?? "System default"}</strong>
                        {row.promptTemplateId ? ` (${row.promptTemplateId})` : ""}
                        {row.model ? ` · model: ${row.model}` : ""}
                      </div>

                      {row.error ? (
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>{row.error}</pre>
                      ) : null}

                      <details>
                        <summary style={{ cursor: "pointer", fontSize: 12 }}>systemMessage</summary>
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", overflowX: "auto" }}>
                          {row.systemMessage ?? ""}
                        </pre>
                      </details>

                      <details>
                        <summary style={{ cursor: "pointer", fontSize: 12 }}>userPayload</summary>
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", overflowX: "auto" }}>
                          {JSON.stringify(row.userPayload ?? null, null, 2)}
                        </pre>
                      </details>

                      <details>
                        <summary style={{ cursor: "pointer", fontSize: 12 }}>rawResponse</summary>
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", overflowX: "auto" }}>
                          {row.rawResponse ?? ""}
                        </pre>
                      </details>

                      <details>
                        <summary style={{ cursor: "pointer", fontSize: 12 }}>parsedResponse</summary>
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", overflowX: "auto" }}>
                          {JSON.stringify(row.parsedResponse ?? null, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
