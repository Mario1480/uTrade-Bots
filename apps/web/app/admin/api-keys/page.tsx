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
  openaiApiKeyMasked: string | null;
  hasOpenAiApiKey: boolean;
  fmpApiKeyMasked: string | null;
  hasFmpApiKey: boolean;
  openaiModel: string | null;
  effectiveOpenaiModel: string;
  effectiveOpenaiModelSource: "db" | "env" | "default";
  modelOptions: string[];
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
};

export default function AdminApiKeysPage() {
  const t = useTranslations("admin.apiKeys");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiApiKeyMasked, setOpenaiApiKeyMasked] = useState<string | null>(null);
  const [hasOpenAiApiKey, setHasOpenAiApiKey] = useState(false);
  const [openaiModel, setOpenaiModel] = useState<string>("");
  const [effectiveOpenaiModel, setEffectiveOpenaiModel] = useState<string>("gpt-4o-mini");
  const [effectiveOpenaiModelSource, setEffectiveOpenaiModelSource] = useState<"db" | "env" | "default">("default");
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
  const modelSourceBadgeClass =
    effectiveOpenaiModelSource === "db"
      ? "badgeOk"
      : effectiveOpenaiModelSource === "env"
        ? "badgeWarn"
        : "badge";
  const modelSourceBadgeLabel =
    effectiveOpenaiModelSource === "db"
      ? "DB"
      : effectiveOpenaiModelSource === "env"
        ? "ENV"
        : "DEFAULT";

  function applyApiKeysSettings(res: ApiKeysSettingsResponse) {
    setOpenaiApiKeyMasked(res.openaiApiKeyMasked ?? null);
    setHasOpenAiApiKey(Boolean(res.hasOpenAiApiKey));
    setFmpApiKeyMasked(res.fmpApiKeyMasked ?? null);
    setHasFmpApiKey(Boolean(res.hasFmpApiKey));
    setUpdatedAt(res.updatedAt ?? null);
    setEnvOverride(Boolean(res.envOverride));
    setEnvOverrideFmp(Boolean(res.envOverrideFmp));
    setOpenaiModel(res.openaiModel ?? "");
    setEffectiveOpenaiModel(res.effectiveOpenaiModel);
    setEffectiveOpenaiModelSource(res.effectiveOpenaiModelSource);
    setModelOptions(
      Array.isArray(res.modelOptions) && res.modelOptions.length > 0
        ? res.modelOptions
        : ["gpt-5-nano", "gpt-5-mini", "gpt-4.1-nano", "gpt-4o-mini"]
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
      setOpenaiApiKey("");
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

  async function saveOpenAiKey() {
    const trimmed = openaiApiKey.trim();
    if (!trimmed) {
      setError(t("messages.openAiKeyRequired"));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        openaiApiKey: trimmed,
        clearOpenaiApiKey: false
      });
      setOpenaiApiKey("");
      applyApiKeysSettings(res);
      setNotice(t("messages.openAiKeySaved"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function clearOpenAiKey() {
    const confirmed = window.confirm(t("messages.confirmClearOpenAi"));
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        clearOpenaiApiKey: true
      });
      setOpenaiApiKey("");
      applyApiKeysSettings(res);
      setNotice(t("messages.openAiKeyRemoved"));
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

  async function saveOpenAiModel() {
    if (!openaiModel) {
      setError(t("messages.openAiModelRequired"));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        openaiModel,
        clearOpenaiModel: false
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.openAiModelSaved"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function resetOpenAiModel() {
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        clearOpenaiModel: true
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.openAiModelReset"));
      await loadHealthStatus();
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
      <div className="adminPageIntro">
        {t("subtitle")}
      </div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">
          {notice}
        </div>
      ) : null}

      {isSuperadmin ? (
        <>
          <section className="card settingsSection">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{t("openAi.sectionTitle")}</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {t("storedKey")}: {hasOpenAiApiKey ? t("yes") : t("no")}
            {openaiApiKeyMasked ? ` · ${openaiApiKeyMasked}` : ""}
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
              {t("openAi.statusLabel")}:{" "}
              {healthLoading
                ? t("checking")
                : health?.status === "ok"
                  ? "OK"
                  : health?.status === "missing_key"
                    ? t("missingKey")
                    : t("errorStatus")}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("source")}: {health?.source ?? (envOverride ? "env" : hasOpenAiApiKey ? "db" : "none")}
              {typeof health?.latencyMs === "number" ? ` · ${health.latencyMs}ms` : ""}
              {health?.checkedAt ? ` · ${t("checked")} ${new Date(health.checkedAt).toLocaleString()}` : ""}
            </span>
            <button className="btn" type="button" onClick={() => void loadHealthStatus()} disabled={healthLoading}>
              {healthLoading ? t("checkingButton") : t("refreshStatus")}
            </button>
          </div>
          {health?.message ? (
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              {health.message}
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {t("openAi.currentModel")}: {health?.model ?? effectiveOpenaiModel}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("openAi.currentModelSource")}:
            </span>
            <span className={`badge ${modelSourceBadgeClass}`}>{modelSourceBadgeLabel}</span>
          </div>
          <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("openAi.modelLabel")}</span>
            <select
              className="select"
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
            >
              <option value="">{t("openAi.modelPlaceholder")}</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            {t("openAi.modelOptionsHint")}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button className="btn btnPrimary" onClick={() => void saveOpenAiModel()}>
              {t("openAi.modelSave")}
            </button>
            <button className="btn" onClick={() => void resetOpenAiModel()}>
              {t("openAi.modelReset")}
            </button>
          </div>
          {envOverride ? (
            <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 10 }}>
              {t("openAi.envOverrideHint")}
            </div>
          ) : null}
          <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("openAi.newKey")}</span>
            <input
              className="input"
              type="password"
              placeholder="sk-proj-..."
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btnPrimary" onClick={() => void saveOpenAiKey()}>
              {t("openAi.save")}
            </button>
            <button className="btn btnStop" onClick={() => void clearOpenAiKey()} disabled={!hasOpenAiApiKey}>
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
              {t("fmp.statusLabel")}:{" "}
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
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              {fmpHealth.message}
            </div>
          ) : null}
          {envOverrideFmp ? (
            <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 10 }}>
              {t("fmp.envOverrideHint")}
            </div>
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
