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
    advancedIndicators: boolean;
    liquiditySweeps: boolean;
  };
  indicatorsV2: {
    stochrsi: { rsiLen: number; stochLen: number; smoothK: number; smoothD: number };
    volume: { lookback: number; emaFast: number; emaSlow: number };
    fvg: { lookback: number; fillRule: "overlap" | "mid_touch" };
  };
  advancedIndicators: {
    adrLen: number;
    awrLen: number;
    amrLen: number;
    rdLen: number;
    rwLen: number;
    openingRangeMin: number;
    sessionsUseDST: boolean;
    smcInternalLength: number;
    smcSwingLength: number;
    smcEqualLength: number;
    smcEqualThreshold: number;
    smcMaxOrderBlocks: number;
    smcFvgAutoThreshold: boolean;
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

type IndicatorCatalogItem = {
  key: string;
  name: string;
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

type StochRsiKey = keyof IndicatorSettingsConfig["indicatorsV2"]["stochrsi"];
type VolumeKey = keyof IndicatorSettingsConfig["indicatorsV2"]["volume"];
type FvgKey = keyof IndicatorSettingsConfig["indicatorsV2"]["fvg"];
type AdvancedIndicatorsKey = Exclude<
  keyof IndicatorSettingsConfig["advancedIndicators"],
  "sessionsUseDST" | "smcFvgAutoThreshold"
>;
type AiGatingKey = keyof IndicatorSettingsConfig["aiGating"];
type LiquiditySweepsNumberKey = Exclude<
  keyof IndicatorSettingsConfig["liquiditySweeps"],
  "mode" | "extend"
>;
type IndicatorSectionKey =
  | "stochRsi"
  | "volume"
  | "fvg"
  | "rangesSessions"
  | "smc"
  | "aiGating"
  | "liquiditySweeps";

const SCOPE_OPTIONS: ScopeType[] = ["global", "account", "symbol", "symbol_tf"];
const TIMEFRAME_OPTIONS: Timeframe[] = ["5m", "15m", "1h", "4h", "1d"];

const FALLBACK_DEFAULTS: IndicatorSettingsConfig = {
  enabledPacks: {
    indicatorsV1: true,
    indicatorsV2: true,
    advancedIndicators: true,
    liquiditySweeps: true
  },
  indicatorsV2: {
    stochrsi: { rsiLen: 14, stochLen: 14, smoothK: 3, smoothD: 3 },
    volume: { lookback: 100, emaFast: 10, emaSlow: 30 },
    fvg: { lookback: 300, fillRule: "overlap" }
  },
  advancedIndicators: {
    adrLen: 14,
    awrLen: 4,
    amrLen: 6,
    rdLen: 15,
    rwLen: 13,
    openingRangeMin: 30,
    sessionsUseDST: true,
    smcInternalLength: 5,
    smcSwingLength: 50,
    smcEqualLength: 3,
    smcEqualThreshold: 0.1,
    smcMaxOrderBlocks: 20,
    smcFvgAutoThreshold: true
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
        live: true,
        outputs: ["indicators.rsi_14"],
        params: ["fixed period=14"]
      },
      {
        key: "macd",
        name: "MACD (12/26/9)",
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
        live: true,
        outputs: ["indicators.atr_pct"],
        params: ["fixed ATR(14) / close"]
      },
      {
        key: "fvg",
        name: "Fair Value Gap (FVG) Summary",
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
    key: "advanced-indicators",
    title: "Advanced Indicators",
    description: "Extended context indicators consumed by explainer and prediction inference.",
    items: [
      {
        key: "advanced-emas-cloud",
        name: "EMAs + Cloud",
        live: true,
        outputs: [
          "advancedIndicators.emas.*",
          "advancedIndicators.cloud.*"
        ],
        params: ["derived from candle stream (no dedicated params)"]
      },
      {
        key: "advanced-levels",
        name: "Levels & Pivots",
        live: true,
        outputs: [
          "advancedIndicators.levels.daily.*",
          "advancedIndicators.levels.weekly.*",
          "advancedIndicators.levels.monthly.*"
        ],
        params: ["derived from candle stream (no dedicated params)"]
      },
      {
        key: "advanced-ranges",
        name: "Ranges (ADR/AWR/AMR/RD/RW)",
        live: true,
        outputs: [
          "advancedIndicators.ranges.adr|awr|amr|rd|rw.*",
          "advancedIndicators.ranges.distancesPct.*"
        ],
        params: [
          "config.advancedIndicators.adrLen",
          "config.advancedIndicators.awrLen",
          "config.advancedIndicators.amrLen",
          "config.advancedIndicators.rdLen",
          "config.advancedIndicators.rwLen"
        ]
      },
      {
        key: "advanced-sessions",
        name: "Sessions (DST-aware)",
        live: true,
        outputs: [
          "advancedIndicators.sessions.activeSession",
          "advancedIndicators.sessions.sessions"
        ],
        params: [
          "config.advancedIndicators.openingRangeMin",
          "config.advancedIndicators.sessionsUseDST"
        ]
      },
      {
        key: "advanced-pvsra",
        name: "PVSRA Vector",
        live: true,
        outputs: [
          "advancedIndicators.pvsra.vectorTier",
          "advancedIndicators.pvsra.vectorColor",
          "advancedIndicators.pvsra.patterns.*"
        ],
        params: ["derived from candle stream (no dedicated params)"]
      },
      {
        key: "advanced-smc",
        name: "Smart Money Concepts (SMC)",
        live: true,
        outputs: [
          "advancedIndicators.smartMoneyConcepts.internal.*",
          "advancedIndicators.smartMoneyConcepts.swing.*",
          "advancedIndicators.smartMoneyConcepts.equalLevels.*",
          "advancedIndicators.smartMoneyConcepts.orderBlocks.*",
          "advancedIndicators.smartMoneyConcepts.fairValueGaps.*",
          "advancedIndicators.smartMoneyConcepts.zones.*"
        ],
        params: [
          "config.advancedIndicators.smcInternalLength",
          "config.advancedIndicators.smcSwingLength",
          "config.advancedIndicators.smcEqualLength",
          "config.advancedIndicators.smcEqualThreshold",
          "config.advancedIndicators.smcMaxOrderBlocks",
          "config.advancedIndicators.smcFvgAutoThreshold"
        ]
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

function catalogStatus(item: IndicatorCatalogItem) {
  if (item.live) return "live";
  return "settings_only";
}

function catalogStatusLabel(status: ReturnType<typeof catalogStatus>): string {
  if (status === "live") return "live";
  return "settings only";
}

function catalogStatusColor(status: ReturnType<typeof catalogStatus>): string {
  if (status === "live") return "#54d17a";
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
  const [openCatalogGroups, setOpenCatalogGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(INDICATOR_CATALOG_GROUPS.map((group) => [group.key, false]))
  );
  const [openIndicatorSections, setOpenIndicatorSections] = useState<Record<IndicatorSectionKey, boolean>>({
    stochRsi: false,
    volume: false,
    fvg: false,
    rangesSessions: false,
    smc: false,
    aiGating: false,
    liquiditySweeps: false
  });

  const canSave = useMemo(() => {
    if (scopeType === "account") return accountId.trim().length > 0;
    if (scopeType === "symbol") return symbol.trim().length > 0;
    if (scopeType === "symbol_tf") return symbol.trim().length > 0 && timeframe.trim().length > 0;
    return true;
  }, [accountId, scopeType, symbol, timeframe]);

  const catalogSummary = useMemo(() => {
    const allItems = INDICATOR_CATALOG_GROUPS.flatMap((group) => group.items);
    const liveCount = allItems.filter((item) => item.live).length;
    return {
      groups: INDICATOR_CATALOG_GROUPS.length,
      indicators: allItems.length,
      live: liveCount,
      settingsOnly: allItems.length - liveCount
    };
  }, []);

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

  function setAdvancedIndicatorsNumber(field: AdvancedIndicatorsKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      advancedIndicators: { ...prev.advancedIndicators, [field]: value }
    }));
  }

  function setAdvancedIndicatorsSessionsUseDst(enabled: boolean) {
    setConfig((prev) => ({
      ...prev,
      advancedIndicators: { ...prev.advancedIndicators, sessionsUseDST: enabled }
    }));
  }

  function setAdvancedIndicatorsSmcFvgAutoThreshold(enabled: boolean) {
    setConfig((prev) => ({
      ...prev,
      advancedIndicators: { ...prev.advancedIndicators, smcFvgAutoThreshold: enabled }
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

  function toggleIndicatorSection(section: IndicatorSectionKey) {
    setOpenIndicatorSections((prev) => ({
      ...prev,
      [section]: !prev[section]
    }));
  }

  function toggleCatalogGroup(groupKey: string) {
    setOpenCatalogGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey]
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
      <h2 className="indicatorAdminTitle">Admin · Indicator Settings</h2>
      <div className="adminPageIntro indicatorAdminIntro">
        Configure global defaults and scoped overrides for integrated indicator modules.
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
          <section className="card settingsSection indicatorCatalogSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>Integrated Indicators</h3>
              <span className="indicatorCatalogScopeChip">
                Scope layers: {resolved?.breakdown?.length ?? 0}
              </span>
            </div>
            <div className="indicatorCatalogStatsGrid">
              <div className="indicatorCatalogStatCard">
                <div className="indicatorCatalogStatLabel">Indicator groups</div>
                <div className="indicatorCatalogStatValue">{catalogSummary.groups}</div>
              </div>
              <div className="indicatorCatalogStatCard">
                <div className="indicatorCatalogStatLabel">Integrated indicators</div>
                <div className="indicatorCatalogStatValue">{catalogSummary.indicators}</div>
              </div>
              <div className="indicatorCatalogStatCard">
                <div className="indicatorCatalogStatLabel">Live</div>
                <div className="indicatorCatalogStatValue">{catalogSummary.live}</div>
              </div>
              <div className="indicatorCatalogStatCard">
                <div className="indicatorCatalogStatLabel">Settings only</div>
                <div className="indicatorCatalogStatValue">{catalogSummary.settingsOnly}</div>
              </div>
            </div>
            <div className="settingsAccordion indicatorCatalogAccordion">
              {INDICATOR_CATALOG_GROUPS.map((group) => {
                const isOpen = !!openCatalogGroups[group.key];
                return (
                  <div
                    key={group.key}
                    className={`settingsAccordionItem ${isOpen ? "settingsAccordionItemOpen" : ""}`}
                  >
                    <button
                      type="button"
                      className="settingsAccordionTrigger"
                      onClick={() => toggleCatalogGroup(group.key)}
                      aria-expanded={isOpen}
                    >
                      <span>{group.title}</span>
                      <span className="indicatorCatalogAccordionMeta">
                        <span className="indicatorCatalogGroupCount">{group.items.length} indicators</span>
                        <span
                          className={`settingsAccordionChevron ${isOpen ? "settingsAccordionChevronOpen" : ""}`}
                        >
                          ▾
                        </span>
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="settingsAccordionBody">
                        <div className="settingsMutedText">{group.description}</div>
                        <div className="indicatorCatalogItemList">
                          {group.items.map((item) => {
                            const status = catalogStatus(item);
                            return (
                              <div key={item.key} className="indicatorCatalogItemCard">
                                <div className="indicatorCatalogItemHeader">
                                  <div style={{ fontWeight: 600 }}>{item.name}</div>
                                  <span
                                    className="indicatorCatalogItemStatus"
                                    style={{ color: catalogStatusColor(status) }}
                                  >
                                    {catalogStatusLabel(status)}
                                  </span>
                                </div>
                                {item.note ? (
                                  <div className="settingsMutedText">{item.note}</div>
                                ) : null}
                                <div className="mutedTiny">Outputs</div>
                                <div className="indicatorCatalogTokenList">
                                  {item.outputs.map((output) => (
                                    <code
                                      key={`${item.key}-out-${output}`}
                                      className="indicatorCatalogToken"
                                    >
                                      {output}
                                    </code>
                                  ))}
                                </div>
                                <div className="mutedTiny">Config params</div>
                                <div className="indicatorCatalogTokenList">
                                  {item.params.map((param) => (
                                    <code
                                      key={`${item.key}-param-${param}`}
                                      className="indicatorCatalogToken"
                                    >
                                      {param}
                                    </code>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card settingsSection indicatorOverrideSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{editingId ? "Edit override" : "Create override"}</h3>
              <span className="indicatorOverrideModeChip">
                {editingId ? "update mode" : "new override"}
              </span>
            </div>
            <div className="settingsMutedText indicatorOverrideIntro">
              Scope zuerst festlegen, dann nur die Werte anpassen, die in dieser Ebene überschrieben
              werden sollen.
            </div>

            <div className="indicatorConfigBlock">
              <div className="indicatorConfigTitle">Scope Target</div>
              <div className="settingsMutedText indicatorConfigHint">
                Reihenfolge der Priorität: global → account → symbol → symbol_tf.
              </div>
            <div className="indicatorScopeGrid">
              <label className="settingsField">
                <span className="settingsFieldLabel">Scope</span>
                <select className="input" value={scopeType} onChange={(e) => setScopeType(e.target.value as ScopeType)}>
                  {SCOPE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Exchange</span>
                <input className="input" value={exchange} onChange={(e) => setExchange(e.target.value)} placeholder="bitget" />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Account ID</span>
                <input className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={scopeType !== "account"} placeholder={scopeType === "account" ? "acc_..." : "Nur bei account"} />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Symbol</span>
                <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} disabled={scopeType !== "symbol" && scopeType !== "symbol_tf"} placeholder={scopeType === "symbol" || scopeType === "symbol_tf" ? "BTCUSDT" : "Nur bei symbol/symbol_tf"} />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Timeframe</span>
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
            </div>

            <div className="settingsAccordion indicatorOverrideAccordion">
              <div className={`settingsAccordionItem ${openIndicatorSections.stochRsi ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("stochRsi")} aria-expanded={openIndicatorSections.stochRsi}>
                  <span>Stoch RSI</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.stochRsi ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.stochRsi ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">RSI len</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.rsiLen} onChange={(e) => setIndicatorsV2StochRsi("rsiLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">Stoch len</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.stochLen} onChange={(e) => setIndicatorsV2StochRsi("stochLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">Smooth K</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.smoothK} onChange={(e) => setIndicatorsV2StochRsi("smoothK", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">Smooth D</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.smoothD} onChange={(e) => setIndicatorsV2StochRsi("smoothD", parseNumber(e.target.value))} /></label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.volume ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("volume")} aria-expanded={openIndicatorSections.volume}>
                  <span>Volume</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.volume ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.volume ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">Lookback</span><input className="input" type="number" value={config.indicatorsV2.volume.lookback} onChange={(e) => setIndicatorsV2Volume("lookback", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">EMA fast</span><input className="input" type="number" value={config.indicatorsV2.volume.emaFast} onChange={(e) => setIndicatorsV2Volume("emaFast", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">EMA slow</span><input className="input" type="number" value={config.indicatorsV2.volume.emaSlow} onChange={(e) => setIndicatorsV2Volume("emaSlow", parseNumber(e.target.value))} /></label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.fvg ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("fvg")} aria-expanded={openIndicatorSections.fvg}>
                  <span>Fair Value Gap (FVG)</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.fvg ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.fvg ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">Lookback</span><input className="input" type="number" value={config.indicatorsV2.fvg.lookback} onChange={(e) => setIndicatorsV2Fvg("lookback", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">Fill rule</span><select className="input" value={config.indicatorsV2.fvg.fillRule} onChange={(e) => setIndicatorsV2Fvg("fillRule", parseFvgFillRule(e.target.value))}><option value="overlap">overlap</option><option value="mid_touch">mid_touch</option></select></label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.rangesSessions ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("rangesSessions")} aria-expanded={openIndicatorSections.rangesSessions}>
                  <span>Ranges & Sessions</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.rangesSessions ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.rangesSessions ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">Opening range (min)</span><input className="input" type="number" min={1} max={180} value={config.advancedIndicators.openingRangeMin} onChange={(e) => setAdvancedIndicatorsNumber("openingRangeMin", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">ADR len</span><input className="input" type="number" min={1} max={365} value={config.advancedIndicators.adrLen} onChange={(e) => setAdvancedIndicatorsNumber("adrLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">AWR len</span><input className="input" type="number" min={1} max={52} value={config.advancedIndicators.awrLen} onChange={(e) => setAdvancedIndicatorsNumber("awrLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">AMR len</span><input className="input" type="number" min={1} max={24} value={config.advancedIndicators.amrLen} onChange={(e) => setAdvancedIndicatorsNumber("amrLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">RD len</span><input className="input" type="number" min={1} max={365} value={config.advancedIndicators.rdLen} onChange={(e) => setAdvancedIndicatorsNumber("rdLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">RW len</span><input className="input" type="number" min={1} max={104} value={config.advancedIndicators.rwLen} onChange={(e) => setAdvancedIndicatorsNumber("rwLen", parseNumber(e.target.value))} /></label>
                    </div>
                    <div className="indicatorInlineChecks">
                      <label className="inlineCheck"><input type="checkbox" checked={config.advancedIndicators.sessionsUseDST} onChange={(e) => setAdvancedIndicatorsSessionsUseDst(e.target.checked)} /> Sessions use DST</label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.smc ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("smc")} aria-expanded={openIndicatorSections.smc}>
                  <span>Smart Money Concepts (SMC)</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.smc ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.smc ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">Internal len</span><input className="input" type="number" min={2} max={50} value={config.advancedIndicators.smcInternalLength} onChange={(e) => setAdvancedIndicatorsNumber("smcInternalLength", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">Swing len</span><input className="input" type="number" min={10} max={250} value={config.advancedIndicators.smcSwingLength} onChange={(e) => setAdvancedIndicatorsNumber("smcSwingLength", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">Equal len</span><input className="input" type="number" min={1} max={50} value={config.advancedIndicators.smcEqualLength} onChange={(e) => setAdvancedIndicatorsNumber("smcEqualLength", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">Equal threshold</span><input className="input" type="number" min={0} max={0.5} step={0.01} value={config.advancedIndicators.smcEqualThreshold} onChange={(e) => setAdvancedIndicatorsNumber("smcEqualThreshold", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">Max order blocks</span><input className="input" type="number" min={1} max={50} value={config.advancedIndicators.smcMaxOrderBlocks} onChange={(e) => setAdvancedIndicatorsNumber("smcMaxOrderBlocks", parseNumber(e.target.value))} /></label>
                    </div>
                    <div className="indicatorInlineChecks">
                      <label className="inlineCheck"><input type="checkbox" checked={config.advancedIndicators.smcFvgAutoThreshold} onChange={(e) => setAdvancedIndicatorsSmcFvgAutoThreshold(e.target.checked)} /> FVG auto threshold</label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.aiGating ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("aiGating")} aria-expanded={openIndicatorSections.aiGating}>
                  <span>AI Gating</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.aiGating ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.aiGating ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField">
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
                      <label className="settingsField">
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
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.liquiditySweeps ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("liquiditySweeps")} aria-expanded={openIndicatorSections.liquiditySweeps}>
                  <span>Liquidity Sweeps (Prepared)</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.liquiditySweeps ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.liquiditySweeps ? (
                  <div className="settingsAccordionBody">
                    <div className="settingsMutedText indicatorConfigHint">
                      Diese Parameter sind vorbereitet, aber aktuell noch nicht in den Prediction-Features verdrahtet.
                    </div>
                    <div className="indicatorConfigGrid">
                      <label className="settingsField">
                        <span className="mutedTiny">Sweep len</span>
                        <input className="input" type="number" value={config.liquiditySweeps.len} onChange={(e) => setLiquiditySweepsNumber("len", parseNumber(e.target.value))} />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">Mode</span>
                        <select className="input" value={config.liquiditySweeps.mode} onChange={(e) => setLiquiditySweepsMode(parseLiquiditySweepsMode(e.target.value))}>
                          <option value="wicks">wicks</option>
                          <option value="outbreak_retest">outbreak_retest</option>
                          <option value="both">both</option>
                        </select>
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">Max bars</span>
                        <input className="input" type="number" value={config.liquiditySweeps.maxBars} onChange={(e) => setLiquiditySweepsNumber("maxBars", parseNumber(e.target.value))} />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">Max recent events</span>
                        <input className="input" type="number" value={config.liquiditySweeps.maxRecentEvents} onChange={(e) => setLiquiditySweepsNumber("maxRecentEvents", parseNumber(e.target.value))} />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">Max active zones</span>
                        <input className="input" type="number" value={config.liquiditySweeps.maxActiveZones} onChange={(e) => setLiquiditySweepsNumber("maxActiveZones", parseNumber(e.target.value))} />
                      </label>
                    </div>
                    <div className="indicatorInlineChecks">
                      <label className="inlineCheck">
                        <input type="checkbox" checked={config.liquiditySweeps.extend} onChange={(e) => setLiquiditySweepsExtend(e.target.checked)} />
                        Extend zones
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="indicatorFormActions">
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
