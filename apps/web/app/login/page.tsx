"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, apiPost } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus(t("signingIn"));
    setError("");
    try {
      await apiPost("/auth/login", { email, password });
      router.push(withLocalePath("/", locale));
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>{t("signIn")}</h1>
      <div className="card" style={{ padding: 16 }}>
        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            {t("email")}
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("placeholders.email")}
              required
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("password")}
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("placeholders.passwordDots")}
              required
            />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btnPrimary" type="submit" disabled={!email || !password}>
              {t("signInButton")}
            </button>
            <Link href={withLocalePath("/register", locale)} className="btn">
              {t("createAccount")}
            </Link>
            <Link href={withLocalePath("/reset-password", locale)} className="btn">
              {t("forgotPassword")}
            </Link>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{status}</span>
          </div>
          {error ? <div style={{ fontSize: 12, color: "#ef4444" }}>{error}</div> : null}
        </form>
      </div>
    </div>
  );
}
