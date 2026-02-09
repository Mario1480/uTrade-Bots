"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiGet, apiPost } from "../../../lib/api";

type ExchangeAccount = {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function NewBotPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [exchangeAccountId, setExchangeAccountId] = useState("");
  const [strategyKey, setStrategyKey] = useState("dummy");
  const [marginMode, setMarginMode] = useState<"isolated" | "cross">("isolated");
  const [leverage, setLeverage] = useState(1);
  const [tickMs, setTickMs] = useState(1000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadAccounts() {
      try {
        const response = await apiGet<{ items: ExchangeAccount[] }>("/exchange-accounts");
        if (!mounted) return;
        const items = response.items ?? [];
        setAccounts(items);
        if (!exchangeAccountId && items.length > 0) {
          setExchangeAccountId(items[0].id);
        }
      } catch (e) {
        if (!mounted) return;
        setError(errMsg(e));
      }
    }
    void loadAccounts();
    return () => {
      mounted = false;
    };
  }, []);

  const canCreate = useMemo(() => {
    return Boolean(name.trim() && symbol.trim() && exchangeAccountId && !saving);
  }, [name, symbol, exchangeAccountId, saving]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const created = await apiPost<{ id: string }>("/bots", {
        name: name.trim(),
        symbol: symbol.trim(),
        exchangeAccountId,
        strategyKey,
        marginMode,
        leverage,
        tickMs,
        paramsJson: {}
      });
      router.push(`/bots/${created.id}`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/" className="btn">Back</Link>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0 }}>Create Bot</h2>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          Bot is bound to one exchange account.
        </div>

        {error ? <div style={{ marginBottom: 10, color: "#ef4444", fontSize: 13 }}>{error}</div> : null}

        {accounts.length === 0 ? (
          <div className="card" style={{ padding: 10 }}>
            <div style={{ marginBottom: 8 }}>No exchange account found.</div>
            <Link href="/settings" className="btn btnPrimary">Add exchange account</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Symbol</span>
              <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Exchange Account</span>
              <select className="input" value={exchangeAccountId} onChange={(e) => setExchangeAccountId(e.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} ({account.exchange})
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Strategy</span>
                <input className="input" value={strategyKey} onChange={(e) => setStrategyKey(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Margin Mode</span>
                <select className="input" value={marginMode} onChange={(e) => setMarginMode(e.target.value as "isolated" | "cross")}>
                  <option value="isolated">isolated</option>
                  <option value="cross">cross</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Leverage</span>
                <input className="input" type="number" min={1} max={125} value={leverage} onChange={(e) => setLeverage(Number(e.target.value || 1))} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Tick (ms)</span>
                <input className="input" type="number" min={100} max={60_000} value={tickMs} onChange={(e) => setTickMs(Number(e.target.value || 1000))} />
              </label>
            </div>

            <button className="btn btnPrimary" type="submit" disabled={!canCreate}>
              {saving ? "Creating..." : "Create Bot"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
