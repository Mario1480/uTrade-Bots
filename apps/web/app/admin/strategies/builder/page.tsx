"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../../lib/api";

type LocalRegistryItem = {
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
  isEnabled: boolean;
};

type LocalStrategiesResponse = {
  items: LocalStrategyItem[];
  registry: LocalRegistryItem[];
};

type AiPromptItem = {
  id: string;
  name: string;
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
  directionPreference: "long" | "short" | "either";
  confidenceTargetPct: number;
  isPublic: boolean;
};

type AiPromptsResponse = {
  prompts: AiPromptItem[];
};

type CompositeNode = {
  id: string;
  kind: "local" | "ai";
  refId: string;
  configOverrides?: Record<string, unknown>;
  position?: { x?: number; y?: number };
};

type CompositeEdge = {
  from: string;
  to: string;
  rule?: "always" | "if_signal_not_neutral" | "if_confidence_gte";
  confidenceGte?: number;
};

type CompositeItem = {
  id: string;
  name: string;
  description: string | null;
  version: string;
  nodesJson: CompositeNode[];
  edgesJson: CompositeEdge[];
  combineMode: "pipeline" | "vote";
  outputPolicy: "first_non_neutral" | "override_by_confidence" | "local_signal_ai_explain";
  isEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type CompositeListResponse = {
  items: CompositeItem[];
};

type PredictionHistoryItem = {
  id: string;
  symbol: string;
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
  marketType: "spot" | "perp";
  exchange: string;
  accountId: string | null;
  tsCreated: string;
};

type PredictionListResponse = {
  items: PredictionHistoryItem[];
};

type DryRunResponse = {
  composite: CompositeItem;
  prediction: {
    id: string;
    symbol: string;
    timeframe: string;
    marketType: string;
  };
  run: {
    signal: "up" | "down" | "neutral";
    confidence: number;
    tags: string[];
    keyDrivers: Array<{ name: string; value: unknown }>;
    explanation: string;
    aiCallsUsed: number;
    validation: {
      valid: boolean;
      errors: string[];
      warnings: string[];
      topologicalOrder: string[];
    };
    nodes: Array<{
      nodeId: string;
      kind: "local" | "ai";
      refId: string;
      executed: boolean;
      skippedReason: string | null;
      inputSignal: "up" | "down" | "neutral";
      inputConfidence: number;
      outputSignal: "up" | "down" | "neutral";
      outputConfidence: number;
      tags: string[];
      keyDrivers: Array<{ name: string; value: unknown }>;
      explanation: string;
      meta: Record<string, unknown>;
    }>;
  };
};

type BuilderStep = {
  id: string;
  kind: "local" | "ai";
  refId: string;
  label: string;
  configOverridesText: string;
  edgeRule: "always" | "if_signal_not_neutral" | "if_confidence_gte";
  confidenceGte: string;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function pretty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function asDateScore(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
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

function makeNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toUpperSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function stepsFromComposite(item: CompositeItem): BuilderStep[] {
  const nodeList = Array.isArray(item.nodesJson) ? item.nodesJson : [];
  const edgeList = Array.isArray(item.edgesJson) ? item.edgesJson : [];
  return nodeList.map((node, idx) => {
    const prev = idx > 0 ? nodeList[idx - 1] : null;
    const edge = prev
      ? edgeList.find((entry) => entry.from === prev.id && entry.to === node.id)
      : null;

    return {
      id: node.id,
      kind: node.kind,
      refId: node.refId,
      label: `${node.kind.toUpperCase()} · ${node.refId}`,
      configOverridesText: pretty(node.configOverrides ?? {}),
      edgeRule: edge?.rule ?? "always",
      confidenceGte: edge?.confidenceGte !== undefined && Number.isFinite(Number(edge.confidenceGte))
        ? String(Number(edge.confidenceGte))
        : "60"
    };
  });
}

export default function AdminStrategiesBuilderPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningPreview, setRunningPreview] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [localStrategies, setLocalStrategies] = useState<LocalStrategyItem[]>([]);
  const [localRegistry, setLocalRegistry] = useState<LocalRegistryItem[]>([]);
  const [aiPrompts, setAiPrompts] = useState<AiPromptItem[]>([]);
  const [composites, setComposites] = useState<CompositeItem[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [isEnabled, setIsEnabled] = useState(true);
  const [combineMode, setCombineMode] = useState<"pipeline" | "vote">("pipeline");
  const [outputPolicy, setOutputPolicy] = useState<"first_non_neutral" | "override_by_confidence" | "local_signal_ai_explain">("local_signal_ai_explain");
  const [steps, setSteps] = useState<BuilderStep[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const [previewExchange, setPreviewExchange] = useState("bitget");
  const [previewAccountId, setPreviewAccountId] = useState("");
  const [previewSymbol, setPreviewSymbol] = useState("BTCUSDT");
  const [previewTimeframe, setPreviewTimeframe] = useState<"5m" | "15m" | "1h" | "4h" | "1d">("15m");
  const [previewMarketType, setPreviewMarketType] = useState<"spot" | "perp">("perp");
  const [selectedPredictionId, setSelectedPredictionId] = useState("");
  const [previewOutput, setPreviewOutput] = useState<string>("");

  const selectedStep = useMemo(
    () => steps.find((step) => step.id === selectedStepId) ?? null,
    [steps, selectedStepId]
  );

  const localLookup = useMemo(() => {
    const map = new Map<string, LocalStrategyItem>();
    for (const item of localStrategies) map.set(item.id, item);
    return map;
  }, [localStrategies]);

  const aiLookup = useMemo(() => {
    const map = new Map<string, AiPromptItem>();
    for (const item of aiPrompts) map.set(item.id, item);
    return map;
  }, [aiPrompts]);

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

      const [localRes, aiRes, compositeRes] = await Promise.all([
        apiGet<LocalStrategiesResponse>("/admin/local-strategies"),
        apiGet<AiPromptsResponse>("/admin/settings/ai-prompts"),
        apiGet<CompositeListResponse>("/admin/composite-strategies")
      ]);

      setLocalStrategies(Array.isArray(localRes.items) ? localRes.items : []);
      setLocalRegistry(Array.isArray(localRes.registry) ? localRes.registry : []);
      setAiPrompts(Array.isArray(aiRes.prompts) ? aiRes.prompts : []);
      setComposites(Array.isArray(compositeRes.items) ? compositeRes.items : []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  function resetBuilder() {
    setEditingId(null);
    setName("");
    setDescription("");
    setVersion("1.0.0");
    setIsEnabled(true);
    setCombineMode("pipeline");
    setOutputPolicy("local_signal_ai_explain");
    setSteps([]);
    setSelectedStepId(null);
    setPreviewOutput("");
    setSelectedPredictionId("");
    setError(null);
    setNotice(null);
  }

  function addStep(kind: "local" | "ai", refId: string, label: string) {
    const id = makeNodeId();
    setSteps((prev) => [
      ...prev,
      {
        id,
        kind,
        refId,
        label,
        configOverridesText: "{}",
        edgeRule: "always",
        confidenceGte: "60"
      }
    ]);
    setSelectedStepId(id);
  }

  function patchStep(stepId: string, patch: Partial<BuilderStep>) {
    setSteps((prev) => prev.map((item) => (item.id === stepId ? { ...item, ...patch } : item)));
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    setSteps((prev) => {
      const index = prev.findIndex((item) => item.id === stepId);
      if (index < 0) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      return copy;
    });
  }

  function removeStep(stepId: string) {
    setSteps((prev) => prev.filter((item) => item.id !== stepId));
    if (selectedStepId === stepId) setSelectedStepId(null);
  }

  function buildPayloadFromSteps() {
    if (steps.length === 0) {
      throw new Error("Add at least one pipeline step.");
    }

    const nodesJson: CompositeNode[] = [];
    const edgesJson: CompositeEdge[] = [];

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const parsedConfig = parseJsonObject(`Step ${index + 1} config`, step.configOverridesText);
      if (!parsedConfig.ok) {
        throw new Error("message" in parsedConfig ? parsedConfig.message : `Step ${index + 1} config invalid.`);
      }

      nodesJson.push({
        id: step.id,
        kind: step.kind,
        refId: step.refId,
        configOverrides: parsedConfig.value
      });

      if (index > 0) {
        const prev = steps[index - 1];
        const edge: CompositeEdge = {
          from: prev.id,
          to: step.id,
          rule: step.edgeRule
        };
        if (step.edgeRule === "if_confidence_gte") {
          const threshold = Number(step.confidenceGte);
          if (!Number.isFinite(threshold)) {
            throw new Error(`Step ${index + 1} confidence threshold must be numeric.`);
          }
          edge.confidenceGte = Math.max(0, Math.min(100, threshold));
        }
        edgesJson.push(edge);
      }
    }

    return {
      nodesJson,
      edgesJson
    };
  }

  async function saveComposite() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (!name.trim()) throw new Error("Composite name is required.");
      if (!version.trim()) throw new Error("Version is required.");

      const graphPayload = buildPayloadFromSteps();
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        version: version.trim(),
        nodesJson: graphPayload.nodesJson,
        edgesJson: graphPayload.edgesJson,
        combineMode,
        outputPolicy,
        isEnabled
      };

      if (editingId) {
        const response = await apiPut<{ item: CompositeItem; validation: unknown }>(
          `/admin/composite-strategies/${encodeURIComponent(editingId)}`,
          payload
        );
        setNotice("Composite strategy updated.");
        setPreviewOutput(pretty(response.validation));
      } else {
        const response = await apiPost<{ item: CompositeItem; validation: unknown }>(
          "/admin/composite-strategies",
          payload
        );
        setEditingId(response.item.id);
        setNotice("Composite strategy created.");
        setPreviewOutput(pretty(response.validation));
      }

      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  function loadComposite(item: CompositeItem) {
    setEditingId(item.id);
    setName(item.name);
    setDescription(item.description ?? "");
    setVersion(item.version);
    setIsEnabled(item.isEnabled);
    setCombineMode(item.combineMode === "vote" ? "vote" : "pipeline");
    setOutputPolicy(item.outputPolicy);

    const loaded = stepsFromComposite(item);
    setSteps(loaded);
    setSelectedStepId(loaded[0]?.id ?? null);
    setPreviewOutput("");
    setSelectedPredictionId("");
    setNotice(`Loaded composite: ${item.name}`);
    setError(null);
  }

  async function removeComposite(id: string) {
    if (!confirm("Delete this composite strategy?")) return;
    setError(null);
    setNotice(null);
    try {
      await apiDelete<{ ok: boolean }>(`/admin/composite-strategies/${encodeURIComponent(id)}`);
      if (editingId === id) resetBuilder();
      setNotice("Composite strategy deleted.");
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  function resolveLocalUiSchema(step: BuilderStep | null): Record<string, unknown> | null {
    if (!step || step.kind !== "local") return null;
    const local = localLookup.get(step.refId);
    if (!local) return null;
    const reg = localRegistry.find((entry) => entry.type === local.strategyType);
    return reg?.uiSchema ?? null;
  }

  async function findLatestPredictionId(): Promise<string> {
    const response = await apiGet<PredictionListResponse>("/api/predictions?mode=history&limit=300");
    const items = Array.isArray(response.items) ? response.items : [];
    const symbol = toUpperSymbol(previewSymbol);
    const exchange = previewExchange.trim().toLowerCase();
    const account = previewAccountId.trim();

    const filtered = items
      .filter((item) => item.symbol === symbol)
      .filter((item) => item.timeframe === previewTimeframe)
      .filter((item) => item.marketType === previewMarketType)
      .filter((item) => (exchange ? item.exchange.toLowerCase() === exchange : true))
      .filter((item) => (account ? item.accountId === account : true))
      .sort((a, b) => asDateScore(b.tsCreated) - asDateScore(a.tsCreated));

    const latest = filtered[0];
    if (!latest) {
      throw new Error("No matching prediction found for selected scope.");
    }
    return latest.id;
  }

  async function runDryPreview() {
    setRunningPreview(true);
    setError(null);
    setNotice(null);
    try {
      if (!editingId) {
        throw new Error("Save composite strategy first before preview.");
      }
      const predictionId = selectedPredictionId.trim() || (await findLatestPredictionId());
      setSelectedPredictionId(predictionId);

      const response = await apiPost<DryRunResponse>(
        `/admin/composite-strategies/${encodeURIComponent(editingId)}/dry-run`,
        { predictionId }
      );

      setPreviewOutput(pretty(response));
      setNotice(`Dry-run completed using prediction ${response.prediction.id}.`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRunningPreview(false);
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href="/admin" className="btn">← Back to admin</Link>
        <Link href="/admin/strategies/local" className="btn">Local Strategies</Link>
        <Link href="/admin/strategies/ai" className="btn">AI Strategies</Link>
      </div>

      <div className="adminPageIntro">
        <h2 style={{ marginTop: 0 }}>Composite Strategy Builder</h2>
        <p className="settingsMutedText">
          Build linear pipelines using Local + AI strategy nodes and validate by dry-run on latest predictions.
        </p>
      </div>

      {loading ? <div className="settingsMutedText">Loading...</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {notice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div> : null}

      {isAdmin ? (
        <>
          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{editingId ? "Edit Composite Strategy" : "Create Composite Strategy"}</h3>
            </div>

            <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="BTC Composite v1" />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Version</span>
                <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} />
              </label>
            </div>

            <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Combine mode</span>
                <select className="input" value={combineMode} onChange={(e) => setCombineMode(e.target.value as "pipeline" | "vote")}>
                  <option value="pipeline">pipeline</option>
                  <option value="vote" disabled>vote (reserved)</option>
                </select>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Output policy</span>
                <select className="input" value={outputPolicy} onChange={(e) => setOutputPolicy(e.target.value as any)}>
                  <option value="first_non_neutral">first_non_neutral</option>
                  <option value="override_by_confidence">override_by_confidence</option>
                  <option value="local_signal_ai_explain">local_signal_ai_explain</option>
                </select>
              </label>
            </div>

            <label className="settingsField" style={{ marginBottom: 10 }}>
              <span className="settingsFieldLabel">Description</span>
              <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>

            <label className="settingsField" style={{ marginBottom: 10 }}>
              <span className="settingsFieldLabel">Enabled</span>
              <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} />
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btnPrimary" type="button" onClick={() => void saveComposite()} disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update composite" : "Create composite"}
              </button>
              <button className="btn" type="button" onClick={resetBuilder}>Reset builder</button>
            </div>
          </section>

          <div className="settingsTwoColGrid" style={{ alignItems: "start", marginBottom: 12 }}>
            <section className="card settingsSection" style={{ marginBottom: 0 }}>
              <div className="settingsSectionHeader">
                <h3 style={{ margin: 0 }}>Available Strategies</h3>
              </div>

              <div style={{ marginBottom: 10 }}>
                <div className="settingsFieldLabel" style={{ marginBottom: 6 }}>Local</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {localStrategies.map((item) => (
                    <button
                      key={item.id}
                      className="btn"
                      type="button"
                      onClick={() => addStep("local", item.id, item.name)}
                      disabled={!item.isEnabled}
                      title={item.description ?? ""}
                    >
                      + {item.name} ({item.strategyType})
                    </button>
                  ))}
                  {localStrategies.length === 0 ? <div className="settingsMutedText">No local strategies.</div> : null}
                </div>
              </div>

              <div>
                <div className="settingsFieldLabel" style={{ marginBottom: 6 }}>AI</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {aiPrompts.map((item) => (
                    <button
                      key={item.id}
                      className="btn"
                      type="button"
                      onClick={() => addStep("ai", item.id, item.name)}
                    >
                      + {item.name}
                    </button>
                  ))}
                  {aiPrompts.length === 0 ? <div className="settingsMutedText">No AI prompts.</div> : null}
                </div>
              </div>
            </section>

            <section className="card settingsSection" style={{ marginBottom: 0 }}>
              <div className="settingsSectionHeader">
                <h3 style={{ margin: 0 }}>Pipeline Steps (linear)</h3>
              </div>

              {steps.length === 0 ? <div className="settingsMutedText">Add strategies from the left panel.</div> : (
                <div style={{ display: "grid", gap: 8 }}>
                  {steps.map((step, index) => (
                    <div
                      key={step.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: selectedStepId === step.id ? "rgba(19,26,44,0.9)" : "transparent"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn" type="button" onClick={() => setSelectedStepId(step.id)}>
                          Step {index + 1}: {step.label}
                        </button>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn" type="button" onClick={() => moveStep(step.id, -1)} disabled={index === 0}>↑</button>
                          <button className="btn" type="button" onClick={() => moveStep(step.id, 1)} disabled={index === steps.length - 1}>↓</button>
                          <button className="btn" type="button" onClick={() => removeStep(step.id)}>Remove</button>
                        </div>
                      </div>

                      {index > 0 ? (
                        <div className="settingsTwoColGrid" style={{ marginTop: 8 }}>
                          <label className="settingsField">
                            <span className="settingsFieldLabel">Edge rule from previous step</span>
                            <select
                              className="input"
                              value={step.edgeRule}
                              onChange={(e) => patchStep(step.id, { edgeRule: e.target.value as BuilderStep["edgeRule"] })}
                            >
                              <option value="always">always</option>
                              <option value="if_signal_not_neutral">if_signal_not_neutral</option>
                              <option value="if_confidence_gte">if_confidence_gte</option>
                            </select>
                          </label>
                          <label className="settingsField">
                            <span className="settingsFieldLabel">confidence gte</span>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              max={100}
                              value={step.confidenceGte}
                              onChange={(e) => patchStep(step.id, { confidenceGte: e.target.value })}
                              disabled={step.edgeRule !== "if_confidence_gte"}
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>Node Config Editor</h3>
            </div>
            {!selectedStep ? (
              <div className="settingsMutedText">Select a pipeline step to edit config overrides.</div>
            ) : (
              <>
                <div className="settingsMutedText" style={{ marginBottom: 8 }}>
                  {selectedStep.kind.toUpperCase()} · {selectedStep.refId}
                </div>
                <label className="settingsField" style={{ marginBottom: 8 }}>
                  <span className="settingsFieldLabel">configOverrides JSON</span>
                  <textarea
                    className="input"
                    rows={10}
                    value={selectedStep.configOverridesText}
                    onChange={(e) => patchStep(selectedStep.id, { configOverridesText: e.target.value })}
                  />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">Suggested uiSchema</span>
                  <textarea
                    className="input"
                    rows={8}
                    readOnly
                    value={pretty(
                      selectedStep.kind === "local"
                        ? resolveLocalUiSchema(selectedStep)
                        : {
                          type: "ai_prompt_template",
                          refId: selectedStep.refId,
                          prompt: aiLookup.get(selectedStep.refId) ?? null
                        }
                    )}
                  />
                </label>
              </>
            )}
          </section>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>Preview (dry run)</h3>
            </div>

            <div className="settingsTwoColGrid" style={{ marginBottom: 8 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Exchange</span>
                <input className="input" value={previewExchange} onChange={(e) => setPreviewExchange(e.target.value)} placeholder="bitget" />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Account ID (optional)</span>
                <input className="input" value={previewAccountId} onChange={(e) => setPreviewAccountId(e.target.value)} placeholder="acc_..." />
              </label>
            </div>

            <div className="settingsTwoColGrid" style={{ marginBottom: 8 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Symbol</span>
                <input className="input" value={previewSymbol} onChange={(e) => setPreviewSymbol(toUpperSymbol(e.target.value))} />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Timeframe</span>
                <select className="input" value={previewTimeframe} onChange={(e) => setPreviewTimeframe(e.target.value as any)}>
                  <option value="5m">5m</option>
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                  <option value="1d">1d</option>
                </select>
              </label>
            </div>

            <div className="settingsTwoColGrid" style={{ marginBottom: 8 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Market type</span>
                <select className="input" value={previewMarketType} onChange={(e) => setPreviewMarketType(e.target.value as "spot" | "perp")}>
                  <option value="perp">perp</option>
                  <option value="spot">spot</option>
                </select>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Prediction ID (optional override)</span>
                <input className="input" value={selectedPredictionId} onChange={(e) => setSelectedPredictionId(e.target.value)} placeholder="auto-select latest if empty" />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button className="btn btnPrimary" type="button" onClick={() => void runDryPreview()} disabled={runningPreview || !editingId}>
                {runningPreview ? "Running..." : "Run preview"}
              </button>
            </div>

            <label className="settingsField">
              <span className="settingsFieldLabel">Dry-run output</span>
              <textarea className="input" rows={14} readOnly value={previewOutput} placeholder="Dry-run output appears here." />
            </label>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>Saved Composite Strategies</h3>
            </div>
            {composites.length === 0 ? <div className="settingsMutedText">No composites yet.</div> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th align="left">Name</th>
                      <th align="left">Version</th>
                      <th align="left">Mode</th>
                      <th align="left">Policy</th>
                      <th align="left">Status</th>
                      <th align="left">Updated</th>
                      <th align="left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {composites.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{item.version}</td>
                        <td>{item.combineMode}</td>
                        <td><code>{item.outputPolicy}</code></td>
                        <td>{item.isEnabled ? "enabled" : "disabled"}</td>
                        <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "-"}</td>
                        <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn" type="button" onClick={() => loadComposite(item)}>Edit</button>
                          <button className="btn" type="button" onClick={() => void removeComposite(item.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
