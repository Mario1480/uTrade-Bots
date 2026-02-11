"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPost, apiPut } from "../../lib/api";

type AdminUser = {
  id: string;
  email: string;
  isSuperadmin: boolean;
  createdAt: string;
  updatedAt: string;
  sessions: number;
  exchangeAccounts: number;
  bots: number;
  workspaceMemberships: number;
};

type ExchangeOption = {
  value: string;
  label: string;
  enabled: boolean;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminPage() {
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetPassword, setResetPassword] = useState<Record<string, string>>({});

  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [telegramMasked, setTelegramMasked] = useState<string | null>(null);

  const [exchangeOptions, setExchangeOptions] = useState<ExchangeOption[]>([]);

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpHasPassword, setSmtpHasPassword] = useState(false);
  const [smtpTestTo, setSmtpTestTo] = useState("");

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!me?.isSuperadmin) {
        setIsSuperadmin(false);
        setUsers([]);
        setError("Superadmin access required.");
        return;
      }
      setIsSuperadmin(true);

      const [usersRes, telegramRes, exchangesRes, smtpRes] = await Promise.all([
        apiGet<{ items: AdminUser[] }>("/admin/users"),
        apiGet<any>("/admin/settings/telegram"),
        apiGet<{ options: ExchangeOption[] }>("/admin/settings/exchanges"),
        apiGet<any>("/admin/settings/smtp")
      ]);

      setUsers(usersRes.items ?? []);
      setTelegramConfigured(Boolean(telegramRes.configured));
      setTelegramMasked(telegramRes.telegramBotTokenMasked ?? null);
      setTelegramChatId(telegramRes.telegramChatId ?? "");
      setTelegramToken("");
      setExchangeOptions(exchangesRes.options ?? []);

      setSmtpHost(smtpRes.host ?? "");
      setSmtpPort(String(smtpRes.port ?? 465));
      setSmtpUser(smtpRes.user ?? "");
      setSmtpFrom(smtpRes.from ?? "");
      setSmtpSecure(Boolean(smtpRes.secure));
      setSmtpHasPassword(Boolean(smtpRes.hasPassword));
      setSmtpPassword("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await apiPost<any>("/admin/users", {
        email: newEmail,
        password: newPassword.trim() || undefined
      });
      setNewEmail("");
      setNewPassword("");
      setNotice(
        res.temporaryPassword
          ? `User created. Temporary password: ${res.temporaryPassword}`
          : "User created."
      );
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function updateUserPassword(userId: string) {
    const value = resetPassword[userId]?.trim();
    if (!value) return;
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/admin/users/${userId}/password`, { password: value });
      setResetPassword((prev) => ({ ...prev, [userId]: "" }));
      setNotice("Password updated and sessions revoked.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

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

  async function saveExchanges() {
    setError(null);
    setNotice(null);
    try {
      const allowed = exchangeOptions.filter((item) => item.enabled).map((item) => item.value);
      const res = await apiPut<{ options: ExchangeOption[] }>("/admin/settings/exchanges", { allowed });
      setExchangeOptions(res.options ?? []);
      setNotice("Exchange offer updated.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function saveSmtp() {
    setError(null);
    setNotice(null);
    try {
      const payload: any = {
        host: smtpHost,
        port: Number(smtpPort),
        user: smtpUser,
        from: smtpFrom,
        secure: smtpSecure
      };
      if (smtpPassword.trim()) payload.password = smtpPassword.trim();
      const res = await apiPut<any>("/admin/settings/smtp", payload);
      setSmtpHasPassword(Boolean(res.hasPassword));
      setSmtpPassword("");
      setNotice("SMTP settings saved.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function testSmtp() {
    setError(null);
    setNotice(null);
    try {
      await apiPost("/admin/settings/smtp/test", { to: smtpTestTo.trim() });
      setNotice("SMTP test email sent.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  if (loading) {
    return <div>Loading admin backend...</div>;
  }

  if (!isSuperadmin) {
    return (
      <div style={{ maxWidth: 980 }}>
        <h2 style={{ marginTop: 0 }}>Admin</h2>
        <div className="card" style={{ padding: 12, borderColor: "#ef4444" }}>
          Superadmin access required.
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
        <Link href="/" className="btn">
          ← Back to dashboard
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Admin Backend</h2>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        User management, global Telegram, offered CEX list and SMTP.
      </div>

      {error ? (
        <div className="card" style={{ padding: 10, borderColor: "#ef4444", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="card" style={{ padding: 10, borderColor: "#22c55e", marginBottom: 12 }}>
          {notice}
        </div>
      ) : null}

      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Users</h3>
        <form onSubmit={createUser} style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Email</span>
            <input className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Temporary password (optional)</span>
            <input className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
          <button className="btn btnPrimary" type="submit">
            Create user
          </button>
        </form>

        <div style={{ display: "grid", gap: 8 }}>
          {users.map((user) => (
            <div key={user.id} className="card" style={{ padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {user.email} {user.isSuperadmin ? "· superadmin" : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Bots: {user.bots} · Accounts: {user.exchangeAccounts} · Sessions: {user.sessions}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="input"
                    placeholder="New password"
                    value={resetPassword[user.id] ?? ""}
                    onChange={(e) => setResetPassword((prev) => ({ ...prev, [user.id]: e.target.value }))}
                  />
                  <button className="btn" onClick={() => void updateUserPassword(user.id)}>
                    Set password
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Global Telegram</h3>
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
            <button className="btn btnPrimary" onClick={saveTelegram}>
              Save Telegram
            </button>
            <button className="btn" onClick={testTelegram}>
              Send test
            </button>
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Offered Exchanges</h3>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          Enabled exchanges are shown to users in exchange account setup.
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {exchangeOptions.map((option, idx) => (
            <label key={option.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={option.enabled}
                onChange={(e) =>
                  setExchangeOptions((prev) =>
                    prev.map((item, i) => (i === idx ? { ...item, enabled: e.target.checked } : item))
                  )
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <button className="btn btnPrimary" onClick={saveExchanges}>
            Save exchanges
          </button>
        </div>
      </section>

      <section className="card" style={{ padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>SMTP</h3>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          Password stored: {smtpHasPassword ? "yes" : "no"}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Host</span>
            <input className="input" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Port</span>
            <input className="input" type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>User</span>
            <input className="input" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>From</span>
            <input className="input" value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
            <span>Use secure connection</span>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Password (leave empty to keep)</span>
            <input
              className="input"
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btnPrimary" onClick={saveSmtp}>
              Save SMTP
            </button>
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Test recipient</span>
            <input className="input" value={smtpTestTo} onChange={(e) => setSmtpTestTo(e.target.value)} />
          </label>
          <div>
            <button className="btn" onClick={testSmtp} disabled={!smtpTestTo.trim()}>
              Send SMTP test
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
