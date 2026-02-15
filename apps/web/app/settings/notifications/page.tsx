"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

export default function NotificationsPage() {
  const t = useTranslations("settings.notifications");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [chatId, setChatId] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [saving, setSaving] = useState(false);

  function errMsg(e: any): string {
    if (e instanceof ApiError) {
      const detail = e.payload?.details ? ` — ${e.payload.details}` : "";
      return `${e.message}${detail} (HTTP ${e.status})`;
    }
    return e?.message ? String(e.message) : String(e);
  }

  async function sendTest() {
    setSending(true);
    setMsg(null);
    try {
      await apiPost("/alerts/test");
      setMsg(t("messages.testSent"));
    } catch (e) {
      const message = errMsg(e);
      setMsg(message.includes("telegram_not_configured") ? message : message);
    } finally {
      setSending(false);
    }
  }

  async function loadConfig() {
    try {
      const data = await apiGet<{
        telegramChatId?: string | null;
        telegramBotConfigured?: boolean;
      }>(
        "/settings/alerts"
      );
      setChatId(data.telegramChatId ?? "");
      setTokenConfigured(Boolean(data.telegramBotConfigured));
    } catch {
      // ignore
    }
  }

  async function saveConfig() {
    setSaving(true);
    setMsg(null);
    try {
      await apiPut("/settings/alerts", {
        telegramChatId: chatId.trim() || null
      });
      setMsg(t("messages.saved"));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadConfig();
  }, []);

  return (
    <div className="settingsWrap">
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
        <Link href={withLocalePath("/", locale)} className="btn">
          ← {tCommon("backToDashboard")}
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="card settingsSection" style={{ fontSize: 13 }}>
        <div className="settingsSectionHeader">
          <div style={{ fontWeight: 700 }}>{t("telegram.title")}</div>
          <a
            className="btn"
            href="https://t.me/utrade_ai_signals_bot"
            target="_blank"
            rel="noreferrer"
          >
            {t("telegram.openBot")}
          </a>
        </div>
        <div style={{ color: "var(--muted)", marginBottom: 10 }}>
          {t("telegram.description")}
        </div>
        {!tokenConfigured ? (
          <div style={{ color: "#fca5a5", marginBottom: 10, fontSize: 12 }}>
            {t("telegram.tokenMissing")}
          </div>
        ) : null}
        <div style={{ color: "var(--muted)", marginBottom: 10 }}>
          {t.rich("telegram.tip", {
            strong: (chunks) => <b>{chunks}</b>
          })}
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("telegram.chatId")}</span>
            <input
              className="input"
              placeholder="123456789"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button className="btn btnPrimary" onClick={saveConfig} disabled={saving}>
            {saving ? tCommon("saving") : tCommon("saveSettings")}
          </button>
          <button className="btn" onClick={sendTest} disabled={sending}>
            {sending ? t("messages.sending") : t("messages.sendTest")}
          </button>
        </div>
        {msg ? (
          <div style={{ marginTop: 10, color: "var(--muted)" }}>{msg}</div>
        ) : null}
      </div>
    </div>
  );
}
