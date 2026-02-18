"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";

type RegistryItem = {
  type: string;
  defaultConfig: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
};

type LocalStrategyItem = {
  id: string;
  strategyType: string;
  engine: "ts" | "python";
  shadowMode: boolean;
  newsRiskMode: "off" | "block";
  remoteStrategyType: string | null;
  fallbackStrategyType: string | null;
  timeoutMs: number | null;
  name: string;
  description: string | null;
  version: string;
  inputSchema: Record<string, unknown> | null;
  configJson: Record<string, unknown>;
  isEnabled: boolean;
  registry?: {
    registered: boolean;
    defaultConfig?: Record<string, unknown>;
    uiSchema?: Record<string, unknown>;
  };
  createdAt: string | null;
  updatedAt: string | null;
};

type LocalStrategiesResponse = {
  items: LocalStrategyItem[];
  registry: RegistryItem[];
  pythonRegistry?: {
    enabled: boolean;
    health: { status: string; version: string } | null;
    items: Array<{
      type: string;
      name: string;
      version: string;
      defaultConfig: Record<string, unknown>;
      uiSchema: Record<string, unknown>;
    }>;
    metrics?: {
      calls: number;
      failures: number;
      timeouts: number;
    };
  };
  templates: Array<{
    strategyType: string;
    name: string;
    description: string;
    version: string;
    inputSchema: Record<string, unknown>;
    defaultConfig: Record<string, unknown>;
    uiSchema: Record<string, unknown>;
  }>;
};

type RunResult = {
  result: {
    allow: boolean;
    score: number;
    reasonCodes: string[];
    tags: string[];
    explanation: string;
    strategyType: string;
    strategyName: string;
    configHash: string;
    snapshotHash: string;
    meta: Record<string, unknown>;
  };
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function pretty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJsonObject(label: string, raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (!raw.trim()) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, message: `${label} must be a JSON object.` };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: `${label} contains invalid JSON.` };
  }
}

function copyItems<T>(items: T[]): T[] {
  return items.map((item) => ({ ...(item as any) }));
}

export default function AdminLocalStrategiesPage() {
  const t = useTranslations("admin.localStrategies");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [items, setItems] = useState<LocalStrategyItem[]>([]);
  const [registry, setRegistry] = useState<RegistryItem[]>([]);
  const [pythonRegistry, setPythonRegistry] = useState<NonNullable<LocalStrategiesResponse["pythonRegistry"]>>({
    enabled: false,
    health: null,
    items: []
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [engine, setEngine] = useState<"ts" | "python">("ts");
  const [shadowMode, setShadowMode] = useState(false);
  const [newsRiskMode, setNewsRiskMode] = useState<"off" | "block">("off");
  const [strategyType, setStrategyType] = useState("");
  const [remoteStrategyType, setRemoteStrategyType] = useState("");
  const [fallbackStrategyType, setFallbackStrategyType] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("1200");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [isEnabled, setIsEnabled] = useState(true);
  const [inputSchemaText, setInputSchemaText] = useState("{}");
  const [configJsonText, setConfigJsonText] = useState("{}");

  const [runFeatureSnapshotText, setRunFeatureSnapshotText] = useState(
    pretty({
      tags: ["trend_up"],
      historyContext: {
        reg: { state: "trend_up", conf: 72, since: "2026-02-15T10:00:00.000Z" },
        ema: { stk: "bull" },
        vol: { z: 1.2 }
      }
    })
  );
  const [runCtxText, setRunCtxText] = useState(
    pretty({
      signal: "up",
      exchange: "bitget",
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m"
    })
  );
  const [runOutput, setRunOutput] = useState<string>("");

  const selectedRegistry = useMemo(
    () =>
      (engine === "python"
        ? pythonRegistry.items.find((entry) => entry.type === strategyType)
        : registry.find((entry) => entry.type === strategyType)) ?? null,
    [engine, pythonRegistry.items, registry, strategyType]
  );

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      const hasAccess = Boolean(me?.isSuperadmin || me?.hasAdminBackendAccess);
      setIsAdmin(hasAccess);
      if (!hasAccess) {
        setError(t("messages.accessRequired"));
        return;
      }

      const response = await apiGet<LocalStrategiesResponse>("/admin/local-strategies");
      setItems(Array.isArray(response.items) ? response.items : []);
      setRegistry(Array.isArray(response.registry) ? response.registry : []);
      setPythonRegistry(response.pythonRegistry ?? { enabled: false, health: null, items: [] });

      if (!editingId && Array.isArray(response.registry) && response.registry.length > 0) {
        const first = response.registry[0];
        setStrategyType(first.type);
        setConfigJsonText(pretty(first.defaultConfig));
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  function resetForm() {
    const first = registry[0];
    setEditingId(null);
    setEngine("ts");
    setShadowMode(false);
    setNewsRiskMode("off");
    setStrategyType(first?.type ?? "");
    setRemoteStrategyType("");
    setFallbackStrategyType(first?.type ?? "");
    setTimeoutMs("1200");
    setName("");
    setDescription("");
    setVersion("1.0.0");
    setIsEnabled(true);
    setInputSchemaText("{}");
    setConfigJsonText(pretty(first?.defaultConfig ?? {}));
    setNotice(null);
    setError(null);
  }

  function applyItem(item: LocalStrategyItem) {
    setEditingId(item.id);
    setEngine(item.engine === "python" ? "python" : "ts");
    setShadowMode(item.shadowMode === true);
    setNewsRiskMode(item.newsRiskMode === "block" ? "block" : "off");
    setStrategyType(item.strategyType);
    setRemoteStrategyType(item.remoteStrategyType ?? item.strategyType);
    setFallbackStrategyType(item.fallbackStrategyType ?? item.strategyType);
    setTimeoutMs(item.timeoutMs !== null && Number.isFinite(item.timeoutMs) ? String(item.timeoutMs) : "1200");
    setName(item.name);
    setDescription(item.description ?? "");
    setVersion(item.version);
    setIsEnabled(item.isEnabled);
    setInputSchemaText(pretty(item.inputSchema ?? {}));
    setConfigJsonText(pretty(item.configJson ?? {}));
    setNotice(null);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (!strategyType.trim()) throw new Error("Please select a strategy type.");
      if (!name.trim()) throw new Error("Name is required.");
      if (!version.trim()) throw new Error("Version is required.");

      const parsedInputSchema = parseJsonObject("Input schema", inputSchemaText);
      if (!parsedInputSchema.ok) {
        throw new Error("message" in parsedInputSchema ? parsedInputSchema.message : "Input schema invalid.");
      }
      const parsedConfig = parseJsonObject("Config", configJsonText);
      if (!parsedConfig.ok) {
        throw new Error("message" in parsedConfig ? parsedConfig.message : "Config invalid.");
      }

      const payload = {
        strategyType: strategyType.trim(),
        engine,
        shadowMode: engine === "python" ? shadowMode : false,
        newsRiskMode,
        remoteStrategyType: engine === "python" ? (remoteStrategyType.trim() || strategyType.trim()) : null,
        fallbackStrategyType: engine === "python" ? (fallbackStrategyType.trim() || strategyType.trim()) : null,
        timeoutMs:
          engine === "python"
            ? (() => {
              const parsedTimeout = Number(timeoutMs);
              if (!Number.isFinite(parsedTimeout)) return 1200;
              return Math.max(200, Math.min(10000, Math.trunc(parsedTimeout)));
            })()
            : null,
        name: name.trim(),
        description: description.trim() || null,
        version: version.trim(),
        inputSchema: parsedInputSchema.value,
        configJson: parsedConfig.value,
        isEnabled
      };

      if (editingId) {
        await apiPut<{ item: LocalStrategyItem }>(`/admin/local-strategies/${encodeURIComponent(editingId)}`, payload);
        setNotice(t("messages.updated"));
      } else {
        await apiPost<{ item: LocalStrategyItem }>("/admin/local-strategies", payload);
        setNotice(t("messages.created"));
      }

      await loadAll();
      resetForm();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id: string) {
    if (!confirm(t("messages.confirmDelete"))) return;
    setError(null);
    setNotice(null);
    try {
      await apiDelete<{ ok: boolean }>(`/admin/local-strategies/${encodeURIComponent(id)}`);
      if (editingId === id) resetForm();
      setNotice(t("messages.deleted"));
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function runPreview() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const id = editingId;
      if (!id) throw new Error(t("messages.saveBeforePreview"));
      const parsedFeature = parseJsonObject("Feature snapshot", runFeatureSnapshotText);
      if (!parsedFeature.ok) {
        throw new Error("message" in parsedFeature ? parsedFeature.message : "Feature snapshot invalid.");
      }
      const parsedCtx = parseJsonObject("Context", runCtxText);
      if (!parsedCtx.ok) {
        throw new Error("message" in parsedCtx ? parsedCtx.message : "Context invalid.");
      }

      const res = await apiPost<RunResult>(`/admin/local-strategies/${encodeURIComponent(id)}/run`, {
        featureSnapshot: parsedFeature.value,
        ctx: parsedCtx.value
      });

      setRunOutput(pretty(res.result));
      setNotice(t("messages.previewDone"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRunning(false);
    }
  }

  function applyRegistryDefaults(type: string) {
    setStrategyType(type);
    const match =
      engine === "python"
        ? pythonRegistry.items.find((item) => item.type === type) ?? registry.find((item) => item.type === type)
        : registry.find((item) => item.type === type);
    if (match) {
      setConfigJsonText(pretty(match.defaultConfig ?? {}));
    }
    if (engine === "python") {
      setRemoteStrategyType(type);
      setFallbackStrategyType(type);
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href={withLocalePath("/admin", locale)} className="btn">← {tCommon("backToAdmin")}</Link>
        <Link href={withLocalePath("/admin/strategies/builder", locale)} className="btn">{t("compositeBuilder")}</Link>
        <Link href={withLocalePath("/admin/strategies/ai", locale)} className="btn">{t("aiStrategies")}</Link>
      </div>

      <div className="adminPageIntro">
        <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
        <p className="settingsMutedText">
          {t("subtitle")}
        </p>
      </div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {notice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div> : null}

      {isAdmin ? (
        <>
          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{editingId ? t("editTitle") : t("createTitle")}</h3>
            </div>

            <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Engine</span>
                <select
                  className="input"
                  value={engine}
                  onChange={(e) => setEngine(e.target.value === "python" ? "python" : "ts")}
                >
                  <option value="ts">TS (local registry)</option>
                  <option value="python">Python sidecar</option>
                </select>
              </label>

              <label className="settingsField">
                <span className="settingsFieldLabel">Strategy type</span>
                <select
                  className="input"
                  value={strategyType}
                  onChange={(e) => applyRegistryDefaults(e.target.value)}
                  disabled={Boolean(editingId) && engine === "ts"}
                >
                  <option value="">Select type...</option>
                  {(engine === "python" ? pythonRegistry.items : registry).map((item) => (
                    <option key={item.type} value={item.type}>{item.type}</option>
                  ))}
                  {strategyType
                    && !(engine === "python" ? pythonRegistry.items : registry).some((item) => item.type === strategyType)
                    ? <option value={strategyType}>{strategyType}</option>
                    : null}
                </select>
              </label>
            </div>

            {engine === "python" ? (
              <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
                <label className="settingsField">
                  <span className="settingsFieldLabel">Remote strategy type</span>
                  <input
                    className="input"
                    value={remoteStrategyType}
                    onChange={(e) => setRemoteStrategyType(e.target.value)}
                    placeholder={strategyType || "regime_gate"}
                  />
                </label>

                <label className="settingsField">
                  <span className="settingsFieldLabel">Fallback strategy type (TS)</span>
                  <input
                    className="input"
                    value={fallbackStrategyType}
                    onChange={(e) => setFallbackStrategyType(e.target.value)}
                    placeholder={strategyType || "regime_gate"}
                  />
                </label>
              </div>
            ) : null}

            {engine === "python" ? (
              <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
                <label className="settingsField" style={{ justifyContent: "end" }}>
                  <span className="settingsFieldLabel">Shadow mode (log only)</span>
                  <input
                    type="checkbox"
                    checked={shadowMode}
                    onChange={(e) => setShadowMode(e.target.checked)}
                  />
                </label>
                <div />
              </div>
            ) : null}

            <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
              {engine === "python" ? (
                <label className="settingsField">
                  <span className="settingsFieldLabel">Python timeout (ms)</span>
                  <input
                    className="input"
                    type="number"
                    min={200}
                    max={10000}
                    step={100}
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(e.target.value)}
                  />
                </label>
              ) : <div />}

              <label className="settingsField">
                <span className="settingsFieldLabel">Version</span>
                <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} />
              </label>
            </div>

            <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("newsRiskMode")}</span>
                <select
                  className="input"
                  value={newsRiskMode}
                  onChange={(e) => setNewsRiskMode(e.target.value === "block" ? "block" : "off")}
                >
                  <option value="off">{t("newsRiskModeOff")}</option>
                  <option value="block">{t("newsRiskModeBlock")}</option>
                </select>
              </label>
              <div />
            </div>

            <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Regime Gate BTC" />
              </label>

              <label className="settingsField" style={{ justifyContent: "end" }}>
                <span className="settingsFieldLabel">Enabled</span>
                <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} />
              </label>
            </div>

            <label className="settingsField" style={{ marginBottom: 10 }}>
              <span className="settingsFieldLabel">Description</span>
              <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>

            <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Input schema JSON</span>
                <textarea className="input" rows={8} value={inputSchemaText} onChange={(e) => setInputSchemaText(e.target.value)} />
              </label>

              <label className="settingsField">
                <span className="settingsFieldLabel">Config JSON</span>
                <textarea className="input" rows={8} value={configJsonText} onChange={(e) => setConfigJsonText(e.target.value)} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btnPrimary" type="button" onClick={() => void save()} disabled={saving}>
                {saving ? t("saving") : editingId ? t("updateStrategy") : t("createStrategy")}
              </button>
              <button className="btn" type="button" onClick={resetForm}>{t("resetForm")}</button>
              {selectedRegistry ? (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setConfigJsonText(pretty(selectedRegistry.defaultConfig ?? {}));
                    setInputSchemaText(pretty((selectedRegistry.uiSchema as any)?.fields ?? {}));
                  }}
                >
                  Apply registry defaults
                </button>
              ) : null}
            </div>
            {engine === "python" ? (
              <p className="settingsMutedText" style={{ marginTop: 10, marginBottom: 0 }}>
                Python sidecar: {pythonRegistry.enabled ? "enabled" : "disabled"}
                {" · "}
                health: {pythonRegistry.health?.status ?? "unknown"}
                {" · "}
                version: {pythonRegistry.health?.version ?? "-"}
              </p>
            ) : null}
          </section>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("listTitle")}</h3>
            </div>
            {items.length === 0 ? <div className="settingsMutedText">{t("noItems")}</div> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th align="left">Name</th>
                      <th align="left">Type</th>
                      <th align="left">Engine</th>
                      <th align="left">Shadow</th>
                      <th align="left">{t("newsRiskMode")}</th>
                      <th align="left">Version</th>
                      <th align="left">Status</th>
                      <th align="left">Updated</th>
                      <th align="left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {copyItems(items).map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td><code>{item.strategyType}</code></td>
                        <td><code>{item.engine}</code></td>
                        <td>{item.shadowMode ? "on" : "off"}</td>
                        <td>{item.newsRiskMode === "block" ? t("newsRiskModeBlock") : t("newsRiskModeOff")}</td>
                        <td>{item.version}</td>
                        <td>{item.isEnabled ? "enabled" : "disabled"}</td>
                        <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "-"}</td>
                        <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn" type="button" onClick={() => applyItem(item)}>Edit</button>
                          <button className="btn" type="button" onClick={() => void removeItem(item.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>Preview Run</h3>
            </div>
            <p className="settingsMutedText" style={{ marginTop: 0 }}>
              Runs selected strategy (`{editingId ? editingId : "save strategy first"}`) against a custom snapshot/context.
            </p>

            <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">featureSnapshot JSON</span>
                <textarea className="input" rows={12} value={runFeatureSnapshotText} onChange={(e) => setRunFeatureSnapshotText(e.target.value)} />
              </label>

              <label className="settingsField">
                <span className="settingsFieldLabel">ctx JSON</span>
                <textarea className="input" rows={12} value={runCtxText} onChange={(e) => setRunCtxText(e.target.value)} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button className="btn btnPrimary" type="button" disabled={running || !editingId} onClick={() => void runPreview()}>
                {running ? "Running..." : "Run preview"}
              </button>
            </div>

            <label className="settingsField">
              <span className="settingsFieldLabel">Result</span>
              <textarea className="input" rows={10} readOnly value={runOutput} placeholder="Run output appears here." />
            </label>
          </section>
        </>
      ) : null}
    </div>
  );
}
