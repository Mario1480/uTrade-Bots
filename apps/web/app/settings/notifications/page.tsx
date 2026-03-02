"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type CalendarImpact = "low" | "medium" | "high";

const IMPACT_ORDER: CalendarImpact[] = ["high", "medium", "low"];
const CALENDAR_CURRENCIES = [
  { code: "USD", flag: "🇺🇸" },
  { code: "EUR", flag: "🇪🇺" },
  { code: "GBP", flag: "🇬🇧" },
  { code: "JPY", flag: "🇯🇵" },
  { code: "CHF", flag: "🇨🇭" },
  { code: "CAD", flag: "🇨🇦" },
  { code: "AUD", flag: "🇦🇺" },
  { code: "NZD", flag: "🇳🇿" },
  { code: "CNY", flag: "🇨🇳" }
] as const;

function resolveBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz.trim().length > 0) return tz.trim();
  } catch {
    // ignore
  }
  return "UTC";
}

function normalizeImpacts(raw: unknown): CalendarImpact[] {
  if (!Array.isArray(raw)) return ["high"];
  const parsed = raw
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry): entry is CalendarImpact => (
      entry === "low" || entry === "medium" || entry === "high"
    ));
  if (parsed.length === 0) return ["high"];
  return IMPACT_ORDER.filter((entry) => parsed.includes(entry));
}

function normalizeCurrencies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["USD"];
  const allowed = new Set<string>(CALENDAR_CURRENCIES.map((entry) => entry.code));
  const parsed = raw
    .map((entry) => String(entry).trim().toUpperCase())
    .filter((entry) => allowed.has(entry))
    .filter((entry, index, list) => list.indexOf(entry) === index);
  return parsed.length > 0 ? parsed : ["USD"];
}

export default function NotificationsPage() {
  const t = useTranslations("settings.notifications");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [chatId, setChatId] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dailyEnabled, setDailyEnabled] = useState(false);
  const [dailyCurrencies, setDailyCurrencies] = useState<string[]>(["USD"]);
  const [dailyImpacts, setDailyImpacts] = useState<CalendarImpact[]>(["high"]);
  const [dailySendTimeLocal, setDailySendTimeLocal] = useState("08:00");
  const [dailyTimezone, setDailyTimezone] = useState<string>(resolveBrowserTimezone());

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
        dailyEconomicCalendar?: {
          enabled?: boolean;
          currencies?: string[];
          impacts?: CalendarImpact[];
          sendTimeLocal?: string;
          timezone?: string;
        };
      }>(
        "/settings/alerts"
      );
      setChatId(data.telegramChatId ?? "");
      setTokenConfigured(Boolean(data.telegramBotConfigured));
      setDailyEnabled(Boolean(data.dailyEconomicCalendar?.enabled));
      setDailyCurrencies(normalizeCurrencies(data.dailyEconomicCalendar?.currencies));
      setDailyImpacts(normalizeImpacts(data.dailyEconomicCalendar?.impacts));
      setDailySendTimeLocal(
        typeof data.dailyEconomicCalendar?.sendTimeLocal === "string"
          ? data.dailyEconomicCalendar.sendTimeLocal
          : "08:00"
      );
      const loadedTimezone = typeof data.dailyEconomicCalendar?.timezone === "string"
        ? data.dailyEconomicCalendar.timezone.trim()
        : "";
      setDailyTimezone(loadedTimezone || resolveBrowserTimezone());
    } catch {
      // ignore
    }
  }

  async function saveConfig() {
    setSaving(true);
    setMsg(null);
    try {
      const timezone = dailyTimezone.trim() || resolveBrowserTimezone();
      const sendTimeLocal = /^([01]\d|2[0-3]):([0-5]\d)$/.test(dailySendTimeLocal)
        ? dailySendTimeLocal
        : "08:00";
      await apiPut("/settings/alerts", {
        telegramChatId: chatId.trim() || null,
        dailyEconomicCalendar: {
          enabled: dailyEnabled,
          currencies: normalizeCurrencies(dailyCurrencies),
          impacts: normalizeImpacts(dailyImpacts),
          sendTimeLocal,
          timezone
        }
      });
      setDailySendTimeLocal(sendTimeLocal);
      setDailyTimezone(timezone);
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

  function toggleCurrency(code: string) {
    setDailyCurrencies((current) => {
      if (current.includes(code)) {
        if (current.length <= 1) return current;
        return current.filter((entry) => entry !== code);
      }
      return normalizeCurrencies([...current, code]);
    });
  }

  function toggleImpact(value: CalendarImpact) {
    setDailyImpacts((current) => {
      if (current.includes(value)) {
        if (current.length <= 1) return current;
        return current.filter((entry) => entry !== value);
      }
      return normalizeImpacts([...current, value]);
    });
  }

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
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>{t("dailyCalendar.title")}</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {t("dailyCalendar.description")}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={dailyEnabled}
                onChange={(e) => setDailyEnabled(e.target.checked)}
              />
              <span>{t("dailyCalendar.enabledLabel")}</span>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("dailyCalendar.sendTimeLocal")}</span>
              <input
                type="time"
                className="input"
                value={dailySendTimeLocal}
                onChange={(e) => setDailySendTimeLocal(e.target.value)}
              />
            </label>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("dailyCalendar.timezone")}: <b>{dailyTimezone}</b>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("dailyCalendar.currencies")}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {CALENDAR_CURRENCIES.map((entry) => {
                  const active = dailyCurrencies.includes(entry.code);
                  return (
                    <button
                      key={entry.code}
                      type="button"
                      className="badge"
                      style={{ opacity: active ? 1 : 0.6, cursor: "pointer" }}
                      onClick={() => toggleCurrency(entry.code)}
                    >
                      {entry.flag} {entry.code}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("dailyCalendar.impacts")}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {IMPACT_ORDER.map((impact) => {
                  const active = dailyImpacts.includes(impact);
                  return (
                    <button
                      key={impact}
                      type="button"
                      className="badge"
                      style={{ opacity: active ? 1 : 0.6, cursor: "pointer" }}
                      onClick={() => toggleImpact(impact)}
                    >
                      {t(`dailyCalendar.impact.${impact}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
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
