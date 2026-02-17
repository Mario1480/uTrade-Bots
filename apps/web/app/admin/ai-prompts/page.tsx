"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type IndicatorOption = {
  key: string;
  label: string;
  group: string;
  description: string;
};

type PromptTemplate = {
  id: string;
  name: string;
  promptText: string;
  indicatorKeys: string[];
  ohlcvBars: number;
  timeframes: Array<"5m" | "15m" | "1h" | "4h" | "1d">;
  runTimeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
  directionPreference: "long" | "short" | "either";
  confidenceTargetPct: number;
  slTpSource: "local" | "ai" | "hybrid";
  marketAnalysisUpdateEnabled: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

type AiPromptsResponse = {
  activePromptId: string | null;
  prompts: PromptTemplate[];
  availableIndicators: IndicatorOption[];
  licensePolicy: {
    mode: "off" | "warn" | "enforce";
    allowedPublicPromptIds: string[];
    enforcementActive: boolean;
  };
  updatedAt: string | null;
  source: "db" | "default";
  defaults: {
    activePromptId: string | null;
    prompts: PromptTemplate[];
  };
};

type PreviewResponse = {
  scopeContext: {
    exchange?: string | null;
    accountId?: string | null;
    symbol?: string | null;
    timeframe?: string | null;
  };
    runtimeSettings: {
      promptText: string;
      indicatorKeys: string[];
      ohlcvBars: number;
      timeframes: Array<"5m" | "15m" | "1h" | "4h" | "1d">;
      runTimeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
      timeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
      directionPreference: "long" | "short" | "either";
      confidenceTargetPct: number;
      marketAnalysisUpdateEnabled: boolean;
      source: "default" | "db";
      activePromptId: string | null;
      activePromptName: string | null;
      selectedFrom: "active_prompt" | "default";
    matchedScopeType: null;
    matchedOverrideId: null;
  };
  systemMessage: string;
  cacheKey: string;
  userPayload: Record<string, unknown>;
};

const TIMEFRAME_OPTIONS = ["5m", "15m", "1h", "4h", "1d"] as const;

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function toUpperSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function clonePrompts(prompts: PromptTemplate[]): PromptTemplate[] {
  return prompts.map((item) => ({
    id: item.id,
    name: item.name,
    promptText: item.promptText,
    indicatorKeys: [...item.indicatorKeys],
    ohlcvBars: Number.isFinite(Number(item.ohlcvBars))
      ? Math.max(20, Math.min(500, Math.trunc(Number(item.ohlcvBars))))
      : 100,
    timeframes: Array.isArray(item.timeframes)
      ? item.timeframes.filter((value): value is "5m" | "15m" | "1h" | "4h" | "1d" =>
        value === "5m" || value === "15m" || value === "1h" || value === "4h" || value === "1d"
      ).slice(0, 4)
      : (item.timeframe ? [item.timeframe] : []),
    runTimeframe: item.runTimeframe ?? item.timeframe ?? null,
    timeframe: item.runTimeframe ?? item.timeframe ?? null,
    directionPreference:
      item.directionPreference === "long" || item.directionPreference === "short"
        ? item.directionPreference
        : "either",
    confidenceTargetPct: Number.isFinite(Number(item.confidenceTargetPct))
      ? Math.max(0, Math.min(100, Number(item.confidenceTargetPct)))
      : 60,
    slTpSource:
      item.slTpSource === "ai" || item.slTpSource === "hybrid"
        ? item.slTpSource
        : "local",
    marketAnalysisUpdateEnabled: Boolean(item.marketAnalysisUpdateEnabled),
    isPublic: item.isPublic,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
}

function makePromptId(): string {
  return `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function AdminAiPromptsPage() {
  const t = useTranslations("admin.aiPrompts");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [availableIndicators, setAvailableIndicators] = useState<IndicatorOption[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [source, setSource] = useState<"db" | "default">("default");
  const [defaults, setDefaults] = useState<AiPromptsResponse["defaults"] | null>(null);
  const [licensePolicy, setLicensePolicy] = useState<AiPromptsResponse["licensePolicy"] | null>(null);

  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptName, setPromptName] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptIsPublic, setPromptIsPublic] = useState(false);
  const [promptIndicatorKeys, setPromptIndicatorKeys] = useState<string[]>([]);
  const [promptTimeframes, setPromptTimeframes] = useState<Array<"5m" | "15m" | "1h" | "4h" | "1d">>([]);
  const [promptRunTimeframe, setPromptRunTimeframe] = useState<"" | "5m" | "15m" | "1h" | "4h" | "1d">("");
  const [promptDirectionPreference, setPromptDirectionPreference] = useState<"long" | "short" | "either">("either");
  const [promptConfidenceTargetPct, setPromptConfidenceTargetPct] = useState("60");
  const [promptSlTpSource, setPromptSlTpSource] = useState<"local" | "ai" | "hybrid">("local");
  const [promptMarketAnalysisUpdateEnabled, setPromptMarketAnalysisUpdateEnabled] = useState(false);
  const [promptOhlcvBars, setPromptOhlcvBars] = useState("100");

  const [previewExchange, setPreviewExchange] = useState("bitget");
  const [previewAccountId, setPreviewAccountId] = useState("");
  const [previewSymbol, setPreviewSymbol] = useState("BTCUSDT");
  const [previewMarketType, setPreviewMarketType] = useState<"spot" | "perp">("perp");
  const [previewTimeframe, setPreviewTimeframe] = useState("15m");
  const [previewSignal, setPreviewSignal] = useState<"up" | "down" | "neutral">("neutral");
  const [previewExpectedMovePct, setPreviewExpectedMovePct] = useState("0.8");
  const [previewConfidence, setPreviewConfidence] = useState("0.5");
  const [previewFeatureSnapshot, setPreviewFeatureSnapshot] = useState<string>(
    JSON.stringify(
      {
        prefillExchange: "bitget",
        prefillExchangeAccountId: "acc_demo",
        indicators: {
          rsi_14: 54.2,
          macd: { hist: 0.013 },
          stochrsi: { k: 63.1, d: 59.8 },
          volume: { rel_vol: 1.25, vol_z: 0.92 }
        },
        advancedIndicators: {
          smartMoneyConcepts: {
            swing: { lastEvent: { type: "bos", direction: "bullish" } }
          }
        }
      },
      null,
      2
    )
  );
  const [previewOutput, setPreviewOutput] = useState<string>("");

  const indicatorGroups = useMemo(() => {
    const grouped: Record<string, IndicatorOption[]> = {};
    for (const item of availableIndicators) {
      if (!grouped[item.group]) grouped[item.group] = [];
      grouped[item.group].push(item);
    }
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, items]) => [group, items.sort((x, y) => x.label.localeCompare(y.label))] as const);
  }, [availableIndicators]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsSuperadmin(false);
        setError(t("messages.accessRequired"));
        return;
      }
      setIsSuperadmin(true);

      const res = await apiGet<AiPromptsResponse>("/admin/settings/ai-prompts");
      setActivePromptId(res.activePromptId ?? null);
      setPrompts(clonePrompts(res.prompts ?? []));
      setAvailableIndicators(Array.isArray(res.availableIndicators) ? res.availableIndicators : []);
      setLicensePolicy(res.licensePolicy ?? null);
      setUpdatedAt(res.updatedAt ?? null);
      setSource(res.source ?? "default");
      setDefaults(res.defaults ?? null);
      resetPromptForm();
      setNotice(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  function resetPromptForm() {
    setEditingPromptId(null);
    setPromptName("");
    setPromptText("");
    setPromptIsPublic(false);
    setPromptIndicatorKeys([]);
    setPromptTimeframes([]);
    setPromptRunTimeframe("");
    setPromptDirectionPreference("either");
    setPromptConfidenceTargetPct("60");
    setPromptSlTpSource("local");
    setPromptMarketAnalysisUpdateEnabled(false);
    setPromptOhlcvBars("100");
  }

  function loadPromptIntoForm(prompt: PromptTemplate) {
    setEditingPromptId(prompt.id);
    setPromptName(prompt.name);
    setPromptText(prompt.promptText);
    setPromptIsPublic(Boolean(prompt.isPublic));
    setPromptIndicatorKeys([...(prompt.indicatorKeys ?? [])]);
    const nextTimeframes = Array.isArray(prompt.timeframes) && prompt.timeframes.length > 0
      ? prompt.timeframes
      : (prompt.timeframe ? [prompt.timeframe] : []);
    setPromptTimeframes(nextTimeframes);
    setPromptRunTimeframe((prompt.runTimeframe ?? prompt.timeframe ?? "") as "" | "5m" | "15m" | "1h" | "4h" | "1d");
    setPromptDirectionPreference(prompt.directionPreference ?? "either");
    setPromptConfidenceTargetPct(String(prompt.confidenceTargetPct ?? 60));
    setPromptSlTpSource(
      prompt.slTpSource === "ai" || prompt.slTpSource === "hybrid"
        ? prompt.slTpSource
        : "local"
    );
    setPromptMarketAnalysisUpdateEnabled(Boolean(prompt.marketAnalysisUpdateEnabled));
    setPromptOhlcvBars(String(prompt.ohlcvBars ?? 100));
  }

  function togglePromptIndicator(key: string) {
    setPromptIndicatorKeys((prev) =>
      prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]
    );
  }

  function togglePromptTimeframe(value: "5m" | "15m" | "1h" | "4h" | "1d") {
    setPromptTimeframes((prev) => {
      if (prev.includes(value)) {
        const next = prev.filter((entry) => entry !== value);
        if (!next.includes(promptRunTimeframe as any)) {
          setPromptRunTimeframe(next[0] ?? "");
        }
        return next;
      }
      if (prev.length >= 4) return prev;
      const next = [...prev, value];
      if (!promptRunTimeframe) setPromptRunTimeframe(value);
      return next;
    });
  }

  function setAllPromptIndicators(enabled: boolean) {
    setPromptIndicatorKeys(enabled ? availableIndicators.map((item) => item.key) : []);
  }

  async function savePromptDraft() {
    setError(null);
    setNotice(null);
    const name = promptName.trim();
    const confidenceTargetPct = Number(promptConfidenceTargetPct);
    const ohlcvBars = Number(promptOhlcvBars);
    if (!name) {
      setError(t("messages.promptNameRequired"));
      return;
    }
    if (!Number.isFinite(confidenceTargetPct) || confidenceTargetPct < 0 || confidenceTargetPct > 100) {
      setError(t("messages.confidenceRange"));
      return;
    }
    if (!Number.isFinite(ohlcvBars) || ohlcvBars < 20 || ohlcvBars > 500) {
      setError(t("messages.ohlcvRange"));
      return;
    }
    if (promptTimeframes.length > 0 && !promptRunTimeframe) {
      setError(t("messages.runTimeframeRequired"));
      return;
    }
    if (promptTimeframes.length > 0 && !promptTimeframes.includes(promptRunTimeframe as any)) {
      setError(t("messages.runTimeframeMustBeInSet"));
      return;
    }

    const nowIso = new Date().toISOString();
    const normalizedTimeframes = Array.from(new Set(promptTimeframes)).slice(0, 4);
    const normalizedRunTimeframe = normalizedTimeframes.length > 0
      ? ((promptRunTimeframe || normalizedTimeframes[0]) as "5m" | "15m" | "1h" | "4h" | "1d")
      : null;
    const nextPrompt: PromptTemplate = {
      id: editingPromptId ?? makePromptId(),
      name,
      promptText,
      indicatorKeys: Array.from(new Set(promptIndicatorKeys)),
      ohlcvBars: Math.round(ohlcvBars),
      timeframes: normalizedTimeframes,
      runTimeframe: normalizedRunTimeframe,
      timeframe: normalizedRunTimeframe,
      directionPreference: promptDirectionPreference,
      confidenceTargetPct: Math.round(confidenceTargetPct),
      slTpSource: promptSlTpSource,
      marketAnalysisUpdateEnabled: promptMarketAnalysisUpdateEnabled,
      isPublic: promptIsPublic,
      createdAt:
        editingPromptId
          ? prompts.find((item) => item.id === editingPromptId)?.createdAt ?? nowIso
          : nowIso,
      updatedAt: nowIso
    };

    const idx = prompts.findIndex((item) => item.id === nextPrompt.id);
    const nextPrompts =
      idx >= 0
        ? prompts.map((item, index) => (index === idx ? nextPrompt : item))
        : [nextPrompt, ...prompts];
    const nextActivePromptId = activePromptId ?? nextPrompt.id;

    setSaving(true);
    try {
      const payload = {
        activePromptId: nextActivePromptId,
        prompts: nextPrompts
      };
      const res = await apiPut<AiPromptsResponse>("/admin/settings/ai-prompts", payload);
      setActivePromptId(res.activePromptId ?? null);
      setPrompts(clonePrompts(res.prompts ?? []));
      setAvailableIndicators(Array.isArray(res.availableIndicators) ? res.availableIndicators : []);
      setLicensePolicy(res.licensePolicy ?? null);
      setUpdatedAt(res.updatedAt ?? null);
      setSource(res.source ?? "db");
      setDefaults(res.defaults ?? null);
      setNotice(editingPromptId ? t("messages.promptUpdated") : t("messages.promptCreated"));
      resetPromptForm();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  function deletePrompt(promptId: string) {
    setPrompts((prev) => {
      const next = prev.filter((item) => item.id !== promptId);
      setActivePromptId((currentActive) => {
        if (currentActive !== promptId) return currentActive;
        return next[0]?.id ?? null;
      });
      return next;
    });
    if (editingPromptId === promptId) {
      resetPromptForm();
    }
  }

  function loadDefaultsToForm() {
    if (!defaults) return;
    setActivePromptId(defaults.activePromptId ?? null);
    setPrompts(clonePrompts(defaults.prompts ?? []));
    resetPromptForm();
    setNotice(t("messages.defaultsLoaded"));
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        activePromptId,
        prompts
      };
      const res = await apiPut<AiPromptsResponse>("/admin/settings/ai-prompts", payload);
      setActivePromptId(res.activePromptId ?? null);
      setPrompts(clonePrompts(res.prompts ?? []));
      setAvailableIndicators(Array.isArray(res.availableIndicators) ? res.availableIndicators : []);
      setLicensePolicy(res.licensePolicy ?? null);
      setUpdatedAt(res.updatedAt ?? null);
      setSource(res.source ?? "db");
      setDefaults(res.defaults ?? null);
      setNotice(t("messages.saved"));
      resetPromptForm();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    setPreviewLoading(true);
    setError(null);
    try {
      let snapshot: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(previewFeatureSnapshot);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(t("messages.featureSnapshotObject"));
        }
        snapshot = parsed as Record<string, unknown>;
      } catch (e) {
        throw new Error(t("messages.invalidFeatureSnapshotJson", { err: String(e) }));
      }

      const body = {
        exchange: previewExchange.trim() || undefined,
        accountId: previewAccountId.trim() || undefined,
        symbol: toUpperSymbol(previewSymbol),
        marketType: previewMarketType,
        timeframe: previewTimeframe,
        prediction: {
          signal: previewSignal,
          expectedMovePct: Number(previewExpectedMovePct),
          confidence: Number(previewConfidence)
        },
        featureSnapshot: snapshot,
        settingsDraft: {
          activePromptId,
          prompts
        }
      };

      const res = await apiPost<PreviewResponse>("/admin/settings/ai-prompts/preview", body);
      setPreviewOutput(JSON.stringify(res, null, 2));
      setNotice(t("messages.previewGenerated"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPreviewLoading(false);
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
              <h3 style={{ margin: 0 }}>{t("licensePolicyTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              {t("licensePolicyHint")}
            </div>
            <div className="indicatorScopeGrid">
              <div className="settingsField">
                <span className="settingsFieldLabel">Mode</span>
                <div className="settingsMutedText">
                  {licensePolicy?.mode ?? "off"}
                </div>
              </div>
              <div className="settingsField">
                <span className="settingsFieldLabel">Enforcement active</span>
                <div className="settingsMutedText">
                  {licensePolicy?.enforcementActive ? t("yes") : t("no")}
                </div>
              </div>
              <div className="settingsField">
                <span className="settingsFieldLabel">Allowed public prompt IDs</span>
                <div className="settingsMutedText" style={{ wordBreak: "break-word" }}>
                  {licensePolicy?.allowedPublicPromptIds?.length
                    ? licensePolicy.allowedPublicPromptIds.join(", ")
                    : "*"}
                </div>
              </div>
            </div>
          </section>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("promptLibraryTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              Source: {source} · Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : "never"}
            </div>

            <div className="indicatorConfigBlock" style={{ marginBottom: 12 }}>
              <div className="indicatorConfigTitle">{editingPromptId ? "Edit prompt" : "Create prompt"}</div>

              <div className="settingsTwoColGrid" style={{ marginBottom: 8 }}>
                <label className="settingsField">
                  <span className="settingsFieldLabel">Prompt name</span>
                  <input className="input" value={promptName} onChange={(e) => setPromptName(e.target.value)} placeholder="z. B. RSI Mean Reversion" />
                </label>
                <label className="inlineCheck" style={{ marginTop: 26 }}>
                  <input type="checkbox" checked={promptIsPublic} onChange={(e) => setPromptIsPublic(e.target.checked)} />
                  {t("publicPrompt")}
                </label>
              </div>

              <div className="settingsTwoColGrid" style={{ marginBottom: 8 }}>
                <label className="inlineCheck">
                  <input
                    type="checkbox"
                    checked={promptMarketAnalysisUpdateEnabled}
                    onChange={(e) => setPromptMarketAnalysisUpdateEnabled(e.target.checked)}
                  />
                  {t("marketAnalysisUpdateEnabled")}
                </label>
              </div>

      <div className="settingsTwoColGrid" style={{ marginBottom: 8 }}>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{t("timeframes")}</span>
                  <span className="settingsMutedText">{t("maxTimeframesHint")}</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    {TIMEFRAME_OPTIONS.map((tf) => (
                      <label key={`tf-${tf}`} className="inlineCheck">
                        <input
                          type="checkbox"
                          checked={promptTimeframes.includes(tf)}
                          onChange={() => togglePromptTimeframe(tf)}
                        />
                        {tf}
                      </label>
                    ))}
                  </div>
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{t("runTimeframe")}</span>
                  <select
                    className="input"
                    value={promptRunTimeframe}
                    onChange={(e) => setPromptRunTimeframe(e.target.value as "" | "5m" | "15m" | "1h" | "4h" | "1d")}
                    disabled={promptTimeframes.length === 0}
                  >
                    {promptTimeframes.length === 0 ? (
                      <option value="">{t("noTimeframeLock")}</option>
                    ) : null}
                    {promptTimeframes.map((tf) => (
                      <option key={`run-${tf}`} value={tf}>{tf}</option>
                    ))}
                  </select>
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">Direction preference</span>
                  <select
                    className="input"
                    value={promptDirectionPreference}
                    onChange={(e) => setPromptDirectionPreference(e.target.value as "long" | "short" | "either")}
                  >
                    <option value="either">either</option>
                    <option value="long">long only</option>
                    <option value="short">short only</option>
                  </select>
                </label>
              </div>

              <div className="settingsTwoColGrid" style={{ marginBottom: 8 }}>
                <label className="settingsField">
                  <span className="settingsFieldLabel">Confidence target (%)</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={promptConfidenceTargetPct}
                    onChange={(e) => setPromptConfidenceTargetPct(e.target.value)}
                  />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{t("slTpSource")}</span>
                  <select
                    className="input"
                    value={promptSlTpSource}
                    onChange={(e) => setPromptSlTpSource(e.target.value as "local" | "ai" | "hybrid")}
                  >
                    <option value="local">{t("slTpSourceLocal")}</option>
                    <option value="ai">{t("slTpSourceAi")}</option>
                    <option value="hybrid">{t("slTpSourceHybrid")}</option>
                  </select>
                  <span className="settingsMutedText">
                    {promptSlTpSource === "ai"
                      ? t("slTpSourceHintAi")
                      : promptSlTpSource === "hybrid"
                        ? t("slTpSourceHintHybrid")
                        : t("slTpSourceHintLocal")}
                  </span>
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">OHLCV bars for AI</span>
                  <input
                    className="input"
                    type="number"
                    min={20}
                    max={500}
                    step={1}
                    value={promptOhlcvBars}
                    onChange={(e) => setPromptOhlcvBars(e.target.value)}
                  />
                </label>
              </div>

              <label className="settingsField" style={{ marginBottom: 8 }}>
                <span className="settingsFieldLabel">AI instructions</span>
                <textarea className="input" rows={6} maxLength={8000} value={promptText} onChange={(e) => setPromptText(e.target.value)} />
                <span className="settingsMutedText">Characters: {promptText.length}/8000</span>
              </label>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <button className="btn" type="button" onClick={() => setAllPromptIndicators(true)}>Select all indicators</button>
                <button className="btn" type="button" onClick={() => setAllPromptIndicators(false)}>{t("clearIndicators")}</button>
              </div>

              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
                {availableIndicators.map((item) => (
                  <label key={`prompt-${item.key}`} className="inlineCheck" style={{ border: "1px solid rgba(255, 193, 7, 0.2)", borderRadius: 8, padding: "8px 10px", alignItems: "flex-start", gap: 8 }}>
                    <input type="checkbox" checked={promptIndicatorKeys.includes(item.key)} onChange={() => togglePromptIndicator(item.key)} style={{ marginTop: 2 }} />
                    <span style={{ display: "grid", gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</span>
                      <span className="settingsMutedText">{item.description}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="indicatorFormActions" style={{ marginTop: 10 }}>
                <button className="btn btnPrimary" type="button" onClick={() => void savePromptDraft()} disabled={saving}>
                  {saving ? t("saving") : editingPromptId ? t("updatePrompt") : t("createPrompt")}
                </button>
                <button className="btn" type="button" onClick={resetPromptForm}>{t("resetForm")}</button>
                <button className="btn" type="button" onClick={loadDefaultsToForm}>{t("loadDefaults")}</button>
              </div>
            </div>

            {prompts.length === 0 ? (
              <div className="settingsMutedText">{t("noPrompts")}</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Public</th>
                      <th>TF</th>
                      <th>{t("runTimeframeShort")}</th>
                      <th>Dir</th>
                      <th>Conf %</th>
                      <th>{t("slTpSourceShort")}</th>
                      <th>{t("analysisUpdate")}</th>
                      <th>OHLCV</th>
                      <th>Indicators</th>
                      <th>Updated</th>
                      <th>Active</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prompts.map((prompt) => (
                      <tr key={prompt.id}>
                        <td>{prompt.name}</td>
                        <td>{prompt.isPublic ? "yes" : "no"}</td>
                        <td>{prompt.timeframes?.length ? prompt.timeframes.join(", ") : "-"}</td>
                        <td>{prompt.runTimeframe ?? prompt.timeframe ?? "-"}</td>
                        <td>{prompt.directionPreference ?? "either"}</td>
                        <td>{Number.isFinite(Number(prompt.confidenceTargetPct)) ? Number(prompt.confidenceTargetPct).toFixed(0) : "60"}</td>
                        <td>{prompt.slTpSource ?? "local"}</td>
                        <td>{prompt.marketAnalysisUpdateEnabled ? t("yes") : t("no")}</td>
                        <td>{Number.isFinite(Number(prompt.ohlcvBars)) ? Math.trunc(Number(prompt.ohlcvBars)) : 100}</td>
                        <td>{prompt.indicatorKeys.length}</td>
                        <td>{prompt.updatedAt ? new Date(prompt.updatedAt).toLocaleString() : "-"}</td>
                        <td>{activePromptId === prompt.id ? "active" : "-"}</td>
                        <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn" type="button" onClick={() => setActivePromptId(prompt.id)}>{t("setActive")}</button>
                          <button className="btn" type="button" onClick={() => loadPromptIntoForm(prompt)}>{t("edit")}</button>
                          <button className="btn" type="button" onClick={() => deletePrompt(prompt.id)}>{t("delete")}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("previewTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              {t("previewHint")}
            </div>

            <div className="indicatorScopeGrid" style={{ marginBottom: 8 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Exchange</span>
                <input className="input" value={previewExchange} onChange={(e) => setPreviewExchange(e.target.value)} />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Account ID</span>
                <input className="input" value={previewAccountId} onChange={(e) => setPreviewAccountId(e.target.value)} />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Symbol</span>
                <input className="input" value={previewSymbol} onChange={(e) => setPreviewSymbol(toUpperSymbol(e.target.value))} />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Market</span>
                <select className="input" value={previewMarketType} onChange={(e) => setPreviewMarketType(e.target.value as "spot" | "perp")}>
                  <option value="perp">perp</option>
                  <option value="spot">spot</option>
                </select>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Timeframe</span>
                <select className="input" value={previewTimeframe} onChange={(e) => setPreviewTimeframe(e.target.value)}>
                  {TIMEFRAME_OPTIONS.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                </select>
              </label>
            </div>

            <div className="indicatorScopeGrid" style={{ marginBottom: 8 }}>
              <label className="settingsField">
                <span className="settingsFieldLabel">Prediction signal</span>
                <select className="input" value={previewSignal} onChange={(e) => setPreviewSignal(e.target.value as "up" | "down" | "neutral")}>
                  <option value="up">up</option>
                  <option value="down">down</option>
                  <option value="neutral">neutral</option>
                </select>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Expected move %</span>
                <input className="input" type="number" value={previewExpectedMovePct} onChange={(e) => setPreviewExpectedMovePct(e.target.value)} />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Confidence (0..1)</span>
                <input className="input" type="number" min={0} max={1} step={0.01} value={previewConfidence} onChange={(e) => setPreviewConfidence(e.target.value)} />
              </label>
            </div>

            <label className="settingsField" style={{ marginBottom: 8 }}>
              <span className="settingsFieldLabel">featureSnapshot JSON</span>
              <textarea className="input" rows={12} value={previewFeatureSnapshot} onChange={(e) => setPreviewFeatureSnapshot(e.target.value)} />
            </label>

            <div className="indicatorFormActions" style={{ marginBottom: 10 }}>
              <button className="btn btnPrimary" type="button" disabled={previewLoading} onClick={() => void runPreview()}>
                {previewLoading ? t("generatingPreview") : t("generatePayload")}
              </button>
            </div>

            {previewOutput ? (
              <pre style={{ margin: 0, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, border: "1px solid rgba(255, 193, 7, 0.2)", borderRadius: 8, padding: 10, background: "rgba(15,23,42,0.45)" }}>
                {previewOutput}
              </pre>
            ) : null}
          </section>

          <section className="card settingsSection">
            <div className="indicatorFormActions">
              <button className="btn btnPrimary" type="button" disabled={saving} onClick={() => void saveAll()}>
                {saving ? t("saving") : t("saveAll")}
              </button>
              <button className="btn" type="button" onClick={() => void loadAll()}>{t("reloadFromDb")}</button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
