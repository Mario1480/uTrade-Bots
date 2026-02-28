"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

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
  payloadBudget?: {
    totalBudgetCalls: number;
    totalCacheChecks: number;
    cacheHits: number;
    cacheHitRatePct: number;
    trimCountLastHour: number;
    trimAlertThresholdPerHour: number;
    trimAlert: boolean;
    highWaterConsecutive: number;
    highWaterConsecutiveThreshold: number;
    highWaterAlert: boolean;
    lastHighWaterAt: string | null;
    lastUpdatedAt: string | null;
    lastMetrics: {
      bytes: number;
      estimatedTokens: number;
      trimFlags: string[];
      maxPayloadBytes: number;
      maxHistoryBytes: number;
      toolCallsUsed: number;
      historyContextHash: string | null;
      overBudget: boolean;
    } | null;
  };
  qualityGate?: {
    gateAllowCount: number;
    gateBlockCount: number;
    aiCallsSaved: number;
    priorities: { low: number; normal: number; high: number };
    reasons: Array<{ code: string; count: number }>;
  };
};

type AiTraceLogItem = {
  id: string;
  createdAt: string | null;
  userId: string | null;
  userEmail: string | null;
  retryUsed: boolean;
  retryCount: number;
  totalTokens: number | null;
  analysisMode: "market_analysis" | "trading_explainer";
  neutralEnforced: boolean;
  explanationLength: number | null;
  explanationSentenceCount: number | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  attemptedModels: string[];
  fallbackReason: string | null;
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

type AiTraceLogUserOption = {
  id: string;
  email: string | null;
};

type AiTraceLogsResponse = {
  enabled: boolean;
  source: "db" | "default";
  total: number;
  limit: number;
  selectedUserId: string | "__none__" | null;
  users: AiTraceLogUserOption[];
  hasUnassigned: boolean;
  items: AiTraceLogItem[];
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function fmtBytes(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return "-";
  const bytes = Number(value);
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.trunc(bytes)} B`;
}

export default function AdminAiTracePage() {
  const t = useTranslations("admin.aiTrace");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
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
  const [logUsers, setLogUsers] = useState<AiTraceLogUserOption[]>([]);
  const [hasUnassignedLogs, setHasUnassignedLogs] = useState(false);
  const [logUserFilter, setLogUserFilter] = useState("all");
  const [logLimit, setLogLimit] = useState("100");
  const [olderThanDays, setOlderThanDays] = useState("30");

  async function loadLogs(limitOverride?: number, userFilterOverride?: string) {
    setLoadingLogs(true);
    try {
      const limit = Number.isFinite(limitOverride) && limitOverride ? limitOverride : Number(logLimit);
      const selectedFilter =
        typeof userFilterOverride === "string" ? userFilterOverride : logUserFilter;
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (selectedFilter === "__none__") {
        params.set("userId", "__none__");
      } else if (selectedFilter !== "all") {
        params.set("userId", selectedFilter);
      }
      const payload = await apiGet<AiTraceLogsResponse>(`/admin/ai-trace/logs?${params.toString()}`);
      setLogs(Array.isArray(payload.items) ? payload.items : []);
      setTotalLogs(Number.isFinite(Number(payload.total)) ? Number(payload.total) : 0);
      setLogUsers(Array.isArray(payload.users) ? payload.users : []);
      setHasUnassignedLogs(Boolean(payload.hasUnassigned));
      if (payload.selectedUserId === "__none__") {
        setLogUserFilter("__none__");
      } else if (typeof payload.selectedUserId === "string" && payload.selectedUserId.trim()) {
        setLogUserFilter(payload.selectedUserId);
      } else {
        setLogUserFilter("all");
      }
    } catch (e) {
      setError(errMsg(e));
      setLogs([]);
      setTotalLogs(0);
      setLogUsers([]);
      setHasUnassignedLogs(false);
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
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsSuperadmin(false);
        setError(t("messages.accessRequired"));
        return;
      }
      setIsSuperadmin(true);

      const settingsRes = await apiGet<AiTraceSettingsResponse>("/admin/settings/ai-trace");
      setSettings(settingsRes);
      setEnabled(Boolean(settingsRes.enabled));
      setMaxSystemMessageChars(String(settingsRes.maxSystemMessageChars));
      setMaxUserPayloadChars(String(settingsRes.maxUserPayloadChars));
      setMaxRawResponseChars(String(settingsRes.maxRawResponseChars));
      await loadLogs(Number(logLimit), logUserFilter);
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
      setNotice(t("messages.settingsSaved"));
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
      setNotice(t("messages.deletedOld", { count: res.deletedCount }));
      await loadLogs(Number(logLimit), logUserFilter);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCleanupLoading(false);
    }
  }

  async function cleanupAllLogs() {
    if (!confirm(t("messages.confirmDeleteAll"))) return;
    setCleanupLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiPost<{ deletedCount: number }>("/admin/ai-trace/logs/cleanup", {
        deleteAll: true
      });
      setNotice(t("messages.deletedAll", { count: res.deletedCount }));
      await loadLogs(Number(logLimit), logUserFilter);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCleanupLoading(false);
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href={withLocalePath("/admin", locale)} className="btn">
          ← {tCommon("backToAdmin")}
        </Link>
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
      </div>

      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="adminPageIntro">
        {t("subtitle")}
      </div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
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
              <h3 style={{ margin: 0 }}>{t("budgetTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              {t("lastUpdated")}:{" "}
              {settings?.payloadBudget?.lastUpdatedAt
                ? new Date(settings.payloadBudget.lastUpdatedAt).toLocaleString()
                : t("na")}
            </div>
            <div className="dashboardStatsGrid" style={{ marginBottom: 10 }}>
              <div className="dashboardStatCard">
                <div className="dashboardStatLabel">Last Payload</div>
                <div className="dashboardStatValue">
                  {fmtBytes(settings?.payloadBudget?.lastMetrics?.bytes)}
                </div>
              </div>
              <div className="dashboardStatCard">
                <div className="dashboardStatLabel">Last Est Tokens</div>
                <div className="dashboardStatValue">
                  {settings?.payloadBudget?.lastMetrics?.estimatedTokens ?? "-"}
                </div>
              </div>
              <div className="dashboardStatCard">
                <div className="dashboardStatLabel">Cache Hit Rate</div>
                <div className="dashboardStatValue">
                  {Number.isFinite(Number(settings?.payloadBudget?.cacheHitRatePct))
                    ? `${Number(settings?.payloadBudget?.cacheHitRatePct).toFixed(2)}%`
                    : "-"}
                </div>
              </div>
              <div className="dashboardStatCard">
                <div className="dashboardStatLabel">Trim Last Hour</div>
                <div className="dashboardStatValue">
                  {settings?.payloadBudget?.trimCountLastHour ?? "-"} /{" "}
                  {settings?.payloadBudget?.trimAlertThresholdPerHour ?? "-"}
                </div>
              </div>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 8 }}>
              {t("highWater")}: {settings?.payloadBudget?.highWaterConsecutive ?? 0} /{" "}
              {settings?.payloadBudget?.highWaterConsecutiveThreshold ?? 0}
              {settings?.payloadBudget?.highWaterAlert ? ` · ${t("alert")}` : ""}
              {settings?.payloadBudget?.trimAlert ? ` · ${t("trimAlert")}` : ""}
              {settings?.payloadBudget?.lastMetrics?.overBudget ? ` · ${t("overBudget")}` : ""}
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              Max payload: {fmtBytes(settings?.payloadBudget?.lastMetrics?.maxPayloadBytes)} · Max history:{" "}
              {fmtBytes(settings?.payloadBudget?.lastMetrics?.maxHistoryBytes)} · Last tool calls used:{" "}
              {settings?.payloadBudget?.lastMetrics?.toolCallsUsed ?? "-"}
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              Quality gate: allow {settings?.qualityGate?.gateAllowCount ?? 0} · block{" "}
              {settings?.qualityGate?.gateBlockCount ?? 0} · saved{" "}
              {settings?.qualityGate?.aiCallsSaved ?? 0}
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              Priorities: low {settings?.qualityGate?.priorities?.low ?? 0}, normal{" "}
              {settings?.qualityGate?.priorities?.normal ?? 0}, high{" "}
              {settings?.qualityGate?.priorities?.high ?? 0}
            </div>
            {Array.isArray(settings?.qualityGate?.reasons) && settings.qualityGate.reasons.length > 0 ? (
              <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                Top gate reasons:{" "}
                {settings.qualityGate.reasons
                  .slice(0, 6)
                  .map((row) => `${row.code} (${row.count})`)
                  .join(", ")}
              </div>
            ) : null}
            {Array.isArray(settings?.payloadBudget?.lastMetrics?.trimFlags) &&
            settings?.payloadBudget?.lastMetrics?.trimFlags.length > 0 ? (
              <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                Last trim flags: {settings?.payloadBudget?.lastMetrics?.trimFlags.join(", ")}
              </div>
            ) : null}
          </section>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("traceSettingsTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              {t("source")}: {settings?.source ?? "default"} · {t("lastUpdated")}:{" "}
              {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : t("never")}
            </div>

            <div className="indicatorScopeGrid">
              <label className="inlineCheck">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                {t("enableTrace")}
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
                {saving ? t("saving") : t("saveSettings")}
              </button>
              <button className="btn" type="button" onClick={() => void loadAll()}>
                {t("reload")}
              </button>
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("traceLogs")} ({totalLogs})</h3>
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

              <label className="settingsField" style={{ minWidth: 280 }}>
                <span className="settingsFieldLabel">{t("filterByUser")}</span>
                <select
                  className="input"
                  value={logUserFilter}
                  onChange={(e) => {
                    const nextFilter = e.target.value;
                    setLogUserFilter(nextFilter);
                    void loadLogs(Number(logLimit), nextFilter);
                  }}
                >
                  <option value="all">{t("allUsers")}</option>
                  {hasUnassignedLogs ? (
                    <option value="__none__">{t("unassignedUser")}</option>
                  ) : null}
                  {logUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email ? `${user.email} (${user.id})` : user.id}
                    </option>
                  ))}
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
              <button className="btn" type="button" disabled={loadingLogs} onClick={() => void loadLogs(Number(logLimit), logUserFilter)}>
                {loadingLogs ? t("loading") : t("refreshLogs")}
              </button>
              <button className="btn" type="button" disabled={cleanupLoading} onClick={() => void cleanupOldLogs()}>
                {t("deleteOldLogs")}
              </button>
              <button className="btn" type="button" disabled={cleanupLoading} onClick={() => void cleanupAllLogs()}>
                {t("deleteAllLogs")}
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="settingsMutedText">{t("noLogs")}</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {logs.map((row) => (
                  <details key={row.id} className="card" style={{ margin: 0 }}>
                    <summary style={{ cursor: "pointer", fontSize: 13 }}>
                      {(row.createdAt ? new Date(row.createdAt).toLocaleString() : "-")}
                      {" · "}
                      {row.symbol ?? "-"} {row.timeframe ?? "-"} {row.marketType ?? "-"}
                      {" · "}
                      {t("user")}: {row.userEmail ?? row.userId ?? t("unassignedUser")}
                      {" · "}
                      {row.success ? "success" : "error"}
                      {row.fallbackUsed ? " · fallback" : ""}
                      {row.retryUsed ? ` · retry x${row.retryCount}` : ""}
                      {row.cacheHit ? " · cache-hit" : ""}
                      {row.rateLimited ? " · rate-limited" : ""}
                      {row.analysisMode === "market_analysis" ? " · market-analysis" : ""}
                      {row.neutralEnforced ? " · neutral-enforced" : ""}
                      {row.explanationLength !== null ? ` · chars: ${row.explanationLength}` : ""}
                      {row.explanationSentenceCount !== null ? ` · sentences: ${row.explanationSentenceCount}` : ""}
                      {row.latencyMs !== null ? ` · ${row.latencyMs}ms` : ""}
                      {row.totalTokens !== null ? ` · tokens: ${row.totalTokens}` : ""}
                      {row.requestedModel && row.resolvedModel && row.requestedModel !== row.resolvedModel
                        ? ` · ${row.requestedModel} -> ${row.resolvedModel}`
                        : ""}
                    </summary>
                    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                      <div className="settingsMutedText">
                        {t("user")}:{" "}
                        <strong>{row.userEmail ?? row.userId ?? t("unassignedUser")}</strong>
                      </div>
                      <div className="settingsMutedText">
                        {t("prompt")}: <strong>{row.promptTemplateName ?? t("systemDefault")}</strong>
                        {row.promptTemplateId ? ` (${row.promptTemplateId})` : ""}
                        {row.model ? ` · model: ${row.model}` : ""}
                        {row.requestedModel ? ` · requested: ${row.requestedModel}` : ""}
                        {row.resolvedModel ? ` · resolved: ${row.resolvedModel}` : ""}
                        {row.attemptedModels.length > 0 ? ` · attempted: ${row.attemptedModels.join(", ")}` : ""}
                      </div>

                      {row.error ? (
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>{row.error}</pre>
                      ) : null}
                      {row.fallbackReason ? (
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
                          fallbackReason: {row.fallbackReason}
                        </pre>
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
