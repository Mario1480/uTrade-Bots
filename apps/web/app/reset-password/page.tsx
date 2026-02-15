"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ApiError, apiPost } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);

  async function requestResetCode() {
    setStatus(t("sendingCode"));
    setError("");
    setDevCode(null);
    try {
      const payload = await apiPost<{ devCode?: string; expiresInMinutes?: number }>(
        "/auth/password-reset/request",
        { email }
      );
      const validWindow = payload?.expiresInMinutes
        ? ` (${t("validMinutes", { minutes: payload.expiresInMinutes })})`
        : "";
      setStatus(`${t("codeSent")}${validWindow}.`);
      if (payload?.devCode) setDevCode(payload.devCode);
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  async function confirmResetPassword() {
    setStatus(t("updatingPassword"));
    setError("");
    if (newPassword !== confirmPassword) {
      setStatus("");
      setError(t("passwordMismatch"));
      return;
    }
    try {
      await apiPost("/auth/password-reset/confirm", {
        email,
        code,
        newPassword
      });
      setStatus(t("passwordUpdated"));
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        router.push(withLocalePath("/login", locale));
      }, 1000);
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>{t("resetPasswordTitle")}</h1>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            {t("accountEmail")}
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("placeholders.email")}
              required
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" type="button" disabled={!email} onClick={() => void requestResetCode()}>
              {t("requestResetCode")}
            </button>
          </div>
          <label style={{ fontSize: 13 }}>
            {t("resetCode")}
            <input
              className="input"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("placeholders.resetCode")}
              maxLength={6}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("newPassword")}
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("placeholders.passwordMin")}
              minLength={8}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("confirmNewPassword")}
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("placeholders.repeatPassword")}
              minLength={8}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btnPrimary"
              type="button"
              disabled={!email || code.length !== 6 || newPassword.length < 8}
              onClick={() => void confirmResetPassword()}
            >
              {t("setNewPassword")}
            </button>
            <Link href={withLocalePath("/login", locale)} className="btn">
              {t("backToLogin")}
            </Link>
          </div>
          {status ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{status}</div> : null}
          {devCode ? (
            <div style={{ fontSize: 12, color: "#facc15" }}>
              {t("devResetCode")}: <b>{devCode}</b>
            </div>
          ) : null}
          {error ? <div style={{ fontSize: 12, color: "#ef4444" }}>{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
