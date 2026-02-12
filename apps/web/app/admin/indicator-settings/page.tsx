"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";

type ScopeType = "global" | "account" | "symbol" | "symbol_tf";

type IndicatorSettingsConfig = {
  enabledPacks: {
    indicatorsV1: boolean;
    indicatorsV2: boolean;
    tradersReality: boolean;
    liquiditySweeps: boolean;
  };
  indicatorsV2: {
    stochrsi: { rsiLen: number; stochLen: number; smoothK: number; smoothD: number };
    volume: { lookback: number; emaFast: number; emaSlow: number };
    fvg: { lookback: number; fillRule: "overlap" | "mid_touch" };
  };
  tradersReality: {
    adrLen: number;
    awrLen: number;
    amrLen: number;
    rdLen: number;
    rwLen: number;
    openingRangeMin: number;
    sessionsUseDST: boolean;
  };
  liquiditySweeps: {
    len: number;
    mode: "wicks" | "outbreak_retest" | "both";
    extend: boolean;
    maxBars: number;
    maxRecentEvents: number;
    maxActiveZones: number;
  };
  aiGating: {
    minConfidenceForExplain: number;
    minChangeScore: number;
  };
};

type IndicatorSettingRow = {
  id: string;
  scopeType: ScopeType;
  exchange: string | null;
  accountId: string | null;
  symbol: string | null;
  timeframe: string | null;
  configPatch: Record<string, unknown>;
  configEffective: IndicatorSettingsConfig;
  updatedAt: string;
};

type ListResponse = { items: IndicatorSettingRow[] };

type ResolvedResponse = {
  config: IndicatorSettingsConfig;
  hash: string;
  breakdown: Array<{
    id: string;
    scopeType: ScopeType;
    exchange: string | null;
    accountId: string | null;
    symbol: string | null;
    timeframe: string | null;
    updatedAt: string;
  }>;
  defaults: IndicatorSettingsConfig;
};

const FALLBACK_DEFAULTS: IndicatorSettingsConfig = {
  enabledPacks: {
    indicatorsV1: true,
    indicatorsV2: true,
    tradersReality: true,
    liquiditySweeps: true
  },
  indicatorsV2: {
    stochrsi: { rsiLen: 14, stochLen: 14, smoothK: 3, smoothD: 3 },
    volume: { lookback: 100, emaFast: 10, emaSlow: 30 },
    fvg: { lookback: 300, fillRule: "overlap" }
  },
  tradersReality: {
    adrLen: 14,
    awrLen: 4,
    amrLen: 6,
    rdLen: 15,
    rwLen: 13,
    openingRangeMin: 30,
    sessionsUseDST: true
  },
  liquiditySweeps: {
    len: 5,
    mode: "both",
    extend: true,
    maxBars: 300,
    maxRecentEvents: 20,
    maxActiveZones: 20
  },
  aiGating: {
    minConfidenceForExplain: 55,
    minChangeScore: 0.2
  }
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function buildScopeLabel(row: {
  scopeType: ScopeType;
  exchange: string | null;
  accountId: string | null;
  symbol: string | null;
  timeframe: string | null;
}) {
  const parts: string[] = [row.scopeType];
  if (row.exchange) parts.push(`ex:${row.exchange}`);
  if (row.accountId) parts.push(`acc:${row.accountId.slice(0, 10)}…`);
  if (row.symbol) parts.push(`sym:${row.symbol}`);
  if (row.timeframe) parts.push(`tf:${row.timeframe}`);
  return parts.join(" · ");
}

export default function AdminIndicatorSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [items, setItems] = useState<IndicatorSettingRow[]>([]);
  const [resolved, setResolved] = useState<ResolvedResponse | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [scopeType, setScopeType] = useState<ScopeType>("global");
  const [exchange, setExchange] = useState("bitget");
  const [accountId, setAccountId] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<"5m" | "15m" | "1h" | "4h" | "1d">("15m");
  const [config, setConfig] = useState<IndicatorSettingsConfig>(FALLBACK_DEFAULTS);

  const canSave = useMemo(() => {
    if (scopeType === "account") return accountId.trim().length > 0;
    if (scopeType === "symbol") return symbol.trim().length > 0;
    if (scopeType === "symbol_tf") return symbol.trim().length > 0 && timeframe.trim().length > 0;
    return true;
  }, [accountId, scopeType, symbol, timeframe]);

  const loadAll = useCallback(async () => {
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
      const list = await apiGet<ListResponse>("/api/admin/indicator-settings");
      setItems(list.items ?? []);
      const firstResolved = await apiGet<ResolvedResponse>("/api/admin/indicator-settings/resolved");
      setResolved(firstResolved);
      setConfig(firstResolved.config ?? FALLBACK_DEFAULTS);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function refreshResolvedPreview() {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (exchange.trim()) params.set("exchange", exchange.trim());
      if (accountId.trim()) params.set("accountId", accountId.trim());
      if (symbol.trim()) params.set("symbol", symbol.trim());
      if (timeframe.trim()) params.set("timeframe", timeframe.trim());
      const query = params.toString();
      const next = await apiGet<ResolvedResponse>(
        `/api/admin/indicator-settings/resolved${query ? `?${query}` : ""}`
      );
      setResolved(next);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  function resetForm() {
    setEditingId(null);
    setScopeType("global");
    setExchange("bitget");
    setAccountId("");
    setSymbol("BTCUSDT");
    setTimeframe("15m");
    setConfig(resolved?.defaults ?? FALLBACK_DEFAULTS);
  }

  function applyRow(row: IndicatorSettingRow, clone = false) {
    setEditingId(clone ? null : row.id);
    setScopeType(row.scopeType);
    setExchange(row.exchange ?? "bitget");
    setAccountId(row.accountId ?? "");
    setSymbol(row.symbol ?? "BTCUSDT");
    setTimeframe((row.timeframe as any) ?? "15m");
    setConfig(row.configEffective ?? (resolved?.defaults ?? FALLBACK_DEFAULTS));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        scopeType,
        exchange: scopeType === "global" ? undefined : exchange.trim() || undefined,
        accountId: scopeType === "account" ? accountId.trim() : undefined,
        symbol: scopeType === "symbol" || scopeType === "symbol_tf" ? symbol.trim() : undefined,
        timeframe: scopeType === "symbol_tf" ? timeframe : undefined,
        config
      };

      if (editingId) {
        await apiPut(`/api/admin/indicator-settings/${editingId}`, payload);
        setNotice("Indicator setting updated.");
      } else {
        await apiPost("/api/admin/indicator-settings", payload);
        setNotice("Indicator setting created.");
      }

      await loadAll();
      await refreshResolvedPreview();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(id: string) {
    if (!confirm("Delete this indicator setting?")) return;
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/api/admin/indicator-settings/${id}`);
      if (editingId === id) resetForm();
      setNotice("Indicator setting deleted.");
      await loadAll();
      await refreshResolvedPreview();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="settingsWrap">
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/admin" className="btn">← Back to admin</Link>
        <Link href="/settings" className="btn">← Back to settings</Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Admin · Indicator Settings</h2>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        Configure global defaults and scoped overrides for prediction feature packs.
      </div>

      {loading ? <div>Loading...</div> : null}
      {error ? <div className="card settingsSection" style={{ borderColor: "#ef4444", marginBottom: 12 }}>{error}</div> : null}
      {notice ? <div className="card settingsSection" style={{ borderColor: "#22c55e", marginBottom: 12 }}>{notice}</div> : null}

      {isSuperadmin ? (
        <>
          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>{editingId ? "Edit override" : "Create override"}</h3></div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Scope</span>
                <select className="input" value={scopeType} onChange={(e) => setScopeType(e.target.value as ScopeType)}>
                  <option value="global">global</option>
                  <option value="account">account</option>
                  <option value="symbol">symbol</option>
                  <option value="symbol_tf">symbol_tf</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Exchange</span>
                <input className="input" value={exchange} onChange={(e) => setExchange(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Account ID</span>
                <input className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={scopeType !== "account"} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Symbol</span>
                <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} disabled={scopeType !== "symbol" && scopeType !== "symbol_tf"} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Timeframe</span>
                <select className="input" value={timeframe} onChange={(e) => setTimeframe(e.target.value as any)} disabled={scopeType !== "symbol_tf"}>
                  <option value="5m">5m</option>
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                  <option value="1d">1d</option>
                </select>
              </label>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
              <label className="inlineCheck"><input type="checkbox" checked={config.enabledPacks.indicatorsV1} onChange={(e) => setConfig((prev) => ({ ...prev, enabledPacks: { ...prev.enabledPacks, indicatorsV1: e.target.checked } }))} /> Indicators V1</label>
              <label className="inlineCheck"><input type="checkbox" checked={config.enabledPacks.indicatorsV2} onChange={(e) => setConfig((prev) => ({ ...prev, enabledPacks: { ...prev.enabledPacks, indicatorsV2: e.target.checked } }))} /> Indicators V2</label>
              <label className="inlineCheck"><input type="checkbox" checked={config.enabledPacks.tradersReality} onChange={(e) => setConfig((prev) => ({ ...prev, enabledPacks: { ...prev.enabledPacks, tradersReality: e.target.checked } }))} /> TradersReality</label>
              <label className="inlineCheck"><input type="checkbox" checked={config.enabledPacks.liquiditySweeps} onChange={(e) => setConfig((prev) => ({ ...prev, enabledPacks: { ...prev.enabledPacks, liquiditySweeps: e.target.checked } }))} /> Liquidity Sweeps</label>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">Stoch RSI len</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.rsiLen} onChange={(e) => setConfig((prev) => ({ ...prev, indicatorsV2: { ...prev.indicatorsV2, stochrsi: { ...prev.indicatorsV2.stochrsi, rsiLen: Number(e.target.value) } } }))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">Stoch len</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.stochLen} onChange={(e) => setConfig((prev) => ({ ...prev, indicatorsV2: { ...prev.indicatorsV2, stochrsi: { ...prev.indicatorsV2.stochrsi, stochLen: Number(e.target.value) } } }))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">Volume lookback</span><input className="input" type="number" value={config.indicatorsV2.volume.lookback} onChange={(e) => setConfig((prev) => ({ ...prev, indicatorsV2: { ...prev.indicatorsV2, volume: { ...prev.indicatorsV2.volume, lookback: Number(e.target.value) } } }))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">FVG lookback</span><input className="input" type="number" value={config.indicatorsV2.fvg.lookback} onChange={(e) => setConfig((prev) => ({ ...prev, indicatorsV2: { ...prev.indicatorsV2, fvg: { ...prev.indicatorsV2.fvg, lookback: Number(e.target.value) } } }))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">FVG fill rule</span><select className="input" value={config.indicatorsV2.fvg.fillRule} onChange={(e) => setConfig((prev) => ({ ...prev, indicatorsV2: { ...prev.indicatorsV2, fvg: { ...prev.indicatorsV2.fvg, fillRule: e.target.value as any } } }))}><option value="overlap">overlap</option><option value="mid_touch">mid_touch</option></select></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">TR opening range (min)</span><input className="input" type="number" value={config.tradersReality.openingRangeMin} onChange={(e) => setConfig((prev) => ({ ...prev, tradersReality: { ...prev.tradersReality, openingRangeMin: Number(e.target.value) } }))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">ADR len</span><input className="input" type="number" value={config.tradersReality.adrLen} onChange={(e) => setConfig((prev) => ({ ...prev, tradersReality: { ...prev.tradersReality, adrLen: Number(e.target.value) } }))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">AWR len</span><input className="input" type="number" value={config.tradersReality.awrLen} onChange={(e) => setConfig((prev) => ({ ...prev, tradersReality: { ...prev.tradersReality, awrLen: Number(e.target.value) } }))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">AMR len</span><input className="input" type="number" value={config.tradersReality.amrLen} onChange={(e) => setConfig((prev) => ({ ...prev, tradersReality: { ...prev.tradersReality, amrLen: Number(e.target.value) } }))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">RD len</span><input className="input" type="number" value={config.tradersReality.rdLen} onChange={(e) => setConfig((prev) => ({ ...prev, tradersReality: { ...prev.tradersReality, rdLen: Number(e.target.value) } }))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">RW len</span><input className="input" type="number" value={config.tradersReality.rwLen} onChange={(e) => setConfig((prev) => ({ ...prev, tradersReality: { ...prev.tradersReality, rwLen: Number(e.target.value) } }))} /></label>
              <label className="inlineCheck"><input type="checkbox" checked={config.tradersReality.sessionsUseDST} onChange={(e) => setConfig((prev) => ({ ...prev, tradersReality: { ...prev.tradersReality, sessionsUseDST: e.target.checked } }))} /> Sessions use DST</label>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button className="btn btnPrimary" type="button" disabled={saving || !canSave} onClick={save}>{saving ? "Saving..." : editingId ? "Update override" : "Create override"}</button>
              <button className="btn" type="button" onClick={() => void refreshResolvedPreview()}>Preview resolved</button>
              <button className="btn" type="button" onClick={resetForm}>Reset form</button>
            </div>
          </section>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>Overrides</h3></div>
            {items.length === 0 ? <div style={{ color: "var(--muted)" }}>No overrides yet.</div> : (
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Scope</th>
                      <th>Updated</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id}>
                        <td>{buildScopeLabel(row)}</td>
                        <td>{new Date(row.updatedAt).toLocaleString()}</td>
                        <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn" type="button" onClick={() => applyRow(row)}>Edit</button>
                          <button className="btn" type="button" onClick={() => applyRow(row, true)}>Clone</button>
                          <button className="btn" type="button" onClick={() => void removeRow(row.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>Effective config preview</h3></div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              Hash: {resolved?.hash ?? "-"}
            </div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
              {JSON.stringify(resolved?.config ?? FALLBACK_DEFAULTS, null, 2)}
            </pre>
          </section>
        </>
      ) : null}
    </div>
  );
}
