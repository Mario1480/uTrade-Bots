"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../lib/api";
import { LOCALE_COOKIE_NAME, withLocalePath, type AppLocale } from "../../i18n/config";

type MeResponse = {
  user: { id: string; email: string };
  isSuperadmin?: boolean;
  hasAdminBackendAccess?: boolean;
};

type ExchangeAccountItem = {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  marketDataExchangeAccountId?: string | null;
  marketDataExchange?: string | null;
  marketDataLabel?: string | null;
  futuresBudget?: {
    equity: number | null;
    availableMargin: number | null;
    marginCoin: string | null;
  } | null;
  lastSyncError?: {
    at: string | null;
    message: string | null;
  } | null;
};

type ExchangeSyncResponse = {
  ok: boolean;
  message: string;
  syncedAt: string;
  pnlTodayUsd?: number | null;
  spotBudget?: {
    total: number | null;
    available: number | null;
    currency: string | null;
  } | null;
  futuresBudget?: {
    equity: number | null;
    availableMargin: number | null;
    marginCoin: string | null;
  };
};

type ExchangeOption = {
  value: string;
  label: string;
  enabled: boolean;
};

type SettingsAccordionKey = "exchange_settings" | "security" | "notifications" | "license_management" | "language";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function errMsgWithDetails(e: unknown): string {
  if (e instanceof ApiError) {
    const detail = typeof e.payload === "object" && e.payload && "details" in e.payload
      ? String((e.payload as { details?: unknown }).details ?? "")
      : "";
    return detail ? `${e.message} — ${detail} (HTTP ${e.status})` : `${e.message} (HTTP ${e.status})`;
  }
  if (e && typeof e === "object" && "message" in e) return String((e as { message?: unknown }).message ?? e);
  return String(e);
}

export default function SettingsPage() {
  const tMain = useTranslations("system.settingsMain");
  const tRisk = useTranslations("system.settingsRisk");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [hasAdminBackendAccess, setHasAdminBackendAccess] = useState(false);
  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [exchangeOptions, setExchangeOptions] = useState<ExchangeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverIpAddress, setServerIpAddress] = useState<string | null>(null);

  const [exchange, setExchange] = useState("bitget");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [marketDataExchangeAccountId, setMarketDataExchangeAccountId] = useState("");
  const [openSettingsSections, setOpenSettingsSections] = useState<Record<SettingsAccordionKey, boolean>>({
    exchange_settings: false,
    security: false,
    notifications: false,
    license_management: false,
    language: false
  });
  const [notificationSending, setNotificationSending] = useState(false);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);
  const [notificationChatId, setNotificationChatId] = useState("");
  const [notificationTokenConfigured, setNotificationTokenConfigured] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetStatus, setResetStatus] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetDevCode, setResetDevCode] = useState<string | null>(null);
  const [securitySettingsLoading, setSecuritySettingsLoading] = useState(true);
  const [securitySettingsSaving, setSecuritySettingsSaving] = useState(false);
  const [securitySettingsMsg, setSecuritySettingsMsg] = useState<string | null>(null);
  const [autoLogoutEnabled, setAutoLogoutEnabled] = useState(true);
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState(60);
  const [otpEnabled, setOtpEnabled] = useState(true);
  const licenseManagementEnabled = false;
  const passphraseRequired = exchange === "bitget";
  const paperMode = exchange === "paper";
  const marketDataAccounts = accounts.filter((item) => item.exchange !== "paper");
  const query = searchParams.toString();

  function toggleSettingsSection(key: SettingsAccordionKey) {
    setOpenSettingsSections((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  }

  function switchLocalePath(targetLocale: AppLocale): string {
    const targetPath = withLocalePath(pathname, targetLocale);
    if (!query) return targetPath;
    return `${targetPath}?${query}`;
  }

  function handleLocaleSwitch(targetLocale: AppLocale) {
    if (targetLocale === locale) return;
    const targetPath = switchLocalePath(targetLocale);
    document.cookie = `${LOCALE_COOKIE_NAME}=${targetLocale}; path=/; max-age=31536000`;
    window.location.assign(targetPath);
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [meRes, accountRes, exchangesRes, serverInfoRes] = await Promise.all([
        apiGet<MeResponse>("/auth/me"),
        apiGet<{ items: ExchangeAccountItem[] }>("/exchange-accounts"),
        apiGet<{ options: ExchangeOption[] }>("/settings/exchange-options"),
        apiGet<{ serverIpAddress?: string | null }>("/settings/server-info")
      ]);
      setMe(meRes.user);
      if (!resetEmail && meRes.user?.email) {
        setResetEmail(meRes.user.email);
      }
      setIsSuperadmin(Boolean(meRes.isSuperadmin));
      setHasAdminBackendAccess(Boolean(meRes.isSuperadmin || meRes.hasAdminBackendAccess));
      setAccounts(accountRes.items ?? []);
      const dataAccounts = (accountRes.items ?? []).filter((item) => item.exchange !== "paper");
      if (!marketDataExchangeAccountId && dataAccounts.length > 0) {
        setMarketDataExchangeAccountId(dataAccounts[0].id);
      }
      const allowedOptions = (exchangesRes.options ?? []).filter((item) => item.enabled);
      setExchangeOptions(allowedOptions);
      setServerIpAddress(
        typeof serverInfoRes.serverIpAddress === "string" && serverInfoRes.serverIpAddress.trim()
          ? serverInfoRes.serverIpAddress.trim()
          : null
      );
      if (allowedOptions.length > 0 && !allowedOptions.some((item) => item.value === exchange)) {
        setExchange(allowedOptions[0].value);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    void loadSecuritySettings();
    void loadNotificationConfig();
  }, []);

  useEffect(() => {
    if (!paperMode) return;
    if (marketDataAccounts.length === 0) {
      if (marketDataExchangeAccountId) setMarketDataExchangeAccountId("");
      return;
    }
    if (!marketDataAccounts.some((item) => item.id === marketDataExchangeAccountId)) {
      setMarketDataExchangeAccountId(marketDataAccounts[0].id);
    }
  }, [paperMode, marketDataAccounts, marketDataExchangeAccountId]);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiPost("/exchange-accounts", {
        exchange,
        label,
        apiKey: paperMode ? undefined : apiKey,
        apiSecret: paperMode ? undefined : apiSecret,
        passphrase: paperMode ? undefined : passphrase || undefined,
        marketDataExchangeAccountId: paperMode ? marketDataExchangeAccountId || undefined : undefined
      });
      setLabel("");
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(id: string) {
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/exchange-accounts/${id}`);
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function syncAccount(id: string) {
    setError(null);
    setNotice(null);
    setSyncingId(id);
    try {
      const payload = await apiPost<ExchangeSyncResponse>(`/exchange-accounts/${id}/test-connection`);
      const parts = [
        "Sync successful",
        payload?.futuresBudget?.marginCoin ? `(${payload.futuresBudget.marginCoin})` : null,
        payload?.pnlTodayUsd !== null && payload?.pnlTodayUsd !== undefined
          ? `PnL ${payload.pnlTodayUsd}`
          : null,
        payload?.futuresBudget?.equity !== null && payload?.futuresBudget?.equity !== undefined
          ? `equity ${payload.futuresBudget.equity}`
          : null
      ].filter(Boolean);
      setNotice(parts.join(" "));
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSyncingId(null);
    }
  }

  async function loadNotificationConfig() {
    try {
      const data = await apiGet<{
        telegramChatId?: string | null;
        telegramBotConfigured?: boolean;
      }>("/settings/alerts");
      setNotificationChatId(data.telegramChatId ?? "");
      setNotificationTokenConfigured(Boolean(data.telegramBotConfigured));
    } catch {
      // ignore on initial render
    }
  }

  async function saveNotificationConfig() {
    setNotificationSaving(true);
    setNotificationMsg(null);
    try {
      await apiPut("/settings/alerts", {
        telegramChatId: notificationChatId.trim() || null
      });
      setNotificationMsg("Saved.");
    } catch (e) {
      setNotificationMsg(errMsgWithDetails(e));
    } finally {
      setNotificationSaving(false);
    }
  }

  async function sendNotificationTest() {
    setNotificationSending(true);
    setNotificationMsg(null);
    try {
      await apiPost("/alerts/test");
      setNotificationMsg("Test alert sent to Telegram.");
    } catch (e) {
      setNotificationMsg(errMsgWithDetails(e));
    } finally {
      setNotificationSending(false);
    }
  }

  async function loadSecuritySettings() {
    setSecuritySettingsLoading(true);
    setSecuritySettingsMsg(null);
    try {
      const data = await apiGet<{
        autoLogoutEnabled?: boolean;
        autoLogoutMinutes?: number;
        reauthOtpEnabled?: boolean;
        isSuperadmin?: boolean;
      }>("/settings/security");
      setAutoLogoutEnabled(Boolean(data.autoLogoutEnabled));
      setAutoLogoutMinutes(Number(data.autoLogoutMinutes) || 60);
      setOtpEnabled(data.reauthOtpEnabled !== false);
      if (typeof data.isSuperadmin === "boolean") {
        setIsSuperadmin(Boolean(data.isSuperadmin));
      }
    } catch (e) {
      setSecuritySettingsMsg(errMsg(e));
    } finally {
      setSecuritySettingsLoading(false);
    }
  }

  async function saveSecuritySettings() {
    setSecuritySettingsSaving(true);
    setSecuritySettingsMsg(null);
    const safeMinutes = Math.max(1, Math.min(1440, Math.floor(autoLogoutMinutes)));
    try {
      const payload: {
        autoLogoutEnabled: boolean;
        autoLogoutMinutes: number;
        reauthOtpEnabled: boolean;
      } = {
        autoLogoutEnabled,
        autoLogoutMinutes: safeMinutes,
        reauthOtpEnabled: otpEnabled
      };
      const data = await apiPut<{
        autoLogoutEnabled?: boolean;
        autoLogoutMinutes?: number;
        reauthOtpEnabled?: boolean;
        isSuperadmin?: boolean;
      }>("/settings/security", payload);
      setAutoLogoutEnabled(Boolean(data.autoLogoutEnabled));
      setAutoLogoutMinutes(Number(data.autoLogoutMinutes) || safeMinutes);
      setOtpEnabled(data.reauthOtpEnabled !== false);
      if (typeof data.isSuperadmin === "boolean") {
        setIsSuperadmin(Boolean(data.isSuperadmin));
      }
      setSecuritySettingsMsg(tMain("messages.saved"));
    } catch (e) {
      setSecuritySettingsMsg(errMsg(e));
    } finally {
      setSecuritySettingsSaving(false);
    }
  }

  async function savePassword() {
    setPasswordStatus(tMain("messages.saving"));
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordStatus("");
      setPasswordError(tMain("messages.passwordsDoNotMatch"));
      return;
    }
    try {
      await apiPost("/auth/change-password", {
        currentPassword,
        newPassword
      });
      setPasswordStatus(tMain("messages.updated"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      window.setTimeout(() => setPasswordStatus(""), 1200);
    } catch (e) {
      setPasswordStatus("");
      setPasswordError(errMsg(e));
    }
  }

  async function requestResetCode() {
    setResetStatus(tMain("messages.sendingCode"));
    setResetError("");
    setResetDevCode(null);
    try {
      const payload = await apiPost<{ devCode?: string; expiresInMinutes?: number }>(
        "/auth/password-reset/request",
        { email: resetEmail }
      );
      setResetStatus(
        tMain("messages.resetCodeSent", {
          expires: payload?.expiresInMinutes ? ` (${tMain("messages.validMinutes", { minutes: payload.expiresInMinutes })})` : ""
        })
      );
      if (payload?.devCode) setResetDevCode(payload.devCode);
    } catch (e) {
      setResetStatus("");
      setResetError(errMsg(e));
    }
  }

  async function confirmResetPassword() {
    setResetStatus(tMain("messages.updatingPassword"));
    setResetError("");
    if (resetNewPassword !== resetConfirmPassword) {
      setResetStatus("");
      setResetError(tMain("messages.newPasswordMismatch"));
      return;
    }
    try {
      await apiPost("/auth/password-reset/confirm", {
        email: resetEmail,
        code: resetCode,
        newPassword: resetNewPassword
      });
      setResetStatus(tMain("messages.passwordUpdated"));
      setResetCode("");
      setResetNewPassword("");
      setResetConfirmPassword("");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setResetStatus("");
      setResetError(errMsg(e));
    }
  }

  return (
    <div className="settingsWrap">
      <h2 style={{ marginTop: 0 }}>{tMain("title")}</h2>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        {tMain("subtitle")}
      </div>

      {error ? (
        <div className="card settingsAlert settingsAlertError">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="card settingsAlert settingsAlertSuccess">
          {notice}
        </div>
      ) : null}

      <div className="settingsLandingGrouped">
        {isSuperadmin || hasAdminBackendAccess ? (
          <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupAdmin">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>Admin</h3>
              <div className="settingsSectionMeta">{tMain("admin.access")}</div>
            </div>
            <div className="settingsSectionMeta">
              {tMain("admin.description")}
            </div>
            <Link href="/admin" className="btn btnPrimary">
              {tMain("admin.openBackend")}
            </Link>
          </section>
        ) : null}

        <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupAccount">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{tMain("account.title")}</h3>
            <div className="settingsSectionMeta">{tMain("account.profile")}</div>
          </div>
          {loading ? <div>{tCommon("loading")}</div> : <div>{me?.email ?? "-"}</div>}
          <div className="settingsAccordionDivider" style={{ marginTop: 12 }} />
          <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>
            {tMain("sections.accountSecurityTools")}
          </div>
          <div className="settingsAccordion">
            <div className={`settingsAccordionItem settingsAccordionItemAccess ${openSettingsSections.language ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("language")}
                aria-expanded={openSettingsSections.language}
              >
                <span>{tMain("sections.language")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.language ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.language ? (
                <div className="settingsAccordionBody">
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("language.description")}
                  </div>
                  <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                    {tMain("language.current")}: <b>{locale.toUpperCase()}</b>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={`btn ${locale === "en" ? "btnPrimary" : ""}`}
                      onClick={() => handleLocaleSwitch("en")}
                    >
                      {tMain("language.english")}
                    </button>
                    <button
                      type="button"
                      className={`btn ${locale === "de" ? "btnPrimary" : ""}`}
                      onClick={() => handleLocaleSwitch("de")}
                    >
                      {tMain("language.german")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className={`settingsAccordionItem settingsAccordionItemAccess ${openSettingsSections.security ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("security")}
                aria-expanded={openSettingsSections.security}
              >
                <span>{tMain("sections.security")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.security ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.security ? (
                <div className="settingsAccordionBody">
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("security.description")}
                  </div>
                  <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>{tMain("security.passwordTitle")}</div>
                  <div className="settingsFormGrid">
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.currentPassword")}</span>
                      <input
                        className="input"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.newPassword")}</span>
                      <input
                        className="input"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.confirmPassword")}</span>
                      <input
                        className="input"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button className="btn btnPrimary" type="button" onClick={savePassword} disabled={!currentPassword || !newPassword}>
                        {tMain("security.createPassword")}
                      </button>
                      {passwordStatus ? <span className="settingsMutedText">{passwordStatus}</span> : null}
                    </div>
                    {passwordError ? <div style={{ color: "#ff6b6b", fontSize: 12 }}>{passwordError}</div> : null}
                  </div>

                  <div className="settingsAccordionDivider" />

                  <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>{tMain("security.sessionTitle")}</div>
                  <div className="settingsFormGrid">
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={autoLogoutEnabled}
                        onChange={(e) => setAutoLogoutEnabled(e.target.checked)}
                        disabled={securitySettingsLoading || securitySettingsSaving}
                      />
                      <span>{tMain("security.autoLogout")}</span>
                    </label>
                    <label className="settingsField" style={{ maxWidth: 260 }}>
                      <span className="settingsFieldLabel">{tMain("security.idleMinutes")}</span>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={1440}
                        value={Number.isFinite(autoLogoutMinutes) ? autoLogoutMinutes : 60}
                        onChange={(e) => setAutoLogoutMinutes(Number(e.target.value))}
                        disabled={!autoLogoutEnabled || securitySettingsLoading || securitySettingsSaving}
                      />
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={otpEnabled}
                        onChange={(e) => setOtpEnabled(e.target.checked)}
                        disabled={securitySettingsLoading || securitySettingsSaving}
                      />
                      <span>{tMain("security.requireOtp")}</span>
                    </label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn btnPrimary" type="button" onClick={saveSecuritySettings} disabled={securitySettingsLoading || securitySettingsSaving}>
                        {securitySettingsSaving ? tCommon("saving") : tCommon("saveSettings")}
                      </button>
                      <button className="btn" type="button" onClick={loadSecuritySettings} disabled={securitySettingsLoading || securitySettingsSaving}>
                        {securitySettingsLoading ? tCommon("loading") : tCommon("reload")}
                      </button>
                    </div>
                    {securitySettingsMsg ? <div className="settingsMutedText">{securitySettingsMsg}</div> : null}
                  </div>

                  <div className="settingsAccordionDivider" />

                  <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>{tMain("security.resetTitle")}</div>
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("security.resetDescription")}
                  </div>
                  <div className="settingsFormGrid">
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.accountEmail")}</span>
                      <input
                        className="input"
                        type="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder={tMain("security.emailPlaceholder")}
                      />
                    </label>
                    <div>
                      <button className="btn" type="button" onClick={requestResetCode} disabled={!resetEmail}>
                        {tMain("security.sendResetCode")}
                      </button>
                    </div>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.resetCode")}</span>
                      <input
                        className="input"
                        value={resetCode}
                        onChange={(e) => setResetCode(e.target.value)}
                        maxLength={6}
                        placeholder={tMain("security.resetCodePlaceholder")}
                      />
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.newPassword")}</span>
                      <input
                        className="input"
                        type="password"
                        value={resetNewPassword}
                        onChange={(e) => setResetNewPassword(e.target.value)}
                        minLength={8}
                      />
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.confirmPassword")}</span>
                      <input
                        className="input"
                        type="password"
                        value={resetConfirmPassword}
                        onChange={(e) => setResetConfirmPassword(e.target.value)}
                        minLength={8}
                      />
                    </label>
                    <div>
                      <button
                        className="btn btnPrimary"
                        type="button"
                        onClick={confirmResetPassword}
                        disabled={!resetEmail || resetCode.length !== 6 || resetNewPassword.length < 8}
                      >
                        {tMain("security.resetPassword")}
                      </button>
                    </div>
                    {resetStatus ? <div className="settingsMutedText">{resetStatus}</div> : null}
                    {resetDevCode ? (
                      <div style={{ fontSize: 12, color: "#facc15" }}>
                        {tMain("security.devResetCode")}: <b>{resetDevCode}</b>
                      </div>
                    ) : null}
                    {resetError ? <div style={{ color: "#ff6b6b", fontSize: 12 }}>{resetError}</div> : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className={`settingsAccordionItem settingsAccordionItemIntegrations ${openSettingsSections.notifications ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("notifications")}
                aria-expanded={openSettingsSections.notifications}
              >
                <span>{tMain("sections.notifications")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.notifications ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.notifications ? (
                <div className="settingsAccordionBody">
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("notifications.description")}
                  </div>
                  <a
                    className="btn"
                    href="https://t.me/utrade_ai_signals_bot"
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginBottom: 8 }}
                  >
                    {tMain("notifications.openBot")}
                  </a>
                  {!notificationTokenConfigured ? (
                    <div style={{ color: "#fca5a5", marginBottom: 10, fontSize: 12 }}>
                      {tMain("notifications.tokenMissing")}
                    </div>
                  ) : null}
                  <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                    {tMain("notifications.botTokenManaged")}
                  </div>
                  <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                    {tMain("notifications.tipBefore")} <b>-100</b> {tMain("notifications.tipAfter")}
                  </div>
                  <label className="settingsField" style={{ marginBottom: 10 }}>
                    <span className="settingsFieldLabel">{tMain("notifications.chatId")}</span>
                    <input
                      className="input"
                      placeholder="123456789"
                      value={notificationChatId}
                      onChange={(e) => setNotificationChatId(e.target.value)}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn btnPrimary" type="button" onClick={saveNotificationConfig} disabled={notificationSaving}>
                      {notificationSaving ? tCommon("saving") : tCommon("saveSettings")}
                    </button>
                    <button className="btn" type="button" onClick={sendNotificationTest} disabled={notificationSending}>
                      {notificationSending ? tMain("notifications.sending") : tMain("notifications.sendTest")}
                    </button>
                  </div>
                  {notificationMsg ? <div className="settingsMutedText" style={{ marginTop: 8 }}>{notificationMsg}</div> : null}
                </div>
              ) : null}
            </div>

            <div className={`settingsAccordionItem settingsAccordionItemStrategy ${openSettingsSections.license_management ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("license_management")}
                aria-expanded={openSettingsSections.license_management}
              >
                <span>{tMain("sections.licenseManagement")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.license_management ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.license_management ? (
                <div className="settingsAccordionBody">
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("license.prepared")}
                  </div>
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("license.onceEnabled")}
                  </div>
                  <div className="settingsMutedText">
                    {licenseManagementEnabled ? tMain("license.open") : tMain("license.currentlyDisabled")}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupSettings">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{tMain("sections.cexTradingSettings")}</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div className="settingsSectionMeta">{tMain("sections.exchangeSettings")}</div>
              <Link href={withLocalePath("/settings/risk", locale)} className="btn">
                {tRisk("title")}
              </Link>
            </div>
          </div>
          <div className="settingsAccordion">
            <div className={`settingsAccordionItem settingsAccordionItemIntegrations ${openSettingsSections.exchange_settings ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("exchange_settings")}
                aria-expanded={openSettingsSections.exchange_settings}
              >
                <span>{tMain("sections.exchangeSettings")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.exchange_settings ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.exchange_settings ? (
                <div className="settingsAccordionBody">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                      flexWrap: "wrap",
                      marginBottom: 8
                    }}
                  >
                    <div style={{ minWidth: 260, flex: "1 1 320px" }}>
                      <div className="settingsInlineTitle">{tMain("exchange.addTitle")}</div>
                      <div className="settingsMutedText">
                        {tMain("exchange.paperHint")}
                      </div>
                    </div>
                    <label className="settingsField" style={{ minWidth: 240, maxWidth: 340, marginLeft: "auto" }}>
                      <span className="settingsFieldLabel">{tMain("exchange.fields.serverIpAddress")}</span>
                      <input
                        className="input"
                        value={serverIpAddress ?? tMain("exchange.serverIpNotConfigured")}
                        readOnly
                      />
                      <span className="settingsMutedText">{tMain("exchange.serverIpHint")}</span>
                    </label>
                  </div>
                  <form onSubmit={createAccount} className="settingsFormGrid">
                    {exchangeOptions.length === 0 ? (
                      <div className="settingsMutedText">
                        {tMain("exchange.noEnabledExchange")}
                      </div>
                    ) : null}
                    <div className="settingsTwoColGrid">
                      <label className="settingsField">
                        <span className="settingsFieldLabel">{tMain("exchange.fields.exchange")}</span>
                        <select className="input" value={exchange} onChange={(e) => setExchange(e.target.value)} required>
                          {exchangeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="settingsField">
                        <span className="settingsFieldLabel">{tMain("exchange.fields.label")}</span>
                        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required />
                      </label>
                    </div>
                    {paperMode ? (
                      <label className="settingsField">
                        <span className="settingsFieldLabel">{tMain("exchange.fields.marketDataAccount")}</span>
                        <select
                          className="input"
                          value={marketDataExchangeAccountId}
                          onChange={(e) => setMarketDataExchangeAccountId(e.target.value)}
                          required
                        >
                          <option value="" disabled>
                            {tMain("exchange.selectLiveCex")}
                          </option>
                          {marketDataAccounts.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label} ({item.exchange.toUpperCase()})
                            </option>
                          ))}
                        </select>
                        {marketDataAccounts.length === 0 ? (
                          <span className="settingsMutedText">
                            {tMain("exchange.createLiveFirst")}
                          </span>
                        ) : null}
                      </label>
                    ) : (
                      <>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("exchange.fields.apiKey")}</span>
                          <input className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
                        </label>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("exchange.fields.apiSecret")}</span>
                          <input className="input" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} required />
                        </label>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">
                            {passphraseRequired ? tMain("exchange.fields.passphraseRequired") : tMain("exchange.fields.passphraseOptional")}
                          </span>
                          <input
                            className="input"
                            value={passphrase}
                            onChange={(e) => setPassphrase(e.target.value)}
                            required={passphraseRequired}
                          />
                        </label>
                      </>
                    )}
                    <button
                      className="btn btnPrimary"
                      type="submit"
                      disabled={
                        saving ||
                        exchangeOptions.length === 0 ||
                        !exchange ||
                        !label ||
                        (paperMode
                          ? !marketDataExchangeAccountId
                          : (!apiKey || !apiSecret || (passphraseRequired && !passphrase)))
                      }
                    >
                      {saving ? tCommon("saving") : tMain("exchange.addAccount")}
                    </button>
                  </form>

                  <div className="settingsAccordionDivider" />

                  <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>{tMain("exchange.existingAccounts")}</div>
                  {accounts.length === 0 ? (
                    <div className="settingsMutedText">{tMain("exchange.noAccounts")}</div>
                  ) : (
                    <div className="settingsAccountList">
                      {accounts.map((account) => (
                        <div key={account.id} className="card settingsAccountCard">
                          <div>
                            <div style={{ fontWeight: 700 }}>{account.label}</div>
                            <div className="settingsMutedText">
                              {account.exchange} · {account.apiKeyMasked}
                            </div>
                            {account.exchange === "paper" ? (
                              <div className="settingsMutedText">
                                {tMain("exchange.marketData")}: {account.marketDataLabel ?? account.marketDataExchangeAccountId ?? tMain("exchange.notConfigured")}
                                {account.marketDataExchange ? ` (${account.marketDataExchange.toUpperCase()})` : ""}
                              </div>
                            ) : null}
                            <div className="settingsMutedText">
                              {tMain("exchange.lastSync")}: {account.lastUsedAt ? new Date(account.lastUsedAt).toLocaleString() : tMain("exchange.never")}
                            </div>
                            {account.futuresBudget ? (
                              <div className="settingsMutedText">
                                Futures: equity {account.futuresBudget.equity ?? "-"} · available {account.futuresBudget.availableMargin ?? "-"}
                                {account.futuresBudget.marginCoin ? ` ${account.futuresBudget.marginCoin}` : ""}
                              </div>
                            ) : null}
                            {account.lastSyncError?.message ? (
                              <div className="settingsMutedText" style={{ color: "#d14343" }}>
                                Sync error: {account.lastSyncError.message}
                              </div>
                            ) : null}
                          </div>
                          <div className="settingsAccountActions">
                            <button
                              className="btn"
                              onClick={() => void syncAccount(account.id)}
                              disabled={syncingId === account.id}
                            >
                              {syncingId === account.id ? tMain("exchange.syncing") : tMain("exchange.syncNow")}
                            </button>
                            <button className="btn" onClick={() => void deleteAccount(account.id)}>
                              {tMain("actions.delete")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
