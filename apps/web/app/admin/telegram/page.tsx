"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminTelegramPage() {
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
      if (!me?.isSuperadmin) {
        setIsSuperadmin(false);
        setError("Superadmin access required.");
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
      setNotice("Telegram settings saved.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function testTelegram() {
    setError(null);
    setNotice(null);
    try {
      await apiPost("/admin/settings/telegram/test");
      setNotice("Telegram test sent.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="settingsWrap">
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/admin" className="btn">
          ← Back to admin
        </Link>
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Admin · Global Telegram</h2>

      {loading ? <div>Loading...</div> : null}
      {error ? (
        <div className="card settingsSection" style={{ borderColor: "#ef4444", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="card settingsSection" style={{ borderColor: "#22c55e", marginBottom: 12 }}>
          {notice}
        </div>
      ) : null}

      {isSuperadmin ? (
        <section className="card settingsSection">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>Telegram Settings</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Configured: {telegramConfigured ? "yes" : "no"}
            {telegramMasked ? ` · current token ${telegramMasked}` : ""}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Bot token</span>
              <input
                className="input"
                placeholder={telegramMasked ?? "123456:ABC..."}
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Chat ID</span>
              <input className="input" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btnPrimary" onClick={() => void saveTelegram()}>
                Save Telegram
              </button>
              <button className="btn" onClick={() => void testTelegram()}>
                Send test
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
