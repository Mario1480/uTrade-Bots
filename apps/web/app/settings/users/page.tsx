"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

export default function UsersPage() {
  const t = useTranslations("settings.users");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [error, setError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdStatus, setPwdStatus] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetStatus, setResetStatus] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetDevCode, setResetDevCode] = useState<string | null>(null);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [securityMsg, setSecurityMsg] = useState<string | null>(null);
  const [autoLogoutEnabled, setAutoLogoutEnabled] = useState(true);
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState(60);
  const [otpEnabled, setOtpEnabled] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  async function loadSecuritySettings() {
    setSecurityLoading(true);
    setSecurityMsg(null);
    try {
      const [data, me] = await Promise.all([
        apiGet<any>("/settings/security"),
        apiGet<any>("/auth/me")
      ]);
      setAutoLogoutEnabled(Boolean(data.autoLogoutEnabled));
      setAutoLogoutMinutes(Number(data.autoLogoutMinutes) || 60);
      setOtpEnabled(data.reauthOtpEnabled !== false);
      setIsSuperadmin(Boolean(data.isSuperadmin));
      const emailFromMe = typeof me?.email === "string"
        ? me.email
        : typeof me?.user?.email === "string"
          ? me.user.email
          : "";
      if (emailFromMe) setResetEmail(emailFromMe);
    } catch (e) {
      setSecurityMsg(errMsg(e));
    } finally {
      setSecurityLoading(false);
    }
  }

  async function saveSecuritySettings() {
    setSecuritySaving(true);
    setSecurityMsg(null);
    const safeMinutes = Math.max(1, Math.min(1440, Math.floor(autoLogoutMinutes)));
    try {
      const payload: any = {
        autoLogoutEnabled,
        autoLogoutMinutes: safeMinutes
      };
      if (isSuperadmin) {
        payload.reauthOtpEnabled = otpEnabled;
      }
      const data = await apiPut<any>("/settings/security", payload);
      setAutoLogoutEnabled(Boolean(data.autoLogoutEnabled));
      setAutoLogoutMinutes(Number(data.autoLogoutMinutes) || safeMinutes);
      setOtpEnabled(data.reauthOtpEnabled !== false);
      setIsSuperadmin(Boolean(data.isSuperadmin));
      setSecurityMsg(t("messages.saved"));
    } catch (e) {
      setSecurityMsg(errMsg(e));
    } finally {
      setSecuritySaving(false);
    }
  }

  useEffect(() => {
    loadSecuritySettings();
  }, []);

  async function savePassword() {
    setPwdStatus(tCommon("saving"));
    setPwdError("");
    if (newPassword !== confirmPassword) {
      setPwdStatus("");
      setPwdError(t("messages.passwordMismatch"));
      return;
    }
    try {
      await apiPost("/auth/change-password", {
        currentPassword,
        newPassword
      });
      setPwdStatus(t("messages.updated"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPwdStatus(""), 1200);
    } catch (e) {
      setPwdStatus("");
      setPwdError(errMsg(e));
    }
  }

  async function requestResetCode() {
    setResetStatus(t("messages.sendingCode"));
    setResetError("");
    setResetDevCode(null);
    try {
      const payload = await apiPost<{ devCode?: string; expiresInMinutes?: number }>(
        "/auth/password-reset/request",
        { email: resetEmail }
      );
      setResetStatus(
        t("messages.resetCodeSent", {
          expires: payload?.expiresInMinutes ? ` (${t("messages.validFor", { minutes: payload.expiresInMinutes })})` : ""
        })
      );
      if (payload?.devCode) setResetDevCode(payload.devCode);
    } catch (e) {
      setResetStatus("");
      setResetError(errMsg(e));
    }
  }

  async function confirmResetPassword() {
    setResetStatus(t("messages.updatingPassword"));
    setResetError("");
    if (resetNewPassword !== resetConfirmPassword) {
      setResetStatus("");
      setResetError(t("messages.newPasswordMismatch"));
      return;
    }
    try {
      await apiPost("/auth/password-reset/confirm", {
        email: resetEmail,
        code: resetCode,
        newPassword: resetNewPassword
      });
      setResetStatus(t("messages.passwordUpdated"));
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
    <div className="settingsWrap" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
        <Link href={withLocalePath("/", locale)} className="btn">
          ← {tCommon("backToDashboard")}
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="card settingsSection" style={{ marginTop: 14 }}>
        <div className="settingsSectionHeader">
          <div style={{ fontWeight: 700 }}>{t("password.title")}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          {t("password.description")}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontSize: 13 }}>
            {t("password.current")}
            <input
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("password.new")}
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("password.confirm")}
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btnPrimary" onClick={savePassword} disabled={!currentPassword || !newPassword}>
              {t("password.submit")}
            </button>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{pwdStatus}</span>
          </div>
          {pwdError ? <div style={{ fontSize: 12, color: "#ff6b6b" }}>{pwdError}</div> : null}
        </div>
      </div>

      <div className="card settingsSection" style={{ marginTop: 14 }}>
        <div className="settingsSectionHeader">
          <div style={{ fontWeight: 700 }}>{t("security.title")}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          {t("security.description")}
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 10, maxWidth: 360 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={autoLogoutEnabled}
              onChange={(e) => setAutoLogoutEnabled(e.target.checked)}
              disabled={securityLoading || securitySaving}
            />
            <span>{t("security.autoLogout")}</span>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("security.idleMinutes")}</span>
            <input
              className="input"
              type="number"
              min={1}
              max={1440}
              value={Number.isFinite(autoLogoutMinutes) ? autoLogoutMinutes : 60}
              onChange={(e) => setAutoLogoutMinutes(Number(e.target.value))}
              disabled={!autoLogoutEnabled || securityLoading || securitySaving}
            />
          </label>
          {isSuperadmin ? (
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={otpEnabled}
                onChange={(e) => setOtpEnabled(e.target.checked)}
                disabled={securityLoading || securitySaving}
              />
              <span>{t("security.otp")}</span>
            </label>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btnPrimary" onClick={saveSecuritySettings} disabled={securityLoading || securitySaving}>
            {securitySaving ? tCommon("saving") : tCommon("saveSettings")}
          </button>
          <button className="btn" onClick={loadSecuritySettings} disabled={securityLoading || securitySaving}>
            {securityLoading ? tCommon("loading") : tCommon("reload")}
          </button>
        </div>
        {securityMsg ? (
          <div style={{ marginTop: 10, color: "var(--muted)" }}>{securityMsg}</div>
        ) : null}
      </div>

      <div className="card settingsSection" style={{ marginTop: 14 }}>
        <div className="settingsSectionHeader">
          <div style={{ fontWeight: 700 }}>{t("reset.title")}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          {t("reset.description")}
        </div>
        <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
          <label style={{ fontSize: 13 }}>
            {t("reset.email")}
            <input
              className="input"
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder={t("reset.emailPlaceholder")}
            />
          </label>
          <div>
            <button className="btn" onClick={() => void requestResetCode()} disabled={!resetEmail}>
              {t("reset.sendCode")}
            </button>
          </div>
          <label style={{ fontSize: 13 }}>
            {t("reset.code")}
            <input
              className="input"
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value)}
              maxLength={6}
              placeholder={t("reset.codePlaceholder")}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("reset.newPassword")}
            <input
              className="input"
              type="password"
              value={resetNewPassword}
              onChange={(e) => setResetNewPassword(e.target.value)}
              minLength={8}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("reset.confirmPassword")}
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
              onClick={() => void confirmResetPassword()}
              disabled={!resetEmail || resetCode.length !== 6 || resetNewPassword.length < 8}
            >
              {t("reset.submit")}
            </button>
          </div>
          {resetStatus ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{resetStatus}</div> : null}
          {resetDevCode ? (
            <div style={{ fontSize: 12, color: "#facc15" }}>
              {t("reset.devCode")} <b>{resetDevCode}</b>
            </div>
          ) : null}
          {resetError ? <div style={{ fontSize: 12, color: "#ff6b6b" }}>{resetError}</div> : null}
        </div>
      </div>

      {error ? <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 8 }}>{error}</div> : null}
    </div>
  );
}
