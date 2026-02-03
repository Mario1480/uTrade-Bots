"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReauthDialog from "../../components/ReauthDialog";
import { useSystemSettings } from "../../components/SystemBanner";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";

type CexConfig = {
  exchange: string;
  apiKey: string;
  apiSecret: string;
  apiMemo?: string | null;
  updatedAt?: string;
};

type SubscriptionStatus = {
  limits: {
    includedBots: number;
    addOnBots: number;
    includedCex: number;
    addOnCex: number;
  } | null;
  overrides: {
    manual: boolean;
    unlimited: boolean;
    note?: string;
  } | null;
  usage?: {
    bots: number;
    cex: number;
  } | null;
  status: string | null;
  configured: boolean;
};

const EXCHANGES = [
  { label: "Bitmart", value: "bitmart" },
  { label: "Coinstore", value: "coinstore" },
  { label: "Pionex", value: "pionex" },
  { label: "P2B", value: "p2b" }
];
const DEFAULT_EXCHANGE = "bitmart";

export default function ExchangeAccountsPage() {
  const [items, setItems] = useState<CexConfig[]>([]);
  const [exchange, setExchange] = useState(DEFAULT_EXCHANGE);
  const [onlyConfigured, setOnlyConfigured] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const systemSettings = useSystemSettings();
  const isReadOnly = systemSettings.readOnlyMode;
  const [form, setForm] = useState<CexConfig>({
    exchange: DEFAULT_EXCHANGE,
    apiKey: "",
    apiSecret: "",
    apiMemo: ""
  });
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [licenseStatus, setLicenseStatus] = useState<SubscriptionStatus | null>(null);

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  function isReauthError(e: any) {
    return e instanceof ApiError && e.status === 401 && e.payload?.error === "REAUTH_REQUIRED";
  }

  function requireReauth(next: () => Promise<void>) {
    setPendingAction(() => next);
    setReauthOpen(true);
  }

  function handleReauthError(e: any, retry: () => Promise<void>) {
    if (isReauthError(e)) {
      setUnlocked(false);
      setError("Re-auth required to manage keys.");
      requireReauth(retry);
      return true;
    }
    return false;
  }

  async function loadList() {
    const list = await apiGet<CexConfig[]>("/settings/cex");
    setItems(list);
  }

  async function loadLicenseStatus() {
    try {
      const data = await apiGet<SubscriptionStatus>("/settings/subscription");
      setLicenseStatus(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setLicenseStatus(null);
        return;
      }
      setLicenseStatus(null);
    }
  }

  async function loadSelected(nextExchange: string) {
    const cfg = await apiGet<CexConfig | null>(`/settings/cex/${nextExchange}`);
    if (cfg) {
      setForm({
        exchange: cfg.exchange,
        apiKey: cfg.apiKey ?? "",
        apiSecret: cfg.apiSecret ?? "",
        apiMemo: cfg.apiMemo ?? ""
      });
    } else {
      setForm({ exchange: nextExchange, apiKey: "", apiSecret: "", apiMemo: "" });
    }
  }

  useEffect(() => {
    async function load() {
      setStatus("loading...");
      setError("");
      try {
        await loadList();
        const reauth = await apiGet<{ ok: boolean }>("/auth/reauth/status");
        if (reauth?.ok) {
          setUnlocked(true);
          await loadSelected(exchange);
        } else {
          setUnlocked(false);
          setForm({ exchange, apiKey: "", apiSecret: "", apiMemo: "" });
        }
        setStatus("");
      } catch (e) {
        setStatus("");
        if (isReauthError(e)) {
          setUnlocked(false);
          requireReauth(async () => {
            await loadList();
            const reauth = await apiGet<{ ok: boolean }>("/auth/reauth/status");
            if (reauth?.ok) {
              setUnlocked(true);
              await loadSelected(exchange);
            }
          });
        } else {
          setError(errMsg(e));
        }
      }
    }
    load();
  }, [exchange]);

  useEffect(() => {
    loadLicenseStatus();
  }, []);

  async function unlock() {
    requireReauth(async () => {
      setUnlocked(true);
      await loadSelected(exchange);
      setStatus("unlocked");
      setTimeout(() => setStatus(""), 1200);
    });
  }

  async function handleReauthVerified() {
    setUnlocked(true);
    if (pendingAction) {
      const action = pendingAction;
      setPendingAction(null);
      await action();
    }
  }

  async function save() {
    if (!unlocked) {
      setError("Unlock required to edit keys.");
      return;
    }
    setStatus("saving...");
    setError("");
    try {
      await apiPut("/settings/cex", {
        exchange,
        apiKey: form.apiKey,
        apiSecret: form.apiSecret,
        apiMemo: form.apiMemo ? form.apiMemo : undefined
      });
      await loadList();
      setStatus("saved");
      setTimeout(() => setStatus(""), 1200);
    } catch (e) {
      if (!handleReauthError(e, save)) {
        setStatus("");
        setError(errMsg(e));
      }
    }
  }

  async function verify() {
    if (!unlocked) {
      setError("Unlock required to verify keys.");
      return;
    }
    setStatus("verifying...");
    setError("");
    try {
      await apiPost("/settings/cex/verify", {
        exchange,
        apiKey: form.apiKey,
        apiSecret: form.apiSecret,
        apiMemo: form.apiMemo ? form.apiMemo : undefined
      });
      setStatus("verified");
      setTimeout(() => setStatus(""), 1200);
    } catch (e) {
      if (!handleReauthError(e, verify)) {
        setStatus("");
        setError(errMsg(e));
      }
    }
  }

  async function remove(exchangeId: string) {
    if (!unlocked) {
      setError("Unlock required to delete keys.");
      return;
    }
    setStatus("removing...");
    setError("");
    try {
      await apiDelete(`/settings/cex/${exchangeId}`);
      await loadList();
      if (exchangeId === exchange) {
        setExchange(DEFAULT_EXCHANGE);
      }
      setStatus("");
    } catch (e) {
      if (!handleReauthError(e, () => remove(exchangeId))) {
        setStatus("");
        setError(errMsg(e));
      }
    }
  }

  function selectCard(cfg: CexConfig) {
    setExchange(cfg.exchange);
  }

  function addNew() {
    setExchange(DEFAULT_EXCHANGE);
    setForm({ exchange: DEFAULT_EXCHANGE, apiKey: "", apiSecret: "", apiMemo: "" });
  }

  const filtered = onlyConfigured
    ? items.filter((cfg) => Boolean(cfg.apiKey) && Boolean(cfg.apiSecret))
    : items;
  const maxCex = licenseStatus?.overrides?.unlimited
    ? null
    : licenseStatus?.limits
      ? licenseStatus.limits.includedCex + licenseStatus.limits.addOnCex
      : null;
  const usedCex = licenseStatus?.usage?.cex ?? items.length;
  const limitReached = typeof maxCex === "number" ? usedCex >= maxCex : false;

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
        <Link href="/" className="btn">
          ← Back to dashboard
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Exchange accounts</h2>
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 12 }}>
        Manage your connected trading accounts.
      </div>

      <div className="homeGrid homeGridEqual">
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Accounts</h3>
            <button
              className={`btn btnPrimary ${isReadOnly || limitReached ? "btnDisabled" : ""}`}
              onClick={addNew}
              disabled={isReadOnly || limitReached}
              title={limitReached ? "CEX limit reached for your subscription." : undefined}
            >
              Add CEX
            </button>
          </div>
          {limitReached ? (
            <div style={{ fontSize: 12, color: "var(--warn)", marginBottom: 8 }}>
              CEX limit reached for your subscription.
            </div>
          ) : null}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={onlyConfigured}
              onChange={(e) => setOnlyConfigured(e.target.checked)}
            />
            Show only configured
          </label>
          <div style={{ display: "grid", gap: 10 }}>
            {filtered.length === 0 ? (
              <div className="card" style={{ padding: 12, fontSize: 13 }}>
                No CEX configs yet. Add one to start live testing.
              </div>
            ) : (
              filtered.map((cfg) => (
                <div
                  key={cfg.exchange}
                  className="card"
                  style={{
                    padding: 12,
                    borderColor: cfg.exchange === exchange ? "var(--brand)" : undefined
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 18 }}>{exchangeIcon(cfg.exchange)}</span>
                          <span>{cfg.exchange}</span>
                        </div>
                        {isConfigured(cfg) ? (
                          <span className="badge badgeOk">configured</span>
                        ) : (
                          <span className="badge badgeWarn">missing secret</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {maskKey(cfg.apiKey)} · Updated {formatTime(cfg.updatedAt)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className={`btn ${isReadOnly ? "btnDisabled" : ""}`}
                        onClick={() => selectCard(cfg)}
                        disabled={isReadOnly}
                      >
                        Edit
                      </button>
                      <button
                        className={`btn btnStop ${isReadOnly ? "btnDisabled" : ""}`}
                        onClick={() => remove(cfg.exchange)}
                        disabled={isReadOnly}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          {!unlocked && (
            <Section title="Unlock to edit">
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
                Re-authentication is required to view or edit exchange keys.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={unlock}
                  className={`btn btnPrimary ${isReadOnly ? "btnDisabled" : ""}`}
                  disabled={isReadOnly}
                >
                  Send OTP & Unlock
                </button>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  Unlock lasts 10 minutes.
                </span>
              </div>
            </Section>
          )}
          <Section title="CEX API">
            <Field label="exchange">
              <select
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
                className="input"
              >
                {EXCHANGES.map((ex) => (
                  <option key={ex.value} value={ex.value}>
                    {ex.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="apiKey">
              <input
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                className="input"
                disabled={!unlocked || isReadOnly}
              />
            </Field>
            <Field label="apiSecret">
              <input
                type="password"
                value={form.apiSecret}
                onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
                className="input"
                disabled={!unlocked || isReadOnly}
              />
            </Field>
            <Field label="apiMemo">
              <input
                value={form.apiMemo ?? ""}
                onChange={(e) => setForm({ ...form, apiMemo: e.target.value })}
                className="input"
                placeholder="optional"
                disabled={!unlocked || isReadOnly}
              />
            </Field>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={save} className={`btn btnPrimary ${isReadOnly ? "btnDisabled" : ""}`} disabled={isReadOnly}>
                Save
              </button>
              <button onClick={verify} className={`btn ${isReadOnly ? "btnDisabled" : ""}`} disabled={isReadOnly}>
                Verify credentials
              </button>
              <span style={{ fontSize: 12, opacity: 0.7 }}>{status}</span>
            </div>
          </Section>
        </div>
      </div>

      <ReauthDialog
        open={reauthOpen}
        onClose={() => {
          setReauthOpen(false);
          setPendingAction(null);
        }}
        onVerified={handleReauthVerified}
      />

      {error ? (
        <div style={{ marginTop: 12, padding: "8px 10px", border: "1px solid #f5b5b5", borderRadius: 8, background: "#fff5f5" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>{props.title}</h3>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="fieldRow">
      <span style={{ fontSize: 13 }}>{props.label}</span>
      {props.children}
    </label>
  );
}

function maskKey(key: string) {
  if (!key) return "—";
  if (key.length <= 6) return `${key.slice(0, 2)}•••`;
  return `${key.slice(0, 4)}•••${key.slice(-2)}`;
}

function isConfigured(cfg: CexConfig) {
  return Boolean(cfg.apiKey) && Boolean(cfg.apiSecret);
}

function exchangeIcon(exchange: string) {
  const key = exchange.toLowerCase();
  if (key === "bitmart") return "🟡";
  if (key === "coinstore") return "🟦";
  if (key === "pionex") return "🟣";
  if (key === "p2b") return "🟩";
  return "💱";
}

function formatTime(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}
