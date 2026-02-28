"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

type ApiKeysSettingsResponse = {
  aiProfiles?: {
    openai?: {
      aiBaseUrl?: string | null;
      aiModel?: string | null;
      aiApiKeyMasked?: string | null;
      hasAiApiKey?: boolean;
    };
    ollama?: {
      aiBaseUrl?: string | null;
      aiModel?: string | null;
      aiApiKeyMasked?: string | null;
      hasAiApiKey?: boolean;
    };
  };
  aiApiKeyMasked?: string | null;
  hasAiApiKey?: boolean;
  aiProvider?: "openai" | "ollama" | "disabled" | null;
  aiBaseUrl?: string | null;
  aiModel?: string | null;
  openaiApiKeyMasked?: string | null;
  hasOpenAiApiKey?: boolean;
  fmpApiKeyMasked: string | null;
  hasFmpApiKey: boolean;
  openaiModel?: string | null;
  effectiveAiProvider?: "openai" | "ollama" | "disabled";
  effectiveAiProviderSource?: "db" | "env" | "default";
  effectiveAiBaseUrl?: string;
  effectiveAiBaseUrlSource?: "db" | "env" | "default";
  effectiveAiModel?: string;
  effectiveAiModelSource?: "db" | "env" | "default";
  effectiveOpenaiModel?: string;
  effectiveOpenaiModelSource?: "db" | "env" | "default";
  modelOptions: string[];
  providerOptions?: string[];
  updatedAt: string | null;
  envOverride: boolean;
  envOverrideFmp: boolean;
};

type ApiKeyHealthResponse = {
  ok: boolean;
  status: "ok" | "missing_key" | "error";
  source: "env" | "db" | "none";
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  message: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
};

export default function AdminApiKeysPage() {
  const t = useTranslations("admin.apiKeys");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [aiApiKey, setAiApiKey] = useState("");
  const [aiApiKeyMasked, setAiApiKeyMasked] = useState<string | null>(null);
  const [hasAiApiKey, setHasAiApiKey] = useState(false);
  const [aiProvider, setAiProvider] = useState<"openai" | "ollama" | "disabled">("openai");
  const [aiProfiles, setAiProfiles] = useState<{
    openai: { aiBaseUrl: string; aiModel: string; aiApiKeyMasked: string | null; hasAiApiKey: boolean };
    ollama: { aiBaseUrl: string; aiModel: string; aiApiKeyMasked: string | null; hasAiApiKey: boolean };
  }>({
    openai: { aiBaseUrl: "", aiModel: "", aiApiKeyMasked: null, hasAiApiKey: false },
    ollama: { aiBaseUrl: "", aiModel: "", aiApiKeyMasked: null, hasAiApiKey: false }
  });
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState<string>("");
  const [effectiveAiProvider, setEffectiveAiProvider] = useState<"openai" | "ollama" | "disabled">("openai");
  const [effectiveAiProviderSource, setEffectiveAiProviderSource] = useState<"db" | "env" | "default">("default");
  const [effectiveAiBaseUrl, setEffectiveAiBaseUrl] = useState<string>("https://api.openai.com/v1");
  const [effectiveAiBaseUrlSource, setEffectiveAiBaseUrlSource] = useState<"db" | "env" | "default">("default");
  const [effectiveAiModel, setEffectiveAiModel] = useState<string>("gpt-4o-mini");
  const [effectiveAiModelSource, setEffectiveAiModelSource] = useState<"db" | "env" | "default">("default");
  const [providerOptions, setProviderOptions] = useState<string[]>(["openai", "ollama", "disabled"]);
  const [modelOptions, setModelOptions] = useState<string[]>([
    "gpt-5-nano",
    "gpt-5-mini",
    "gpt-4.1-nano",
    "gpt-4o-mini"
  ]);

  const [fmpApiKey, setFmpApiKey] = useState("");
  const [fmpApiKeyMasked, setFmpApiKeyMasked] = useState<string | null>(null);
  const [hasFmpApiKey, setHasFmpApiKey] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [envOverride, setEnvOverride] = useState(false);
  const [envOverrideFmp, setEnvOverrideFmp] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [health, setHealth] = useState<ApiKeyHealthResponse | null>(null);
  const [fmpHealthLoading, setFmpHealthLoading] = useState(false);
  const [fmpHealth, setFmpHealth] = useState<ApiKeyHealthResponse | null>(null);

  function applyApiKeysSettings(res: ApiKeysSettingsResponse) {
    const profiles = {
      openai: {
        aiBaseUrl: res.aiProfiles?.openai?.aiBaseUrl ?? "",
        aiModel: res.aiProfiles?.openai?.aiModel ?? "",
        aiApiKeyMasked: res.aiProfiles?.openai?.aiApiKeyMasked ?? res.openaiApiKeyMasked ?? null,
        hasAiApiKey:
          typeof res.aiProfiles?.openai?.hasAiApiKey === "boolean"
            ? Boolean(res.aiProfiles?.openai?.hasAiApiKey)
            : Boolean(res.hasOpenAiApiKey)
      },
      ollama: {
        aiBaseUrl: res.aiProfiles?.ollama?.aiBaseUrl ?? "",
        aiModel: res.aiProfiles?.ollama?.aiModel ?? "",
        aiApiKeyMasked: res.aiProfiles?.ollama?.aiApiKeyMasked ?? null,
        hasAiApiKey: Boolean(res.aiProfiles?.ollama?.hasAiApiKey)
      }
    };
    setAiProfiles(profiles);

    const selectedProvider = (res.aiProvider ?? "openai") as "openai" | "ollama" | "disabled";
    const selectedProfile = selectedProvider === "ollama" ? profiles.ollama : profiles.openai;
    const resolvedAiApiKeyMasked = selectedProfile.aiApiKeyMasked ?? res.aiApiKeyMasked ?? null;
    const resolvedHasAiApiKey = selectedProfile.hasAiApiKey || Boolean(res.hasAiApiKey);

    setAiApiKeyMasked(resolvedAiApiKeyMasked);
    setHasAiApiKey(resolvedHasAiApiKey);
    setFmpApiKeyMasked(res.fmpApiKeyMasked ?? null);
    setHasFmpApiKey(Boolean(res.hasFmpApiKey));
    setUpdatedAt(res.updatedAt ?? null);
    setEnvOverride(Boolean(res.envOverride));
    setEnvOverrideFmp(Boolean(res.envOverrideFmp));

    setAiProvider(selectedProvider);
    setAiBaseUrl(res.aiBaseUrl ?? selectedProfile.aiBaseUrl ?? "");
    setAiModel(res.aiModel ?? selectedProfile.aiModel ?? res.openaiModel ?? "");

    setEffectiveAiProvider((res.effectiveAiProvider ?? "openai") as "openai" | "ollama" | "disabled");
    setEffectiveAiProviderSource(res.effectiveAiProviderSource ?? "default");
    setEffectiveAiBaseUrl(res.effectiveAiBaseUrl ?? "https://api.openai.com/v1");
    setEffectiveAiBaseUrlSource(res.effectiveAiBaseUrlSource ?? "default");
    setEffectiveAiModel(res.effectiveAiModel ?? res.effectiveOpenaiModel ?? "gpt-4o-mini");
    setEffectiveAiModelSource(res.effectiveAiModelSource ?? res.effectiveOpenaiModelSource ?? "default");

    setModelOptions(
      Array.isArray(res.modelOptions) && res.modelOptions.length > 0
        ? res.modelOptions
        : ["gpt-5-nano", "gpt-5-mini", "gpt-4.1-nano", "gpt-4o-mini"]
    );

    setProviderOptions(
      Array.isArray(res.providerOptions) && res.providerOptions.length > 0
        ? res.providerOptions
        : ["openai", "ollama", "disabled"]
    );
  }

  async function loadHealthStatus() {
    setHealthLoading(true);
    try {
      const res = await apiGet<ApiKeyHealthResponse>("/admin/settings/api-keys/status");
      setHealth(res);
    } catch (e) {
      setHealth({
        ok: false,
        status: "error",
        source: "none",
        checkedAt: new Date().toISOString(),
        message: errMsg(e)
      });
    } finally {
      setHealthLoading(false);
    }
  }

  async function loadFmpHealthStatus() {
    setFmpHealthLoading(true);
    try {
      const res = await apiGet<ApiKeyHealthResponse>("/admin/settings/api-keys/fmp-status");
      setFmpHealth(res);
    } catch (e) {
      setFmpHealth({
        ok: false,
        status: "error",
        source: "none",
        checkedAt: new Date().toISOString(),
        message: errMsg(e)
      });
    } finally {
      setFmpHealthLoading(false);
    }
  }

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

      const res = await apiGet<ApiKeysSettingsResponse>("/admin/settings/api-keys");
      applyApiKeysSettings(res);
      setAiApiKey("");
      setFmpApiKey("");
      await loadHealthStatus();
      await loadFmpHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveAiKey() {
    const trimmed = aiApiKey.trim();
    if (!trimmed) {
      setError(t("messages.aiKeyRequired"));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        aiApiKey: trimmed,
        clearAiApiKey: false
      });
      setAiApiKey("");
      applyApiKeysSettings(res);
      setNotice(t("messages.aiKeySaved"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function clearAiKey() {
    const confirmed = window.confirm(t("messages.confirmClearAi"));
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        clearAiApiKey: true
      });
      setAiApiKey("");
      applyApiKeysSettings(res);
      setNotice(t("messages.aiKeyRemoved"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function saveAiProviderAndBaseUrl() {
    setError(null);
    setNotice(null);
    try {
      const trimmedBaseUrl = aiBaseUrl.trim();
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        aiBaseUrl: trimmedBaseUrl || undefined,
        clearAiBaseUrl: !trimmedBaseUrl
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.aiProviderSaved"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function saveAiModel() {
    const trimmed = aiModel.trim();
    if (!trimmed) {
      setError(t("messages.aiModelRequired"));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        aiModel: trimmed,
        clearAiModel: false
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.aiModelSaved"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function resetAiModel() {
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        clearAiModel: true
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.aiModelReset"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function saveFmpKey() {
    const trimmed = fmpApiKey.trim();
    if (!trimmed) {
      setError(t("messages.fmpKeyRequired"));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        fmpApiKey: trimmed,
        clearFmpApiKey: false
      });
      setFmpApiKey("");
      applyApiKeysSettings(res);
      setNotice(t("messages.fmpKeySaved"));
      await loadFmpHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function clearFmpKey() {
    const confirmed = window.confirm(t("messages.confirmClearFmp"));
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        clearFmpApiKey: true
      });
      setFmpApiKey("");
      applyApiKeysSettings(res);
      setNotice(t("messages.fmpKeyRemoved"));
      await loadFmpHealthStatus();
    } catch (e) {
      setError(errMsg(e));
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
      <div className="adminPageIntro">{t("subtitle")}</div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">{error}</div>
      ) : null}
      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div>
      ) : null}

      {isSuperadmin ? (
        <>
          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("ai.sectionTitle")}</h3>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("storedKey")}: {hasAiApiKey ? t("yes") : t("no")}
              {aiApiKeyMasked ? ` · ${aiApiKeyMasked}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("lastUpdated")}: {updatedAt ? new Date(updatedAt).toLocaleString() : t("never")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <span
                className={`badge ${
                  health?.status === "ok"
                    ? "badgeOk"
                    : health?.status === "missing_key"
                      ? "badgeWarn"
                      : "badgeDanger"
                }`}
                title={health?.message ?? t("statusNotChecked")}
              >
                {t("ai.statusLabel")}: {" "}
                {healthLoading
                  ? t("checking")
                  : health?.status === "ok"
                    ? "OK"
                    : health?.status === "missing_key"
                      ? t("missingKey")
                      : t("errorStatus")}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("source")}: {health?.source ?? (envOverride ? "env" : hasAiApiKey ? "db" : "none")}
                {typeof health?.latencyMs === "number" ? ` · ${health.latencyMs}ms` : ""}
                {health?.checkedAt ? ` · ${t("checked")} ${new Date(health.checkedAt).toLocaleString()}` : ""}
              </span>
              <button className="btn" type="button" onClick={() => void loadHealthStatus()} disabled={healthLoading}>
                {healthLoading ? t("checkingButton") : t("refreshStatus")}
              </button>
            </div>
            {health?.message ? (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{health.message}</div>
            ) : null}

            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.currentProvider")}</span>
              <div>{health?.provider ?? effectiveAiProvider}</div>
              <span className={`badge ${effectiveAiProviderSource === "env" ? "badgeWarn" : effectiveAiProviderSource === "db" ? "badgeOk" : "badge"}`}>
                {effectiveAiProviderSource.toUpperCase()}
              </span>
            </div>

            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.currentBaseUrl")}</span>
              <div style={{ wordBreak: "break-all" }}>{health?.baseUrl ?? effectiveAiBaseUrl}</div>
              <span className={`badge ${effectiveAiBaseUrlSource === "env" ? "badgeWarn" : effectiveAiBaseUrlSource === "db" ? "badgeOk" : "badge"}`}>
                {effectiveAiBaseUrlSource.toUpperCase()}
              </span>
            </div>

            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.currentModel")}</span>
              <div>{health?.model ?? effectiveAiModel}</div>
              <span className={`badge ${effectiveAiModelSource === "env" ? "badgeWarn" : effectiveAiModelSource === "db" ? "badgeOk" : "badge"}`}>
                {effectiveAiModelSource.toUpperCase()}
              </span>
            </div>

            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.providerLabel")}</span>
              <select
                className="select"
                value={aiProvider}
                onChange={(e) => {
                  const nextProvider = e.target.value as "openai" | "ollama" | "disabled";
                  setAiProvider(nextProvider);
                  const profile = nextProvider === "ollama" ? aiProfiles.ollama : aiProfiles.openai;
                  setAiBaseUrl(profile.aiBaseUrl ?? "");
                  setAiModel(profile.aiModel ?? "");
                  setAiApiKeyMasked(profile.aiApiKeyMasked ?? null);
                  setHasAiApiKey(Boolean(profile.hasAiApiKey));
                }}
              >
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>{provider}</option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.baseUrlLabel")}</span>
              <input
                className="input"
                type="text"
                placeholder="https://api.openai.com/v1"
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
              />
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button className="btn btnPrimary" onClick={() => void saveAiProviderAndBaseUrl()}>
                {t("ai.providerSave")}
              </button>
            </div>

            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.modelLabel")}</span>
              <input
                className="input"
                type="text"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                list="ai-model-presets"
                placeholder={t("ai.modelPlaceholder")}
              />
              <datalist id="ai-model-presets">
                {modelOptions.map((model) => <option key={model} value={model} />)}
              </datalist>
            </label>

            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{t("ai.modelOptionsHint")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button className="btn btnPrimary" onClick={() => void saveAiModel()}>
                {t("ai.modelSave")}
              </button>
              <button className="btn" onClick={() => void resetAiModel()}>
                {t("ai.modelReset")}
              </button>
            </div>

            {envOverride ? (
              <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 10 }}>{t("ai.envOverrideHint")}</div>
            ) : null}

            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.newKey")}</span>
              <input
                className="input"
                type="password"
                placeholder="sk-... / ollama"
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btnPrimary" onClick={() => void saveAiKey()}>
                {t("ai.save")}
              </button>
              <button className="btn btnStop" onClick={() => void clearAiKey()} disabled={!hasAiApiKey}>
                {t("removeStoredKey")}
              </button>
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("fmp.sectionTitle")}</h3>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("storedKey")}: {hasFmpApiKey ? t("yes") : t("no")}
              {fmpApiKeyMasked ? ` · ${fmpApiKeyMasked}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("lastUpdated")}: {updatedAt ? new Date(updatedAt).toLocaleString() : t("never")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <span
                className={`badge ${
                  fmpHealth?.status === "ok"
                    ? "badgeOk"
                    : fmpHealth?.status === "missing_key"
                      ? "badgeWarn"
                      : "badgeDanger"
                }`}
                title={fmpHealth?.message ?? t("statusNotChecked")}
              >
                {t("fmp.statusLabel")}: {" "}
                {fmpHealthLoading
                  ? t("checking")
                  : fmpHealth?.status === "ok"
                    ? "OK"
                    : fmpHealth?.status === "missing_key"
                      ? t("missingKey")
                      : t("errorStatus")}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("source")}: {fmpHealth?.source ?? (envOverrideFmp ? "env" : hasFmpApiKey ? "db" : "none")}
                {typeof fmpHealth?.latencyMs === "number" ? ` · ${fmpHealth.latencyMs}ms` : ""}
                {fmpHealth?.checkedAt ? ` · ${t("checked")} ${new Date(fmpHealth.checkedAt).toLocaleString()}` : ""}
              </span>
              <button className="btn" type="button" onClick={() => void loadFmpHealthStatus()} disabled={fmpHealthLoading}>
                {fmpHealthLoading ? t("checkingButton") : t("refreshStatus")}
              </button>
            </div>
            {fmpHealth?.message ? (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{fmpHealth.message}</div>
            ) : null}
            {envOverrideFmp ? (
              <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 10 }}>{t("fmp.envOverrideHint")}</div>
            ) : null}
            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fmp.newKey")}</span>
              <input
                className="input"
                type="password"
                placeholder="fmp_..."
                value={fmpApiKey}
                onChange={(e) => setFmpApiKey(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btnPrimary" onClick={() => void saveFmpKey()}>
                {t("fmp.save")}
              </button>
              <button className="btn btnStop" onClick={() => void clearFmpKey()} disabled={!hasFmpApiKey}>
                {t("removeStoredKey")}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
