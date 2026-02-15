"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type Bot = {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  status: string;
  createdAt: string;
};

export default function Setup() {
  const t = useTranslations("settings.setup");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [msg, setMsg] = useState("");
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  async function loadBots() {
    try {
      setLoading(true);
      const list = await apiGet<Bot[]>("/bots");
      setBots(list);
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  async function removeBot(bot: Bot) {
    const ok = window.confirm(t("confirmDelete", { name: bot.name, symbol: bot.symbol }));
    if (!ok) return;
    setDeletingId(bot.id);
    try {
      await apiDelete(`/bots/${bot.id}`);
      setMsg(t("deleted", { name: bot.name }));
      await loadBots();
    } catch (e: any) {
      setMsg(errMsg(e));
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    loadBots();
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
        <Link href={withLocalePath("/", locale)} className="btn">
          ← {tCommon("backToDashboard")}
        </Link>
      </div>
      <h2>{t("title")}</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Link href={withLocalePath("/bots/new", locale)} className="btn btnPrimary">
          {t("newBot")}
        </Link>
        <button onClick={loadBots} className="btn">
          {t("refreshList")}
        </button>
      </div>
      {msg ? <p>{msg}</p> : null}

      <div className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("botsTitle")}</div>
        {loading ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{tCommon("loading")}</div>
        ) : bots.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("noBots")}</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {bots.map((bot) => (
              <div
                key={bot.id}
                className="card"
                style={{
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap"
                }}
              >
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 700 }}>{bot.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {bot.exchange} · {bot.symbol} · {bot.status}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link href={withLocalePath(`/bots/${bot.id}`, locale)} className="btn">
                    {t("open")}
                  </Link>
                  <button
                    className="btn btnStop"
                    onClick={() => removeBot(bot)}
                    disabled={deletingId === bot.id}
                  >
                    {deletingId === bot.id ? t("deleting") : t("delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
