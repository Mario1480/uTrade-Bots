"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";

type IndicatorOption = {
  key: string;
  label: string;
  group: string;
  description: string;
};

type AiPromptsResponse = {
  availableIndicators: IndicatorOption[];
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
  newsRiskMode: "off" | "block";
  isPublic: boolean;
};

type PromptGenerationMeta = {
  mode: "ai" | "fallback";
  model: string;
};

type GenerateRequestBody = {
  name: string;
  strategyDescription: string;
  indicatorKeys: string[];
  ohlcvBars: number;
  timeframes: Array<"5m" | "15m" | "1h" | "4h" | "1d">;
  runTimeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
  directionPreference: "long" | "short" | "either";
  confidenceTargetPct: number;
  slTpSource: "local" | "ai" | "hybrid";
  newsRiskMode: "off" | "block";
  setActive: boolean;
  isPublic: boolean;
};

type GeneratePreviewResponse = {
  generatedPromptText: string;
  generationMeta: PromptGenerationMeta;
};

type GenerateSaveResponse = {
  prompt: PromptTemplate;
  activePromptId: string | null;
  generatedPromptText: string;
  generationMeta: PromptGenerationMeta;
  updatedAt: string | null;
};

const TIMEFRAME_OPTIONS = ["5m", "15m", "1h", "4h", "1d"] as const;

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminAiPromptGeneratorPage() {
  const t = useTranslations("admin.aiPromptGenerator");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [availableIndicators, setAvailableIndicators] = useState<IndicatorOption[]>([]);
  const [name, setName] = useState("");
  const [strategyDescription, setStrategyDescription] = useState("");
  const [indicatorKeys, setIndicatorKeys] = useState<string[]>([]);
  const [timeframes, setTimeframes] = useState<Array<"5m" | "15m" | "1h" | "4h" | "1d">>([]);
  const [runTimeframe, setRunTimeframe] = useState<"" | "5m" | "15m" | "1h" | "4h" | "1d">("");
  const [setActive, setSetActive] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [directionPreference, setDirectionPreference] = useState<"long" | "short" | "either">("either");
  const [confidenceTargetPct, setConfidenceTargetPct] = useState("60");
  const [slTpSource, setSlTpSource] = useState<"local" | "ai" | "hybrid">("local");
  const [newsRiskMode, setNewsRiskMode] = useState<"off" | "block">("off");
  const [ohlcvBars, setOhlcvBars] = useState("100");

  const [generatedPromptText, setGeneratedPromptText] = useState("");
  const [generationMeta, setGenerationMeta] = useState<PromptGenerationMeta | null>(null);
  const [savedPrompt, setSavedPrompt] = useState<PromptTemplate | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSaving, setPreviewSaving] = useState(false);
  const [previewPromptText, setPreviewPromptText] = useState("");
  const [previewMeta, setPreviewMeta] = useState<PromptGenerationMeta | null>(null);

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
        setIsAdmin(false);
        setError(t("messages.accessRequired"));
        return;
      }
      setIsAdmin(true);

      const res = await apiGet<AiPromptsResponse>("/admin/settings/ai-prompts");
      setAvailableIndicators(Array.isArray(res.availableIndicators) ? res.availableIndicators : []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  function toggleIndicator(key: string) {
    setIndicatorKeys((prev) =>
      prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]
    );
  }

  function toggleTimeframe(value: "5m" | "15m" | "1h" | "4h" | "1d") {
    setTimeframes((prev) => {
      if (prev.includes(value)) {
        const next = prev.filter((entry) => entry !== value);
        if (!next.includes(runTimeframe as any)) {
          setRunTimeframe(next[0] ?? "");
        }
        return next;
      }
      if (prev.length >= 4) return prev;
      const next = [...prev, value];
      if (!runTimeframe) setRunTimeframe(value);
      return next;
    });
  }

  function buildGenerateBody(): GenerateRequestBody | null {
    setError(null);
    setNotice(null);

    const promptName = name.trim();
    const strategyText = strategyDescription.trim();
    if (!promptName) {
      setError(t("messages.promptNameRequired"));
      return null;
    }
    if (!strategyText) {
      setError(t("messages.strategyRequired"));
      return null;
    }
    if (timeframes.length > 0 && !runTimeframe) {
      setError(t("messages.runTimeframeRequired"));
      return null;
    }
    if (timeframes.length > 0 && !timeframes.includes(runTimeframe as any)) {
      setError(t("messages.runTimeframeMustBeInSet"));
      return null;
    }
    const confidenceTarget = Number(confidenceTargetPct);
    if (!Number.isFinite(confidenceTarget) || confidenceTarget < 0 || confidenceTarget > 100) {
      setError(t("messages.confidenceRange"));
      return null;
    }
    const ohlcvBarsNum = Number(ohlcvBars);
    if (!Number.isFinite(ohlcvBarsNum) || ohlcvBarsNum < 20 || ohlcvBarsNum > 500) {
      setError(t("messages.ohlcvRange"));
      return null;
    }

    return {
      name: promptName,
      strategyDescription: strategyText,
      indicatorKeys,
      ohlcvBars: Math.trunc(ohlcvBarsNum),
      timeframes,
      runTimeframe: timeframes.length > 0 ? (runTimeframe || timeframes[0]) : null,
      directionPreference,
      confidenceTargetPct: confidenceTarget,
      slTpSource,
      newsRiskMode,
      setActive,
      isPublic
    };
  }

  async function generatePreview() {
    const body = buildGenerateBody();
    if (!body) return;

    setPreviewLoading(true);
    setPreviewPromptText("");
    setPreviewMeta(null);
    try {
      const res = await apiPost<GeneratePreviewResponse>("/admin/settings/ai-prompts/generate-preview", body);
      setPreviewPromptText(res.generatedPromptText ?? "");
      setPreviewMeta(res.generationMeta ?? null);
      setPreviewOpen(true);
      setNotice(
        t("messages.previewGenerated", {
          mode: res.generationMeta?.mode ?? "fallback",
          model: res.generationMeta?.model ?? "n/a"
        })
      );
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function saveFromPreview() {
    const body = buildGenerateBody();
    if (!body) return;
    if (!previewPromptText.trim()) {
      setError(t("messages.previewMissing"));
      return;
    }

    setPreviewSaving(true);
    setSaving(true);
    try {
      const payload = {
        ...body,
        generatedPromptText: previewPromptText,
        generationMeta: previewMeta ?? undefined
      };
      const res = await apiPost<GenerateSaveResponse>("/admin/settings/ai-prompts/generate-save", payload);
      setGeneratedPromptText(res.generatedPromptText ?? "");
      setGenerationMeta(res.generationMeta ?? null);
      setSavedPrompt(res.prompt ?? null);
      setPreviewOpen(false);
      setNotice(
        t("messages.previewSaveSuccess", {
          mode: res.generationMeta?.mode ?? "fallback",
          model: res.generationMeta?.model ?? "n/a"
        })
      );
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPreviewSaving(false);
      setSaving(false);
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href={withLocalePath("/admin", locale)} className="btn">
          ← {tCommon("backToAdmin")}
        </Link>
        <Link href={withLocalePath("/admin/strategies", locale)} className="btn">
          ← {t("backToStrategies")}
        </Link>
        <Link href={withLocalePath("/admin/strategies/ai", locale)} className="btn">
          ← {t("backToAiPrompts")}
        </Link>
      </div>

      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="adminPageIntro">{t("subtitle")}</div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">{error}</div>
      ) : null}
      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div>
      ) : null}

      {isAdmin ? (
        <section className="card settingsSection" style={{ marginBottom: 12 }}>
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{t("formTitle")}</h3>
          </div>

          <div className="settingsTwoColGrid" style={{ marginBottom: 8 }}>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("promptName")}</span>
              <input
                className="input"
                value={name}
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("promptNamePlaceholder")}
              />
            </label>
            <label className="inlineCheck" style={{ marginTop: 24 }}>
              <input type="checkbox" checked={setActive} onChange={(event) => setSetActive(event.target.checked)} />
              {t("setActive")}
            </label>
            <label className="inlineCheck" style={{ marginTop: 24 }}>
              <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
              {t("publicPrompt")}
            </label>
          </div>

          <label className="settingsField" style={{ marginBottom: 10 }}>
            <span className="settingsFieldLabel">{t("strategyDescription")}</span>
            <textarea
              className="input"
              rows={8}
              maxLength={8000}
              value={strategyDescription}
              onChange={(event) => setStrategyDescription(event.target.value)}
              placeholder={t("strategyPlaceholder")}
            />
            <span className="settingsMutedText">{t("characters", { count: strategyDescription.length })}</span>
          </label>

          <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("timeframes")}</span>
              <span className="settingsMutedText">{t("maxTimeframesHint")}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {TIMEFRAME_OPTIONS.map((tf) => (
                  <label key={`tf-${tf}`} className="inlineCheck">
                    <input
                      type="checkbox"
                      checked={timeframes.includes(tf)}
                      onChange={() => toggleTimeframe(tf)}
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
                value={runTimeframe}
                onChange={(event) => setRunTimeframe(event.target.value as "" | "5m" | "15m" | "1h" | "4h" | "1d")}
                disabled={timeframes.length === 0}
              >
                {timeframes.length === 0 ? <option value="">{t("noTimeframeLock")}</option> : null}
                {timeframes.map((tf) => (
                  <option key={`run-${tf}`} value={tf}>{tf}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="settingsTwoColGrid" style={{ marginBottom: 10 }}>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("directionPreference")}</span>
              <select
                className="input"
                value={directionPreference}
                onChange={(event) => setDirectionPreference(event.target.value as "long" | "short" | "either")}
              >
                <option value="either">{t("directionEither")}</option>
                <option value="long">{t("directionLong")}</option>
                <option value="short">{t("directionShort")}</option>
              </select>
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("confidenceTargetPct")}</span>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                step={1}
                value={confidenceTargetPct}
                onChange={(event) => setConfidenceTargetPct(event.target.value)}
              />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("slTpSource")}</span>
              <select
                className="input"
                value={slTpSource}
                onChange={(event) => setSlTpSource(event.target.value as "local" | "ai" | "hybrid")}
              >
                <option value="local">{t("slTpSourceLocal")}</option>
                <option value="ai">{t("slTpSourceAi")}</option>
                <option value="hybrid">{t("slTpSourceHybrid")}</option>
              </select>
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("newsRiskMode")}</span>
              <select
                className="input"
                value={newsRiskMode}
                onChange={(event) => setNewsRiskMode(event.target.value as "off" | "block")}
              >
                <option value="off">{t("newsRiskModeOff")}</option>
                <option value="block">{t("newsRiskModeBlock")}</option>
              </select>
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("ohlcvBars")}</span>
              <input
                className="input"
                type="number"
                min={20}
                max={500}
                step={1}
                value={ohlcvBars}
                onChange={(event) => setOhlcvBars(event.target.value)}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <button className="btn" type="button" onClick={() => setIndicatorKeys(availableIndicators.map((item) => item.key))}>
              {t("selectAllIndicators")}
            </button>
            <button className="btn" type="button" onClick={() => setIndicatorKeys([])}>
              {t("clearIndicators")}
            </button>
          </div>

          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", marginBottom: 10 }}>
            {indicatorGroups.map(([group, items]) => (
              <div key={`group-${group}`} style={{ display: "grid", gap: 8 }}>
                <div className="settingsMutedText" style={{ fontWeight: 700 }}>{group}</div>
                {items.map((item) => (
                  <label
                    key={`indicator-${item.key}`}
                    className="inlineCheck"
                    style={{
                      border: "1px solid rgba(255, 193, 7, 0.2)",
                      borderRadius: 8,
                      padding: "8px 10px",
                      alignItems: "flex-start",
                      gap: 8
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={indicatorKeys.includes(item.key)}
                      onChange={() => toggleIndicator(item.key)}
                      style={{ marginTop: 2 }}
                    />
                    <span style={{ display: "grid", gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</span>
                      <span className="settingsMutedText">{item.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div className="indicatorFormActions" style={{ marginTop: 8 }}>
            <button
              className="btn btnPrimary"
              type="button"
              disabled={saving || previewLoading}
              onClick={() => void generatePreview()}
            >
              {previewLoading ? t("previewGenerating") : t("generatePreview")}
            </button>
          </div>
        </section>
      ) : null}

      {previewOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 16
          }}
          onClick={() => {
            if (!previewSaving) setPreviewOpen(false);
          }}
        >
          <div
            className="card"
            style={{ width: "min(1000px, 95vw)", maxHeight: "90vh", display: "grid", gap: 10, padding: 16 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("previewTitle")}</h3>
            </div>
            <div className="settingsMutedText">
              {previewMeta
                ? t("previewHint", { mode: previewMeta.mode, model: previewMeta.model })
                : t("previewHint", { mode: "fallback", model: "n/a" })}
            </div>
            <textarea className="input" rows={18} readOnly value={previewPromptText} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                disabled={previewSaving}
                onClick={() => setPreviewOpen(false)}
              >
                {t("previewCancel")}
              </button>
              <button
                className="btn btnPrimary"
                type="button"
                disabled={previewSaving}
                onClick={() => void saveFromPreview()}
              >
                {previewSaving ? t("previewSaving") : t("previewSave")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {generatedPromptText ? (
        <section className="card settingsSection" style={{ marginBottom: 12 }}>
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{t("resultTitle")}</h3>
          </div>
          <div className="settingsMutedText" style={{ marginBottom: 8 }}>
            {generationMeta
              ? t("resultMeta", {
                mode: generationMeta.mode,
                model: generationMeta.model,
                promptId: savedPrompt?.id ?? "-"
              })
              : ""}
          </div>
          <textarea className="input" rows={18} value={generatedPromptText} readOnly />
        </section>
      ) : null}
    </div>
  );
}
