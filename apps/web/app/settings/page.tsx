"use client";

import { useEffect, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost } from "../../lib/api";

type MeResponse = {
  user: { id: string; email: string };
};

type ExchangeAccountItem = {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
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

const EXCHANGE_OPTIONS = [
  { value: "bitget", label: "Bitget (Futures)" },
  { value: "mexc", label: "MEXC (Legacy)" }
];

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function SettingsPage() {
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
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
  const passphraseRequired = exchange === "bitget";

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [meRes, accountRes] = await Promise.all([
        apiGet<MeResponse>("/auth/me"),
        apiGet<{ items: ExchangeAccountItem[] }>("/exchange-accounts")
      ]);
      setMe(meRes.user);
      setAccounts(accountRes.items ?? []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiPost("/exchange-accounts", {
        exchange,
        label,
        apiKey,
        apiSecret,
        passphrase: passphrase || undefined
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

  return (
    <div style={{ maxWidth: 980 }}>
      <h2 style={{ marginTop: 0 }}>Settings</h2>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        User self-service and exchange account management.
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
        <h3 style={{ marginTop: 0 }}>Account</h3>
        {loading ? <div>Loading...</div> : <div>{me?.email ?? "-"}</div>}
      </section>

      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Add Exchange Account</h3>
        <form onSubmit={createAccount} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Exchange</span>
              <select className="input" value={exchange} onChange={(e) => setExchange(e.target.value)} required>
                {EXCHANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Label</span>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>API Key</span>
            <input className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>API Secret</span>
            <input className="input" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} required />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {passphraseRequired ? "Passphrase (required for Bitget)" : "Passphrase (optional)"}
            </span>
            <input
              className="input"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required={passphraseRequired}
            />
          </label>
          <button
            className="btn btnPrimary"
            type="submit"
            disabled={saving || !exchange || !label || !apiKey || !apiSecret || (passphraseRequired && !passphrase)}
          >
            {saving ? "Saving..." : "Add account"}
          </button>
        </form>
      </section>

      <section className="card" style={{ padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Exchange Accounts</h3>
        {accounts.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>No accounts yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {accounts.map((account) => (
              <div key={account.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{account.label}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {account.exchange} · {account.apiKeyMasked}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Last sync: {account.lastUsedAt ? new Date(account.lastUsedAt).toLocaleString() : "Never"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
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
      </section>
    </div>
  );
}
