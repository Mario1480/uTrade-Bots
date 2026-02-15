"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../lib/api";

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

type SettingsAccordionKey = "exchange_settings" | "security" | "notifications" | "license_management";

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

  const [exchange, setExchange] = useState("bitget");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [marketDataExchangeAccountId, setMarketDataExchangeAccountId] = useState("");
  const [openSettingsSection, setOpenSettingsSection] = useState<SettingsAccordionKey | null>("exchange_settings");
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

  function toggleSettingsSection(key: SettingsAccordionKey) {
    setOpenSettingsSection((prev) => (prev === key ? null : key));
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [meRes, accountRes, exchangesRes] = await Promise.all([
        apiGet<MeResponse>("/auth/me"),
        apiGet<{ items: ExchangeAccountItem[] }>("/exchange-accounts"),
        apiGet<{ options: ExchangeOption[] }>("/settings/exchange-options")
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
        reauthOtpEnabled?: boolean;
      } = {
        autoLogoutEnabled,
        autoLogoutMinutes: safeMinutes
      };
      if (isSuperadmin) {
        payload.reauthOtpEnabled = otpEnabled;
      }
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
      setSecuritySettingsMsg("Saved.");
    } catch (e) {
      setSecuritySettingsMsg(errMsg(e));
    } finally {
      setSecuritySettingsSaving(false);
    }
  }

  async function savePassword() {
    setPasswordStatus("saving...");
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordStatus("");
      setPasswordError("Passwords do not match.");
      return;
    }
    try {
      await apiPost("/auth/change-password", {
        currentPassword,
        newPassword
      });
      setPasswordStatus("updated");
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
    setResetStatus("sending code...");
    setResetError("");
    setResetDevCode(null);
    try {
      const payload = await apiPost<{ devCode?: string; expiresInMinutes?: number }>(
        "/auth/password-reset/request",
        { email: resetEmail }
      );
      setResetStatus(
        `If the account exists, a reset code was sent${payload?.expiresInMinutes ? ` (valid ${payload.expiresInMinutes} min)` : ""}.`
      );
      if (payload?.devCode) setResetDevCode(payload.devCode);
    } catch (e) {
      setResetStatus("");
      setResetError(errMsg(e));
    }
  }

  async function confirmResetPassword() {
    setResetStatus("updating password...");
    setResetError("");
    if (resetNewPassword !== resetConfirmPassword) {
      setResetStatus("");
      setResetError("New password and confirmation do not match.");
      return;
    }
    try {
      await apiPost("/auth/password-reset/confirm", {
        email: resetEmail,
        code: resetCode,
        newPassword: resetNewPassword
      });
      setResetStatus("Password updated. Please sign in again if your session expires.");
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
      <h2 style={{ marginTop: 0 }}>Settings</h2>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        User self-service and exchange account management.
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
              <div className="settingsSectionMeta">Access</div>
            </div>
            <div className="settingsSectionMeta">
              User management, global Telegram, offered CEX list and SMTP settings.
            </div>
            <Link href="/admin" className="btn btnPrimary">
              Open admin backend
            </Link>
          </section>
        ) : null}

        <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupAccount">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>Account</h3>
            <div className="settingsSectionMeta">Profile</div>
          </div>
          {loading ? <div>Loading...</div> : <div>{me?.email ?? "-"}</div>}
        </section>

        <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupSettings">
        <div className="settingsSectionHeader">
          <h3 style={{ margin: 0 }}>Account Settings</h3>
          <div className="settingsSectionMeta">Integrations / Security</div>
        </div>
        <div className="settingsAccordion">
          <div className={`settingsAccordionItem settingsAccordionItemIntegrations ${openSettingsSection === "exchange_settings" ? "settingsAccordionItemOpen" : ""}`}>
            <button
              className="settingsAccordionTrigger"
              type="button"
              onClick={() => toggleSettingsSection("exchange_settings")}
              aria-expanded={openSettingsSection === "exchange_settings"}
            >
              <span>Exchange Settings</span>
              <span className={`settingsAccordionChevron ${openSettingsSection === "exchange_settings" ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
            </button>
            {openSettingsSection === "exchange_settings" ? (
              <div className="settingsAccordionBody">
                <div className="settingsInlineTitle">Add Exchange Account</div>
                <div className="settingsMutedText" style={{ marginBottom: 8 }}>
                  Paper accounts simulate execution and require one live account for market data.
                </div>
                <form onSubmit={createAccount} className="settingsFormGrid">
                  {exchangeOptions.length === 0 ? (
                    <div className="settingsMutedText">
                      No exchange is enabled by admin yet.
                    </div>
                  ) : null}
                  <div className="settingsTwoColGrid">
                    <label className="settingsField">
                      <span className="settingsFieldLabel">Exchange</span>
                      <select className="input" value={exchange} onChange={(e) => setExchange(e.target.value)} required>
                        {exchangeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">Label</span>
                      <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required />
                    </label>
                  </div>
                  {paperMode ? (
                    <label className="settingsField">
                      <span className="settingsFieldLabel">Market data account (required)</span>
                      <select
                        className="input"
                        value={marketDataExchangeAccountId}
                        onChange={(e) => setMarketDataExchangeAccountId(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Select live CEX account
                        </option>
                        {marketDataAccounts.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label} ({item.exchange.toUpperCase()})
                          </option>
                        ))}
                      </select>
                      {marketDataAccounts.length === 0 ? (
                        <span className="settingsMutedText">
                          Create a live exchange account first.
                        </span>
                      ) : null}
                    </label>
                  ) : (
                    <>
                      <label className="settingsField">
                        <span className="settingsFieldLabel">API Key</span>
                        <input className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
                      </label>
                      <label className="settingsField">
                        <span className="settingsFieldLabel">API Secret</span>
                        <input className="input" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} required />
                      </label>
                      <label className="settingsField">
                        <span className="settingsFieldLabel">
                          {passphraseRequired ? "Passphrase (required for Bitget)" : "Passphrase (optional)"}
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
                    {saving ? "Saving..." : "Add account"}
                  </button>
                </form>

                <div className="settingsAccordionDivider" />

                <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>Existing Accounts</div>
                {accounts.length === 0 ? (
                  <div className="settingsMutedText">No accounts yet.</div>
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
                              Market data: {account.marketDataLabel ?? account.marketDataExchangeAccountId ?? "Not configured"}
                              {account.marketDataExchange ? ` (${account.marketDataExchange.toUpperCase()})` : ""}
                            </div>
                          ) : null}
                          <div className="settingsMutedText">
                            Last sync: {account.lastUsedAt ? new Date(account.lastUsedAt).toLocaleString() : "Never"}
                          </div>
                        </div>
                        <div className="settingsAccountActions">
                          <button
                            className="btn"
                            onClick={() => void syncAccount(account.id)}
                            disabled={syncingId === account.id}
                          >
                            {syncingId === account.id ? "Syncing..." : "Sync now"}
                          </button>
                          <button className="btn" onClick={() => void deleteAccount(account.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className={`settingsAccordionItem settingsAccordionItemAccess ${openSettingsSection === "security" ? "settingsAccordionItemOpen" : ""}`}>
            <button
              className="settingsAccordionTrigger"
              type="button"
              onClick={() => toggleSettingsSection("security")}
              aria-expanded={openSettingsSection === "security"}
            >
              <span>Security</span>
              <span className={`settingsAccordionChevron ${openSettingsSection === "security" ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
            </button>
            {openSettingsSection === "security" ? (
              <div className="settingsAccordionBody">
                <div className="settingsSectionMeta">
                  Manage password and session security without leaving this page.
                </div>

                <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>Password</div>
                <div className="settingsFormGrid" style={{ marginBottom: 10 }}>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">Current password</span>
                    <input
                      className="input"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">New password</span>
                    <input
                      className="input"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">Confirm new password</span>
                    <input
                      className="input"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      className="btn btnPrimary"
                      type="button"
                      onClick={() => void savePassword()}
                      disabled={!currentPassword || !newPassword}
                    >
                      Create new password
                    </button>
                    <span className="settingsMutedText">{passwordStatus}</span>
                  </div>
                  {passwordError ? <div style={{ fontSize: 12, color: "#ff6b6b" }}>{passwordError}</div> : null}
                </div>

                <div className="settingsAccordionDivider" />

                <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>Session Security</div>
                <div style={{ display: "grid", gap: 10, marginBottom: 10, maxWidth: 420 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={autoLogoutEnabled}
                      onChange={(e) => setAutoLogoutEnabled(e.target.checked)}
                      disabled={securitySettingsLoading || securitySettingsSaving}
                    />
                    <span>Enable auto-logout</span>
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">Idle minutes</span>
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
                  {isSuperadmin ? (
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={otpEnabled}
                        onChange={(e) => setOtpEnabled(e.target.checked)}
                        disabled={securitySettingsLoading || securitySettingsSaving}
                      />
                      <span>Require OTP re-auth for sensitive actions</span>
                    </label>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn btnPrimary"
                    type="button"
                    onClick={() => void saveSecuritySettings()}
                    disabled={securitySettingsLoading || securitySettingsSaving}
                  >
                    {securitySettingsSaving ? "Saving..." : "Save settings"}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void loadSecuritySettings()}
                    disabled={securitySettingsLoading || securitySettingsSaving}
                  >
                    {securitySettingsLoading ? "Loading..." : "Reload"}
                  </button>
                </div>
                {securitySettingsMsg ? (
                  <div style={{ marginTop: 10 }} className="settingsMutedText">{securitySettingsMsg}</div>
                ) : null}

                <div className="settingsAccordionDivider" />

                <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>Reset via Email Code</div>
                <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                  Use this if you forgot your current password.
                </div>
                <div className="settingsFormGrid" style={{ maxWidth: 420 }}>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">Account email</span>
                    <input
                      className="input"
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  <div>
                    <button className="btn" type="button" onClick={() => void requestResetCode()} disabled={!resetEmail}>
                      Send reset code
                    </button>
                  </div>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">Reset code (6 digits)</span>
                    <input
                      className="input"
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value)}
                      maxLength={6}
                      placeholder="123456"
                    />
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">New password</span>
                    <input
                      className="input"
                      type="password"
                      value={resetNewPassword}
                      onChange={(e) => setResetNewPassword(e.target.value)}
                      minLength={8}
                    />
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">Confirm new password</span>
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
                      onClick={() => void confirmResetPassword()}
                      disabled={!resetEmail || resetCode.length !== 6 || resetNewPassword.length < 8}
                    >
                      Reset password
                    </button>
                  </div>
                  {resetStatus ? <div className="settingsMutedText">{resetStatus}</div> : null}
                  {resetDevCode ? (
                    <div style={{ fontSize: 12, color: "#facc15" }}>
                      Dev reset code: <b>{resetDevCode}</b>
                    </div>
                  ) : null}
                  {resetError ? <div style={{ fontSize: 12, color: "#ff6b6b" }}>{resetError}</div> : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className={`settingsAccordionItem settingsAccordionItemIntegrations ${openSettingsSection === "notifications" ? "settingsAccordionItemOpen" : ""}`}>
            <button
              className="settingsAccordionTrigger"
              type="button"
              onClick={() => toggleSettingsSection("notifications")}
              aria-expanded={openSettingsSection === "notifications"}
            >
              <span>Notifications</span>
              <span className={`settingsAccordionChevron ${openSettingsSection === "notifications" ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
            </button>
            {openSettingsSection === "notifications" ? (
              <div className="settingsAccordionBody">
                <div className="settingsSectionMeta">
                  Configure Telegram alerts for tradable prediction signals directly here.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <a
                    className="btn"
                    href="https://t.me/utrade_ai_signals_bot"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Bot (@utrade_ai_signals_bot)
                  </a>
                </div>
                <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                  Bot token is managed globally by admin. You only need your Chat ID here.
                </div>
                {!notificationTokenConfigured ? (
                  <div style={{ color: "#fca5a5", marginBottom: 10, fontSize: 12 }}>
                    Telegram bot token is not configured by admin yet.
                  </div>
                ) : null}
                <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                  Tip: For Telegram groups, the Chat ID usually starts with <b>-100</b>.
                </div>
                <div className="settingsFormGrid" style={{ marginBottom: 10 }}>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">Chat ID</span>
                    <input
                      className="input"
                      placeholder="123456789"
                      value={notificationChatId}
                      onChange={(e) => setNotificationChatId(e.target.value)}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn btnPrimary"
                    type="button"
                    onClick={() => void saveNotificationConfig()}
                    disabled={notificationSaving}
                  >
                    {notificationSaving ? "Saving..." : "Save settings"}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void sendNotificationTest()}
                    disabled={notificationSending}
                  >
                    {notificationSending ? "Sending..." : "Send test message"}
                  </button>
                </div>
                {notificationMsg ? (
                  <div style={{ marginTop: 10 }} className="settingsMutedText">{notificationMsg}</div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className={`settingsAccordionItem settingsAccordionItemStrategy ${openSettingsSection === "license_management" ? "settingsAccordionItemOpen" : ""} ${!licenseManagementEnabled ? "settingsAccordionItemDisabled" : ""}`}>
            <button
              className="settingsAccordionTrigger"
              type="button"
              onClick={() => toggleSettingsSection("license_management")}
              aria-expanded={openSettingsSection === "license_management"}
            >
              <span>License Management</span>
              <span className={`settingsAccordionChevron ${openSettingsSection === "license_management" ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
            </button>
            {openSettingsSection === "license_management" ? (
              <div className="settingsAccordionBody">
                <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                  License controls are prepared but currently disabled in this environment.
                </div>
                <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                  Once enabled, this section will provide license status, key management, and verification actions.
                </div>
                {licenseManagementEnabled ? (
                  <Link href="/settings/subscription" className="btn btnPrimary">
                    Open license management
                  </Link>
                ) : (
                  <button className="btn" type="button" disabled title="Currently disabled">
                    License Management (Disabled)
                  </button>
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
