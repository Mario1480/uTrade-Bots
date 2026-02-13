"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";

type ScopeType = "global" | "account" | "symbol" | "symbol_tf";
type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d";

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

type CatalogPack = "indicatorsV1" | "indicatorsV2" | "tradersReality" | "liquiditySweeps" | "aiGating";

type IndicatorCatalogItem = {
  key: string;
  name: string;
  pack: CatalogPack;
  live: boolean;
  outputs: string[];
  params: string[];
  note?: string;
};

type IndicatorCatalogGroup = {
  key: string;
  title: string;
  description: string;
  items: IndicatorCatalogItem[];
};

type EnabledPack = keyof IndicatorSettingsConfig["enabledPacks"];
type StochRsiKey = keyof IndicatorSettingsConfig["indicatorsV2"]["stochrsi"];
type VolumeKey = keyof IndicatorSettingsConfig["indicatorsV2"]["volume"];
type FvgKey = keyof IndicatorSettingsConfig["indicatorsV2"]["fvg"];
type TradersRealityKey = Exclude<keyof IndicatorSettingsConfig["tradersReality"], "sessionsUseDST">;
type AiGatingKey = keyof IndicatorSettingsConfig["aiGating"];
type LiquiditySweepsNumberKey = Exclude<
  keyof IndicatorSettingsConfig["liquiditySweeps"],
  "mode" | "extend"
>;

const SCOPE_OPTIONS: ScopeType[] = ["global", "account", "symbol", "symbol_tf"];
const TIMEFRAME_OPTIONS: Timeframe[] = ["5m", "15m", "1h", "4h", "1d"];

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

const INDICATOR_CATALOG_GROUPS: IndicatorCatalogGroup[] = [
  {
    key: "momentum",
    title: "Momentum & Trend",
    description: "Direction and trend-strength factors for baseline signaling.",
    items: [
      {
        key: "rsi14",
        name: "RSI (14)",
        pack: "indicatorsV1",
        live: true,
        outputs: ["indicators.rsi_14"],
        params: ["fixed period=14"]
      },
      {
        key: "macd",
        name: "MACD (12/26/9)",
        pack: "indicatorsV1",
        live: true,
        outputs: [
          "indicators.macd.line",
          "indicators.macd.signal",
          "indicators.macd.hist"
        ],
        params: ["fixed fast=12 slow=26 signal=9"]
      },
      {
        key: "adx",
        name: "ADX + DI (14)",
        pack: "indicatorsV1",
        live: true,
        outputs: [
          "indicators.adx.adx_14",
          "indicators.adx.plus_di_14",
          "indicators.adx.minus_di_14"
        ],
        params: ["fixed period=14"]
      },
      {
        key: "stochrsi",
        name: "Stoch RSI",
        pack: "indicatorsV2",
        live: true,
        outputs: [
          "indicators.stochrsi.k",
          "indicators.stochrsi.d",
          "indicators.stochrsi.value"
        ],
        params: [
          "config.indicatorsV2.stochrsi.rsiLen",
          "config.indicatorsV2.stochrsi.stochLen",
          "config.indicatorsV2.stochrsi.smoothK",
          "config.indicatorsV2.stochrsi.smoothD"
        ]
      }
    ]
  },
  {
    key: "volatility",
    title: "Volatility & Structure",
    description: "Volatility regime and market-structure context.",
    items: [
      {
        key: "bb",
        name: "Bollinger Bands (20/2)",
        pack: "indicatorsV1",
        live: true,
        outputs: [
          "indicators.bb.upper",
          "indicators.bb.mid",
          "indicators.bb.lower",
          "indicators.bb.width_pct",
          "indicators.bb.pos"
        ],
        params: ["fixed period=20 stdDev=2"]
      },
      {
        key: "atrpct",
        name: "ATR%",
        pack: "indicatorsV1",
        live: true,
        outputs: ["indicators.atr_pct"],
        params: ["fixed ATR(14) / close"]
      },
      {
        key: "fvg",
        name: "Fair Value Gap (FVG) Summary",
        pack: "indicatorsV2",
        live: true,
        outputs: [
          "indicators.fvg.open_bullish_count",
          "indicators.fvg.open_bearish_count",
          "indicators.fvg.nearest_bullish_gap.dist_pct",
          "indicators.fvg.nearest_bearish_gap.dist_pct",
          "indicators.fvg.last_created",
          "indicators.fvg.last_filled"
        ],
        params: [
          "config.indicatorsV2.fvg.lookback",
          "config.indicatorsV2.fvg.fillRule"
        ]
      }
    ]
  },
  {
    key: "flow",
    title: "Flow & Price Anchor",
    description: "Execution-context metrics around price anchoring and participation.",
    items: [
      {
        key: "vwap",
        name: "VWAP (session / rolling)",
        pack: "indicatorsV1",
        live: true,
        outputs: [
          "indicators.vwap.value",
          "indicators.vwap.dist_pct",
          "indicators.vwap.mode"
        ],
        params: ["intraday=session_utc", "1d=rolling_20"]
      },
      {
        key: "volume",
        name: "Volume Features",
        pack: "indicatorsV2",
        live: true,
        outputs: [
          "indicators.volume.vol_z",
          "indicators.volume.rel_vol",
          "indicators.volume.vol_ema_fast",
          "indicators.volume.vol_ema_slow",
          "indicators.volume.vol_trend"
        ],
        params: [
          "config.indicatorsV2.volume.lookback",
          "config.indicatorsV2.volume.emaFast",
          "config.indicatorsV2.volume.emaSlow"
        ]
      }
    ]
  },
  {
    key: "traders-reality",
    title: "TradersReality Pack",
    description: "Extended context pack consumed by explainer and prediction inference.",
    items: [
      {
        key: "tr-emas-cloud",
        name: "EMAs + Cloud",
        pack: "tradersReality",
        live: true,
        outputs: [
          "tradersReality.emas.*",
          "tradersReality.cloud.*"
        ],
        params: ["pack toggle only"]
      },
      {
        key: "tr-levels",
        name: "Levels & Pivots",
        pack: "tradersReality",
        live: true,
        outputs: [
          "tradersReality.levels.daily.*",
          "tradersReality.levels.weekly.*",
          "tradersReality.levels.monthly.*"
        ],
        params: ["pack toggle only"]
      },
      {
        key: "tr-ranges",
        name: "Ranges (ADR/AWR/AMR/RD/RW)",
        pack: "tradersReality",
        live: true,
        outputs: [
          "tradersReality.ranges.adr|awr|amr|rd|rw.*",
          "tradersReality.ranges.distancesPct.*"
        ],
        params: [
          "config.tradersReality.adrLen",
          "config.tradersReality.awrLen",
          "config.tradersReality.amrLen",
          "config.tradersReality.rdLen",
          "config.tradersReality.rwLen"
        ]
      },
      {
        key: "tr-sessions",
        name: "Sessions (DST-aware)",
        pack: "tradersReality",
        live: true,
        outputs: [
          "tradersReality.sessions.activeSession",
          "tradersReality.sessions.sessions"
        ],
        params: [
          "config.tradersReality.openingRangeMin",
          "config.tradersReality.sessionsUseDST"
        ]
      },
      {
        key: "tr-pvsra",
        name: "PVSRA Vector",
        pack: "tradersReality",
        live: true,
        outputs: [
          "tradersReality.pvsra.vectorTier",
          "tradersReality.pvsra.vectorColor",
          "tradersReality.pvsra.patterns.*"
        ],
        params: ["pack toggle only"]
      }
    ]
  },
  {
    key: "runtime-controls",
    title: "Runtime Controls",
    description: "Controls around AI explain-calls and prepared-but-not-wired features.",
    items: [
      {
        key: "ai-gating",
        name: "AI Explain Gating",
        pack: "aiGating",
        live: true,
        outputs: ["gating only (no featureSnapshot field)"],
        params: [
          "config.aiGating.minConfidenceForExplain",
          "config.aiGating.minChangeScore"
        ]
      },
      {
        key: "liquidity-sweeps",
        name: "Liquidity Sweeps",
        pack: "liquiditySweeps",
        live: false,
        outputs: ["none yet in featureSnapshot"],
        params: [
          "config.liquiditySweeps.len",
          "config.liquiditySweeps.mode",
          "config.liquiditySweeps.extend",
          "config.liquiditySweeps.maxBars",
          "config.liquiditySweeps.maxRecentEvents",
          "config.liquiditySweeps.maxActiveZones"
        ],
        note: "Settings exist, but not yet wired into prediction feature computation."
      }
    ]
  }
];

function packLabel(pack: CatalogPack): string {
  if (pack === "indicatorsV1") return "Indicators V1";
  if (pack === "indicatorsV2") return "Indicators V2";
  if (pack === "tradersReality") return "TradersReality";
  if (pack === "liquiditySweeps") return "Liquidity Sweeps";
  return "AI Gating";
}

function isPackEnabled(config: IndicatorSettingsConfig, pack: CatalogPack): boolean {
  if (pack === "aiGating") return true;
  return Boolean(config.enabledPacks[pack]);
}

function parseTimeframe(value: string | null | undefined): Timeframe {
  if (value === "5m" || value === "15m" || value === "1h" || value === "4h" || value === "1d") {
    return value;
  }
  return "15m";
}

function parseFvgFillRule(value: string): IndicatorSettingsConfig["indicatorsV2"]["fvg"]["fillRule"] {
  return value === "mid_touch" ? "mid_touch" : "overlap";
}

function parseLiquiditySweepsMode(
  value: string
): IndicatorSettingsConfig["liquiditySweeps"]["mode"] {
  if (value === "wicks" || value === "outbreak_retest" || value === "both") {
    return value;
  }
  return "both";
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function catalogStatus(item: IndicatorCatalogItem, config: IndicatorSettingsConfig) {
  const enabled = isPackEnabled(config, item.pack);
  if (!item.live) return "settings_only";
  if (enabled) return "live_enabled";
  return "implemented_disabled";
}

function catalogStatusLabel(status: ReturnType<typeof catalogStatus>): string {
  if (status === "live_enabled") return "live (enabled)";
  if (status === "implemented_disabled") return "implemented (disabled)";
  return "settings only";
}

function catalogStatusColor(status: ReturnType<typeof catalogStatus>): string {
  if (status === "live_enabled") return "#54d17a";
  if (status === "implemented_disabled") return "#ffcf66";
  return "var(--muted)";
}

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
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [config, setConfig] = useState<IndicatorSettingsConfig>(FALLBACK_DEFAULTS);

  const canSave = useMemo(() => {
    if (scopeType === "account") return accountId.trim().length > 0;
    if (scopeType === "symbol") return symbol.trim().length > 0;
    if (scopeType === "symbol_tf") return symbol.trim().length > 0 && timeframe.trim().length > 0;
    return true;
  }, [accountId, scopeType, symbol, timeframe]);

  function setPackEnabled(pack: EnabledPack, enabled: boolean) {
    setConfig((prev) => ({
      ...prev,
      enabledPacks: { ...prev.enabledPacks, [pack]: enabled }
    }));
  }

  function setIndicatorsV2StochRsi(field: StochRsiKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      indicatorsV2: {
        ...prev.indicatorsV2,
        stochrsi: { ...prev.indicatorsV2.stochrsi, [field]: value }
      }
    }));
  }

  function setIndicatorsV2Volume(field: VolumeKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      indicatorsV2: {
        ...prev.indicatorsV2,
        volume: { ...prev.indicatorsV2.volume, [field]: value }
      }
    }));
  }

  function setIndicatorsV2Fvg(field: FvgKey, value: IndicatorSettingsConfig["indicatorsV2"]["fvg"][FvgKey]) {
    setConfig((prev) => ({
      ...prev,
      indicatorsV2: {
        ...prev.indicatorsV2,
        fvg: { ...prev.indicatorsV2.fvg, [field]: value }
      }
    }));
  }

  function setTradersRealityNumber(field: TradersRealityKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      tradersReality: { ...prev.tradersReality, [field]: value }
    }));
  }

  function setTradersRealitySessionsUseDst(enabled: boolean) {
    setConfig((prev) => ({
      ...prev,
      tradersReality: { ...prev.tradersReality, sessionsUseDST: enabled }
    }));
  }

  function setAiGating(field: AiGatingKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      aiGating: { ...prev.aiGating, [field]: value }
    }));
  }

  function setLiquiditySweepsNumber(field: LiquiditySweepsNumberKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      liquiditySweeps: { ...prev.liquiditySweeps, [field]: value }
    }));
  }

  function setLiquiditySweepsMode(mode: IndicatorSettingsConfig["liquiditySweeps"]["mode"]) {
    setConfig((prev) => ({
      ...prev,
      liquiditySweeps: { ...prev.liquiditySweeps, mode }
    }));
  }

  function setLiquiditySweepsExtend(extend: boolean) {
    setConfig((prev) => ({
      ...prev,
      liquiditySweeps: { ...prev.liquiditySweeps, extend }
    }));
  }

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
    setTimeframe(parseTimeframe(row.timeframe));
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
      <div className="adminTopActions">
        <Link href="/admin" className="btn">← Back to admin</Link>
        <Link href="/settings" className="btn">← Back to settings</Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Admin · Indicator Settings</h2>
      <div className="adminPageIntro">
        Configure global defaults and scoped overrides for prediction feature packs.
      </div>

      {loading ? <div className="settingsMutedText">Loading...</div> : null}
      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">{error}</div>
      ) : null}
      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div>
      ) : null}

      {isSuperadmin ? (
        <>
          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>Integrated Indicators (Thematic)</h3></div>
            <div className="settingsMutedText" style={{ marginBottom: 8 }}>
              This list reflects currently integrated prediction features and where each one is configured.
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {INDICATOR_CATALOG_GROUPS.map((group) => (
                <div
                  key={group.key}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 10
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{group.title}</div>
                  <div className="settingsMutedText" style={{ marginBottom: 8 }}>
                    {group.description}
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="table" style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th>Indicator</th>
                          <th>Pack</th>
                          <th>Status</th>
                          <th>Outputs</th>
                          <th>Config params</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((item) => {
                          const status = catalogStatus(item, config);
                          return (
                            <tr key={item.key}>
                              <td>
                                <div style={{ fontWeight: 600 }}>{item.name}</div>
                                {item.note ? (
                                  <div className="settingsMutedText">{item.note}</div>
                                ) : null}
                              </td>
                              <td>{packLabel(item.pack)}</td>
                              <td>
                                <span
                                  style={{
                                    fontSize: 12,
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    border: "1px solid var(--border)",
                                    color: catalogStatusColor(status)
                                  }}
                                >
                                  {catalogStatusLabel(status)}
                                </span>
                              </td>
                              <td style={{ fontSize: 12 }}>
                                {(item.outputs ?? []).join(", ")}
                              </td>
                              <td style={{ fontSize: 12 }}>
                                {(item.params ?? []).join(", ")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>{editingId ? "Edit override" : "Create override"}</h3></div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Scope</span>
                <select className="input" value={scopeType} onChange={(e) => setScopeType(e.target.value as ScopeType)}>
                  {SCOPE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
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
                <select
                  className="input"
                  value={timeframe}
                  onChange={(e) => setTimeframe(parseTimeframe(e.target.value))}
                  disabled={scopeType !== "symbol_tf"}
                >
                  {TIMEFRAME_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ marginTop: 12, fontWeight: 700 }}>Pack Toggles</div>
            <div style={{ marginTop: 6, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
              <label className="inlineCheck"><input type="checkbox" checked={config.enabledPacks.indicatorsV1} onChange={(e) => setPackEnabled("indicatorsV1", e.target.checked)} /> Indicators V1</label>
              <label className="inlineCheck"><input type="checkbox" checked={config.enabledPacks.indicatorsV2} onChange={(e) => setPackEnabled("indicatorsV2", e.target.checked)} /> Indicators V2</label>
              <label className="inlineCheck"><input type="checkbox" checked={config.enabledPacks.tradersReality} onChange={(e) => setPackEnabled("tradersReality", e.target.checked)} /> TradersReality</label>
              <label className="inlineCheck"><input type="checkbox" checked={config.enabledPacks.liquiditySweeps} onChange={(e) => setPackEnabled("liquiditySweeps", e.target.checked)} /> Liquidity Sweeps</label>
            </div>

            <div style={{ marginTop: 14, fontWeight: 700 }}>Indicators V2 Params</div>
            <div style={{ marginTop: 6, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">Stoch RSI len</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.rsiLen} onChange={(e) => setIndicatorsV2StochRsi("rsiLen", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">Stoch len</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.stochLen} onChange={(e) => setIndicatorsV2StochRsi("stochLen", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">Stoch smooth K</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.smoothK} onChange={(e) => setIndicatorsV2StochRsi("smoothK", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">Stoch smooth D</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.smoothD} onChange={(e) => setIndicatorsV2StochRsi("smoothD", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">Volume lookback</span><input className="input" type="number" value={config.indicatorsV2.volume.lookback} onChange={(e) => setIndicatorsV2Volume("lookback", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">Volume EMA fast</span><input className="input" type="number" value={config.indicatorsV2.volume.emaFast} onChange={(e) => setIndicatorsV2Volume("emaFast", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">Volume EMA slow</span><input className="input" type="number" value={config.indicatorsV2.volume.emaSlow} onChange={(e) => setIndicatorsV2Volume("emaSlow", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">FVG lookback</span><input className="input" type="number" value={config.indicatorsV2.fvg.lookback} onChange={(e) => setIndicatorsV2Fvg("lookback", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">FVG fill rule</span><select className="input" value={config.indicatorsV2.fvg.fillRule} onChange={(e) => setIndicatorsV2Fvg("fillRule", parseFvgFillRule(e.target.value))}><option value="overlap">overlap</option><option value="mid_touch">mid_touch</option></select></label>
            </div>

            <div style={{ marginTop: 14, fontWeight: 700 }}>TradersReality Params</div>
            <div style={{ marginTop: 6, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">TR opening range (min)</span><input className="input" type="number" value={config.tradersReality.openingRangeMin} onChange={(e) => setTradersRealityNumber("openingRangeMin", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">ADR len</span><input className="input" type="number" value={config.tradersReality.adrLen} onChange={(e) => setTradersRealityNumber("adrLen", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">AWR len</span><input className="input" type="number" value={config.tradersReality.awrLen} onChange={(e) => setTradersRealityNumber("awrLen", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">AMR len</span><input className="input" type="number" value={config.tradersReality.amrLen} onChange={(e) => setTradersRealityNumber("amrLen", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">RD len</span><input className="input" type="number" value={config.tradersReality.rdLen} onChange={(e) => setTradersRealityNumber("rdLen", parseNumber(e.target.value))} /></label>
              <label style={{ display: "grid", gap: 4 }}><span className="mutedTiny">RW len</span><input className="input" type="number" value={config.tradersReality.rwLen} onChange={(e) => setTradersRealityNumber("rwLen", parseNumber(e.target.value))} /></label>
              <label className="inlineCheck"><input type="checkbox" checked={config.tradersReality.sessionsUseDST} onChange={(e) => setTradersRealitySessionsUseDst(e.target.checked)} /> Sessions use DST</label>
            </div>

            <div style={{ marginTop: 14, fontWeight: 700 }}>AI Gating</div>
            <div style={{ marginTop: 6, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="mutedTiny">Min confidence for explain (%)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={config.aiGating.minConfidenceForExplain}
                  onChange={(e) =>
                    setAiGating("minConfidenceForExplain", parseNumber(e.target.value))
                  }
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="mutedTiny">Min change score (0..1)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={config.aiGating.minChangeScore}
                  onChange={(e) => setAiGating("minChangeScore", parseNumber(e.target.value))}
                />
              </label>
            </div>

            <div style={{ marginTop: 14, fontWeight: 700 }}>Liquidity Sweeps (Prepared)</div>
            <div className="settingsMutedText" style={{ marginBottom: 6 }}>
              These params are configurable now but not yet wired into prediction feature snapshots.
            </div>
            <div style={{ marginTop: 6, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="mutedTiny">Sweep len</span>
                <input className="input" type="number" value={config.liquiditySweeps.len} onChange={(e) => setLiquiditySweepsNumber("len", parseNumber(e.target.value))} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="mutedTiny">Mode</span>
                <select className="input" value={config.liquiditySweeps.mode} onChange={(e) => setLiquiditySweepsMode(parseLiquiditySweepsMode(e.target.value))}>
                  <option value="wicks">wicks</option>
                  <option value="outbreak_retest">outbreak_retest</option>
                  <option value="both">both</option>
                </select>
              </label>
              <label className="inlineCheck">
                <input type="checkbox" checked={config.liquiditySweeps.extend} onChange={(e) => setLiquiditySweepsExtend(e.target.checked)} />
                Extend zones
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="mutedTiny">Max bars</span>
                <input className="input" type="number" value={config.liquiditySweeps.maxBars} onChange={(e) => setLiquiditySweepsNumber("maxBars", parseNumber(e.target.value))} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="mutedTiny">Max recent events</span>
                <input className="input" type="number" value={config.liquiditySweeps.maxRecentEvents} onChange={(e) => setLiquiditySweepsNumber("maxRecentEvents", parseNumber(e.target.value))} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="mutedTiny">Max active zones</span>
                <input className="input" type="number" value={config.liquiditySweeps.maxActiveZones} onChange={(e) => setLiquiditySweepsNumber("maxActiveZones", parseNumber(e.target.value))} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button className="btn btnPrimary" type="button" disabled={saving || !canSave} onClick={save}>{saving ? "Saving..." : editingId ? "Update override" : "Create override"}</button>
              <button className="btn" type="button" onClick={() => void refreshResolvedPreview()}>Preview resolved</button>
              <button className="btn" type="button" onClick={resetForm}>Reset form</button>
            </div>
          </section>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>Overrides</h3></div>
            {items.length === 0 ? <div className="settingsMutedText">No overrides yet.</div> : (
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
