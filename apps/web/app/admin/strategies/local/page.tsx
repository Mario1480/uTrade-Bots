"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../../lib/api";

type RegistryItem = {
  type: string;
  defaultConfig: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
};

type LocalStrategyItem = {
  id: string;
  strategyType: string;
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [items, setItems] = useState<LocalStrategyItem[]>([]);
  const [registry, setRegistry] = useState<RegistryItem[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [strategyType, setStrategyType] = useState("");
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
    () => registry.find((entry) => entry.type === strategyType) ?? null,
    [registry, strategyType]
  );

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      const hasAccess = Boolean(me?.isSuperadmin || me?.hasAdminBackendAccess);
      setIsAdmin(hasAccess);
      if (!hasAccess) {
        setError("Admin backend access required.");
        return;
      }

      const response = await apiGet<LocalStrategiesResponse>("/admin/local-strategies");
      setItems(Array.isArray(response.items) ? response.items : []);
      setRegistry(Array.isArray(response.registry) ? response.registry : []);

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
    setStrategyType(first?.type ?? "");
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
    setStrategyType(item.strategyType);
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
        name: name.trim(),
        description: description.trim() || null,
        version: version.trim(),
        inputSchema: parsedInputSchema.value,
        configJson: parsedConfig.value,
        isEnabled
      };

      if (editingId) {
        await apiPut<{ item: LocalStrategyItem }>(`/admin/local-strategies/${encodeURIComponent(editingId)}`, payload);
        setNotice("Local strategy updated.");
      } else {
        await apiPost<{ item: LocalStrategyItem }>("/admin/local-strategies", payload);
        setNotice("Local strategy created.");
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
    if (!confirm("Delete this local strategy?")) return;
    setError(null);
    setNotice(null);
    try {
      await apiDelete<{ ok: boolean }>(`/admin/local-strategies/${encodeURIComponent(id)}`);
      if (editingId === id) resetForm();
      setNotice("Local strategy deleted.");
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
      if (!id) throw new Error("Please save the strategy first before running preview.");
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
      setNotice("Preview run completed.");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRunning(false);
    }
  }

  function applyRegistryDefaults(type: string) {
    setStrategyType(type);
    const match = registry.find((item) => item.type === type);
    if (match) {
      setConfigJsonText(pretty(match.defaultConfig ?? {}));
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href="/admin" className="btn">← Back to admin</Link>
        <Link href="/admin/strategies/builder" className="btn">Composite Builder</Link>
        <Link href="/admin/strategies/ai" className="btn">AI Strategies</Link>
      </div>

      <div className="adminPageIntro">
        <h2 style={{ marginTop: 0 }}>Local Strategies</h2>
        <p className="settingsMutedText">
          Create and manage deterministic local strategies used by composite pipelines.
        </p>
      </div>

      {loading ? <div className="settingsMutedText">Loading...</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {notice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div> : null}

      {isAdmin ? (
        <>
          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{editingId ? "Edit Local Strategy" : "Create Local Strategy"}</h3>
            </div>

            <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Strategy type</span>
                <select
                  className="input"
                  value={strategyType}
                  onChange={(e) => applyRegistryDefaults(e.target.value)}
                  disabled={Boolean(editingId)}
                >
                  <option value="">Select type...</option>
                  {registry.map((item) => (
                    <option key={item.type} value={item.type}>{item.type}</option>
                  ))}
                </select>
              </label>

              <label className="settingsField">
                <span className="settingsFieldLabel">Version</span>
                <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} />
              </label>
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
                {saving ? "Saving..." : editingId ? "Update strategy" : "Create strategy"}
              </button>
              <button className="btn" type="button" onClick={resetForm}>Reset form</button>
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
          </section>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>Strategy List</h3>
            </div>
            {items.length === 0 ? <div className="settingsMutedText">No local strategies yet.</div> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th align="left">Name</th>
                      <th align="left">Type</th>
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
