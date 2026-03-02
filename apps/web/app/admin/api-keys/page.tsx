"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
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
      saladRuntime?: {
        apiBaseUrl?: string | null;
        organization?: string | null;
        project?: string | null;
        container?: string | null;
      };
    };
    ollama?: {
      aiBaseUrl?: string | null;
      aiModel?: string | null;
      aiApiKeyMasked?: string | null;
      hasAiApiKey?: boolean;
      saladRuntime?: {
        apiBaseUrl?: string | null;
        organization?: string | null;
        project?: string | null;
        container?: string | null;
      };
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
  ccpay?: {
    appIdMasked?: string | null;
    hasAppId?: boolean;
    appSecretMasked?: string | null;
    hasAppSecret?: boolean;
    baseUrl?: string | null;
    priceFiatId?: string | null;
    webBaseUrl?: string | null;
  };
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
  envOverrideCcpay?: boolean;
};

type SaladRuntimeState = "running" | "stopped" | "starting" | "stopping" | "error" | "unknown";

type SaladRuntimeResponse = {
  ok: boolean;
  state: SaladRuntimeState;
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  message: string;
  source?: "env" | "db" | "none";
  target?: {
    apiBaseUrl?: string;
    organization?: string;
    project?: string;
    container?: string;
  };
  error?: string;
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

type CcpayHealthResponse = {
  ok: boolean;
  status: "ok" | "missing_config" | "error";
  source: "db" | "env" | "default";
  checkedAt: string;
  message: string;
  baseUrl?: string;
  priceFiatId?: string;
  webBaseUrl?: string;
  hasAppId?: boolean;
  hasAppSecret?: boolean;
  missingFields?: string[];
  sources?: {
    appId?: "db" | "env" | "default" | "none";
    appSecret?: "db" | "env" | "default" | "none";
    baseUrl?: "db" | "env" | "default" | "none";
    priceFiatId?: "db" | "env" | "default" | "none";
    webBaseUrl?: "db" | "env" | "default" | "none";
  };
};

const DEFAULT_SALAD_API_BASE_URL = "https://api.salad.com/api/public";

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
    openai: {
      aiBaseUrl: string;
      aiModel: string;
      aiApiKeyMasked: string | null;
      hasAiApiKey: boolean;
      saladRuntime: { apiBaseUrl: string; organization: string; project: string; container: string };
    };
    ollama: {
      aiBaseUrl: string;
      aiModel: string;
      aiApiKeyMasked: string | null;
      hasAiApiKey: boolean;
      saladRuntime: { apiBaseUrl: string; organization: string; project: string; container: string };
    };
  }>({
    openai: {
      aiBaseUrl: "",
      aiModel: "",
      aiApiKeyMasked: null,
      hasAiApiKey: false,
      saladRuntime: {
        apiBaseUrl: DEFAULT_SALAD_API_BASE_URL,
        organization: "",
        project: "",
        container: ""
      }
    },
    ollama: {
      aiBaseUrl: "",
      aiModel: "",
      aiApiKeyMasked: null,
      hasAiApiKey: false,
      saladRuntime: {
        apiBaseUrl: DEFAULT_SALAD_API_BASE_URL,
        organization: "",
        project: "",
        container: ""
      }
    }
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
  const [ccpayAppId, setCcpayAppId] = useState("");
  const [ccpayAppSecret, setCcpayAppSecret] = useState("");
  const [ccpayAppIdMasked, setCcpayAppIdMasked] = useState<string | null>(null);
  const [ccpayAppSecretMasked, setCcpayAppSecretMasked] = useState<string | null>(null);
  const [hasCcpayAppId, setHasCcpayAppId] = useState(false);
  const [hasCcpayAppSecret, setHasCcpayAppSecret] = useState(false);
  const [ccpayBaseUrl, setCcpayBaseUrl] = useState("https://ccpayment.com");
  const [ccpayPriceFiatId, setCcpayPriceFiatId] = useState("1033");
  const [ccpayWebBaseUrl, setCcpayWebBaseUrl] = useState("http://localhost:3000");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [envOverride, setEnvOverride] = useState(false);
  const [envOverrideFmp, setEnvOverrideFmp] = useState(false);
  const [envOverrideCcpay, setEnvOverrideCcpay] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [health, setHealth] = useState<ApiKeyHealthResponse | null>(null);
  const [fmpHealthLoading, setFmpHealthLoading] = useState(false);
  const [fmpHealth, setFmpHealth] = useState<ApiKeyHealthResponse | null>(null);
  const [ccpayHealthLoading, setCcpayHealthLoading] = useState(false);
  const [ccpayHealth, setCcpayHealth] = useState<CcpayHealthResponse | null>(null);
  const [saladRuntimeConfig, setSaladRuntimeConfig] = useState<{
    apiBaseUrl: string;
    organization: string;
    project: string;
    container: string;
  }>({
    apiBaseUrl: DEFAULT_SALAD_API_BASE_URL,
    organization: "",
    project: "",
    container: ""
  });
  const [saladRuntimeStatus, setSaladRuntimeStatus] = useState<SaladRuntimeResponse | null>(null);
  const [saladActionLoading, setSaladActionLoading] = useState<
    "none" | "save" | "status" | "start" | "stop"
  >("none");

  function applyApiKeysSettings(res: ApiKeysSettingsResponse) {
    const profiles = {
      openai: {
        aiBaseUrl: res.aiProfiles?.openai?.aiBaseUrl ?? "",
        aiModel: res.aiProfiles?.openai?.aiModel ?? "",
        aiApiKeyMasked: res.aiProfiles?.openai?.aiApiKeyMasked ?? res.openaiApiKeyMasked ?? null,
        hasAiApiKey:
          typeof res.aiProfiles?.openai?.hasAiApiKey === "boolean"
            ? Boolean(res.aiProfiles?.openai?.hasAiApiKey)
            : Boolean(res.hasOpenAiApiKey),
        saladRuntime: {
          apiBaseUrl: res.aiProfiles?.openai?.saladRuntime?.apiBaseUrl ?? DEFAULT_SALAD_API_BASE_URL,
          organization: res.aiProfiles?.openai?.saladRuntime?.organization ?? "",
          project: res.aiProfiles?.openai?.saladRuntime?.project ?? "",
          container: res.aiProfiles?.openai?.saladRuntime?.container ?? ""
        }
      },
      ollama: {
        aiBaseUrl: res.aiProfiles?.ollama?.aiBaseUrl ?? "",
        aiModel: res.aiProfiles?.ollama?.aiModel ?? "",
        aiApiKeyMasked: res.aiProfiles?.ollama?.aiApiKeyMasked ?? null,
        hasAiApiKey: Boolean(res.aiProfiles?.ollama?.hasAiApiKey),
        saladRuntime: {
          apiBaseUrl: res.aiProfiles?.ollama?.saladRuntime?.apiBaseUrl ?? DEFAULT_SALAD_API_BASE_URL,
          organization: res.aiProfiles?.ollama?.saladRuntime?.organization ?? "",
          project: res.aiProfiles?.ollama?.saladRuntime?.project ?? "",
          container: res.aiProfiles?.ollama?.saladRuntime?.container ?? ""
        }
      }
    };
    setAiProfiles(profiles);
    setSaladRuntimeConfig({
      apiBaseUrl: profiles.ollama.saladRuntime.apiBaseUrl || DEFAULT_SALAD_API_BASE_URL,
      organization: profiles.ollama.saladRuntime.organization,
      project: profiles.ollama.saladRuntime.project,
      container: profiles.ollama.saladRuntime.container
    });

    const selectedProvider = (res.aiProvider ?? "openai") as "openai" | "ollama" | "disabled";
    const selectedProfile = selectedProvider === "ollama" ? profiles.ollama : profiles.openai;
    const resolvedAiApiKeyMasked = selectedProfile.aiApiKeyMasked ?? res.aiApiKeyMasked ?? null;
    const resolvedHasAiApiKey = selectedProfile.hasAiApiKey || Boolean(res.hasAiApiKey);

    setAiApiKeyMasked(resolvedAiApiKeyMasked);
    setHasAiApiKey(resolvedHasAiApiKey);
    setFmpApiKeyMasked(res.fmpApiKeyMasked ?? null);
    setHasFmpApiKey(Boolean(res.hasFmpApiKey));
    setCcpayAppIdMasked(res.ccpay?.appIdMasked ?? null);
    setCcpayAppSecretMasked(res.ccpay?.appSecretMasked ?? null);
    setHasCcpayAppId(Boolean(res.ccpay?.hasAppId));
    setHasCcpayAppSecret(Boolean(res.ccpay?.hasAppSecret));
    setCcpayBaseUrl(res.ccpay?.baseUrl ?? "https://ccpayment.com");
    setCcpayPriceFiatId(res.ccpay?.priceFiatId ?? "1033");
    setCcpayWebBaseUrl(res.ccpay?.webBaseUrl ?? "http://localhost:3000");
    setUpdatedAt(res.updatedAt ?? null);
    setEnvOverride(Boolean(res.envOverride));
    setEnvOverrideFmp(Boolean(res.envOverrideFmp));
    setEnvOverrideCcpay(Boolean(res.envOverrideCcpay));

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

  async function loadCcpayHealthStatus() {
    setCcpayHealthLoading(true);
    try {
      const res = await apiGet<CcpayHealthResponse>("/admin/settings/api-keys/ccpay-status");
      setCcpayHealth(res);
    } catch (e) {
      setCcpayHealth({
        ok: false,
        status: "error",
        source: "default",
        checkedAt: new Date().toISOString(),
        message: errMsg(e)
      });
    } finally {
      setCcpayHealthLoading(false);
    }
  }

  async function loadSaladRuntimeStatus() {
    setSaladActionLoading("status");
    try {
      const res = await apiGet<SaladRuntimeResponse>("/admin/settings/api-keys/salad-runtime/status");
      setSaladRuntimeStatus(res);
    } catch (e) {
      setSaladRuntimeStatus({
        ok: false,
        state: "error",
        checkedAt: new Date().toISOString(),
        message: errMsg(e)
      });
    } finally {
      setSaladActionLoading("none");
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
      setCcpayAppId("");
      setCcpayAppSecret("");
      setSaladRuntimeStatus(null);
      await loadHealthStatus();
      await loadFmpHealthStatus();
      await loadCcpayHealthStatus();
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

  async function saveCcpaySettings() {
    setError(null);
    setNotice(null);
    const appId = ccpayAppId.trim();
    const appSecret = ccpayAppSecret.trim();
    const baseUrl = ccpayBaseUrl.trim();
    const priceFiatId = ccpayPriceFiatId.trim();
    const webBaseUrl = ccpayWebBaseUrl.trim();

    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        ...(appId ? { ccpayAppId: appId, clearCcpayAppId: false } : {}),
        ...(appSecret ? { ccpayAppSecret: appSecret, clearCcpayAppSecret: false } : {}),
        ccpayBaseUrl: baseUrl || undefined,
        clearCcpayBaseUrl: !baseUrl,
        ccpayPriceFiatId: priceFiatId || undefined,
        clearCcpayPriceFiatId: !priceFiatId,
        ccpayWebBaseUrl: webBaseUrl || undefined,
        clearCcpayWebBaseUrl: !webBaseUrl
      });
      setCcpayAppId("");
      setCcpayAppSecret("");
      applyApiKeysSettings(res);
      setNotice(t("messages.ccpaySaved"));
      await loadCcpayHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function clearCcpayAppIdValue() {
    const confirmed = window.confirm(t("messages.confirmClearCcpayAppId"));
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        clearCcpayAppId: true
      });
      setCcpayAppId("");
      applyApiKeysSettings(res);
      setNotice(t("messages.ccpayAppIdRemoved"));
      await loadCcpayHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function clearCcpayAppSecretValue() {
    const confirmed = window.confirm(t("messages.confirmClearCcpayAppSecret"));
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        clearCcpayAppSecret: true
      });
      setCcpayAppSecret("");
      applyApiKeysSettings(res);
      setNotice(t("messages.ccpayAppSecretRemoved"));
      await loadCcpayHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function saveSaladRuntimeConfig() {
    setError(null);
    setNotice(null);
    setSaladActionLoading("save");
    try {
      const apiBaseUrl = saladRuntimeConfig.apiBaseUrl.trim();
      const organization = saladRuntimeConfig.organization.trim();
      const project = saladRuntimeConfig.project.trim();
      const container = saladRuntimeConfig.container.trim();
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        saladApiBaseUrl: apiBaseUrl || undefined,
        clearSaladApiBaseUrl: !apiBaseUrl,
        saladOrganization: organization || undefined,
        clearSaladOrganization: !organization,
        saladProject: project || undefined,
        clearSaladProject: !project,
        saladContainer: container || undefined,
        clearSaladContainer: !container
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.saladRuntimeSaved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaladActionLoading("none");
    }
  }

  async function startSaladRuntime() {
    setError(null);
    setNotice(null);
    setSaladActionLoading("start");
    try {
      const res = await apiPost<SaladRuntimeResponse>("/admin/settings/api-keys/salad-runtime/start");
      setSaladRuntimeStatus(res);
      setNotice(t("messages.saladRuntimeStarted"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaladActionLoading("none");
    }
  }

  async function stopSaladRuntime() {
    const confirmed = window.confirm(t("messages.confirmStopSaladRuntime"));
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    setSaladActionLoading("stop");
    try {
      const res = await apiPost<SaladRuntimeResponse>("/admin/settings/api-keys/salad-runtime/stop");
      setSaladRuntimeStatus(res);
      setNotice(t("messages.saladRuntimeStopped"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaladActionLoading("none");
    }
  }

  const hasSaladRuntimeConfig = Boolean(
    saladRuntimeConfig.organization.trim()
    || saladRuntimeConfig.project.trim()
    || saladRuntimeConfig.container.trim()
    || saladRuntimeConfig.apiBaseUrl.trim()
  );
  const showSaladRuntimeSection = aiProvider === "ollama" || hasSaladRuntimeConfig;
  const saladStatusBadgeClass =
    saladRuntimeStatus?.state === "running"
      ? "badgeOk"
      : saladRuntimeStatus?.state === "starting" || saladRuntimeStatus?.state === "stopping"
        ? "badgeWarn"
        : saladRuntimeStatus?.state === "stopped"
          ? "badge"
          : "badgeDanger";
  const saladActionBusy = saladActionLoading !== "none";

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
                  if (nextProvider === "ollama") {
                    setSaladRuntimeConfig({
                      apiBaseUrl: aiProfiles.ollama.saladRuntime.apiBaseUrl || DEFAULT_SALAD_API_BASE_URL,
                      organization: aiProfiles.ollama.saladRuntime.organization,
                      project: aiProfiles.ollama.saladRuntime.project,
                      container: aiProfiles.ollama.saladRuntime.container
                    });
                  }
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

            {showSaladRuntimeSection ? (
              <section
                style={{
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: "1px solid rgba(255, 193, 7, 0.2)"
                }}
              >
                <div className="settingsSectionHeader" style={{ marginBottom: 8 }}>
                  <h4 style={{ margin: 0 }}>{t("ai.saladRuntime.sectionTitle")}</h4>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                  {t("ai.saladRuntime.hint")}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <span className={`badge ${saladStatusBadgeClass}`}>
                    {t("ai.saladRuntime.statusLabel")}:{" "}
                    {saladActionLoading === "status"
                      ? t("checking")
                      : t(`ai.saladRuntime.states.${saladRuntimeStatus?.state ?? "unknown"}`)}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {saladRuntimeStatus?.checkedAt
                      ? `${t("checked")} ${new Date(saladRuntimeStatus.checkedAt).toLocaleString()}`
                      : t("statusNotChecked")}
                    {typeof saladRuntimeStatus?.latencyMs === "number"
                      ? ` · ${saladRuntimeStatus.latencyMs}ms`
                      : ""}
                  </span>
                </div>
                {saladRuntimeStatus?.message ? (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                    {saladRuntimeStatus.message}
                  </div>
                ) : null}

                <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.saladRuntime.apiBaseUrlLabel")}</span>
                  <input
                    className="input"
                    type="text"
                    value={saladRuntimeConfig.apiBaseUrl}
                    placeholder={DEFAULT_SALAD_API_BASE_URL}
                    onChange={(e) =>
                      setSaladRuntimeConfig((prev) => ({
                        ...prev,
                        apiBaseUrl: e.target.value
                      }))
                    }
                  />
                </label>
                <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.saladRuntime.organizationLabel")}</span>
                  <input
                    className="input"
                    type="text"
                    value={saladRuntimeConfig.organization}
                    placeholder="your-organization"
                    onChange={(e) =>
                      setSaladRuntimeConfig((prev) => ({
                        ...prev,
                        organization: e.target.value
                      }))
                    }
                  />
                </label>
                <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.saladRuntime.projectLabel")}</span>
                  <input
                    className="input"
                    type="text"
                    value={saladRuntimeConfig.project}
                    placeholder="your-project"
                    onChange={(e) =>
                      setSaladRuntimeConfig((prev) => ({
                        ...prev,
                        project: e.target.value
                      }))
                    }
                  />
                </label>
                <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.saladRuntime.containerLabel")}</span>
                  <input
                    className="input"
                    type="text"
                    value={saladRuntimeConfig.container}
                    placeholder="your-container"
                    onChange={(e) =>
                      setSaladRuntimeConfig((prev) => ({
                        ...prev,
                        container: e.target.value
                      }))
                    }
                  />
                </label>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn btnPrimary"
                    onClick={() => void saveSaladRuntimeConfig()}
                    disabled={saladActionBusy}
                  >
                    {saladActionLoading === "save"
                      ? t("checkingButton")
                      : t("ai.saladRuntime.saveConfig")}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void loadSaladRuntimeStatus()}
                    disabled={saladActionBusy}
                  >
                    {saladActionLoading === "status"
                      ? t("checkingButton")
                      : t("ai.saladRuntime.refreshStatus")}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void startSaladRuntime()}
                    disabled={saladActionBusy}
                  >
                    {saladActionLoading === "start"
                      ? t("checkingButton")
                      : t("ai.saladRuntime.start")}
                  </button>
                  <button
                    className="btn btnStop"
                    type="button"
                    onClick={() => void stopSaladRuntime()}
                    disabled={saladActionBusy}
                  >
                    {saladActionLoading === "stop"
                      ? t("checkingButton")
                      : t("ai.saladRuntime.stop")}
                  </button>
                </div>
              </section>
            ) : null}
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

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("ccpay.sectionTitle")}</h3>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("ccpay.storedAppId")}: {hasCcpayAppId ? t("yes") : t("no")}
              {ccpayAppIdMasked ? ` · ${ccpayAppIdMasked}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("ccpay.storedAppSecret")}: {hasCcpayAppSecret ? t("yes") : t("no")}
              {ccpayAppSecretMasked ? ` · ${ccpayAppSecretMasked}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("lastUpdated")}: {updatedAt ? new Date(updatedAt).toLocaleString() : t("never")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <span
                className={`badge ${
                  ccpayHealth?.status === "ok"
                    ? "badgeOk"
                    : ccpayHealth?.status === "missing_config"
                      ? "badgeWarn"
                      : "badgeDanger"
                }`}
                title={ccpayHealth?.message ?? t("statusNotChecked")}
              >
                {t("ccpay.statusLabel")}:{" "}
                {ccpayHealthLoading
                  ? t("checking")
                  : ccpayHealth?.status === "ok"
                    ? "OK"
                    : ccpayHealth?.status === "missing_config"
                      ? t("ccpay.missingConfig")
                      : t("errorStatus")}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("source")}: {ccpayHealth?.source ?? "default"}
                {ccpayHealth?.checkedAt ? ` · ${t("checked")} ${new Date(ccpayHealth.checkedAt).toLocaleString()}` : ""}
              </span>
              <button className="btn" type="button" onClick={() => void loadCcpayHealthStatus()} disabled={ccpayHealthLoading}>
                {ccpayHealthLoading ? t("checkingButton") : t("refreshStatus")}
              </button>
            </div>
            {ccpayHealth?.message ? (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{ccpayHealth.message}</div>
            ) : null}
            {Array.isArray(ccpayHealth?.missingFields) && ccpayHealth?.missingFields.length ? (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                {t("ccpay.missingFields")}: {ccpayHealth.missingFields.join(", ")}
              </div>
            ) : null}
            {envOverrideCcpay ? (
              <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 10 }}>{t("ccpay.envOverrideHint")}</div>
            ) : null}

            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ccpay.appIdLabel")}</span>
              <input
                className="input"
                type="password"
                placeholder="ccpay app id"
                value={ccpayAppId}
                onChange={(e) => setCcpayAppId(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ccpay.appSecretLabel")}</span>
              <input
                className="input"
                type="password"
                placeholder="ccpay app secret"
                value={ccpayAppSecret}
                onChange={(e) => setCcpayAppSecret(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ccpay.baseUrlLabel")}</span>
              <input
                className="input"
                type="text"
                placeholder="https://ccpayment.com"
                value={ccpayBaseUrl}
                onChange={(e) => setCcpayBaseUrl(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ccpay.priceFiatIdLabel")}</span>
              <input
                className="input"
                type="text"
                placeholder="1033"
                value={ccpayPriceFiatId}
                onChange={(e) => setCcpayPriceFiatId(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ccpay.webBaseUrlLabel")}</span>
              <input
                className="input"
                type="text"
                placeholder="http://localhost:3000"
                value={ccpayWebBaseUrl}
                onChange={(e) => setCcpayWebBaseUrl(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btnPrimary" onClick={() => void saveCcpaySettings()}>
                {t("ccpay.save")}
              </button>
              <button className="btn btnStop" onClick={() => void clearCcpayAppIdValue()} disabled={!hasCcpayAppId}>
                {t("ccpay.clearAppId")}
              </button>
              <button className="btn btnStop" onClick={() => void clearCcpayAppSecretValue()} disabled={!hasCcpayAppSecret}>
                {t("ccpay.clearAppSecret")}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
