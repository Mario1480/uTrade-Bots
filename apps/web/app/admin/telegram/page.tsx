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

export default function AdminTelegramPage() {
  const t = useTranslations("admin.telegram");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [telegramMasked, setTelegramMasked] = useState<string | null>(null);

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

      const telegramRes = await apiGet<any>("/admin/settings/telegram");
      setTelegramConfigured(Boolean(telegramRes.configured));
      setTelegramMasked(telegramRes.telegramBotTokenMasked ?? null);
      setTelegramChatId(telegramRes.telegramChatId ?? "");
      setTelegramToken("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveTelegram() {
    setError(null);
    setNotice(null);
    try {
      const payload = {
        telegramBotToken: telegramToken.trim() || null,
        telegramChatId: telegramChatId.trim() || null
      };
      const res = await apiPut<any>("/admin/settings/telegram", payload);
      setTelegramConfigured(Boolean(res.configured));
      setTelegramMasked(res.telegramBotTokenMasked ?? null);
      setTelegramToken("");
      setNotice(t("messages.saved"));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function testTelegram() {
    setError(null);
    setNotice(null);
    try {
      await apiPost("/admin/settings/telegram/test");
      setNotice(t("messages.testSent"));
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
        <section className="card settingsSection">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{t("sectionTitle")}</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {t("configured")}: {telegramConfigured ? t("yes") : t("no")}
            {telegramMasked ? ` · ${t("currentToken")} ${telegramMasked}` : ""}
          </div>
          <div className="settingsFormGrid">
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("botToken")}</span>
              <input
                className="input"
                placeholder={telegramMasked ?? "123456:ABC..."}
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
              />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("chatId")}</span>
              <input className="input" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btnPrimary" onClick={() => void saveTelegram()}>
                {t("saveTelegram")}
              </button>
              <button className="btn" onClick={() => void testTelegram()}>
                {t("sendTest")}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
