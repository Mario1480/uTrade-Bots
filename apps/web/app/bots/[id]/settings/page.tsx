"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";

type StrategyKey = "dummy" | "prediction_copier";
type CopierOrderType = "market" | "limit";
type CopierSizingType = "fixed_usd" | "equity_pct" | "risk_pct";
type CopierSignal = "up" | "down" | "neutral";

type PredictionSource = {
  stateId: string;
  symbol: string;
  timeframe: "5m" | "15m" | "1h" | "4h" | string;
  signalMode: "local_only" | "ai_only" | "both" | string;
  strategyRef: string | null;
  strategyKind: "local" | "ai" | "composite" | null;
  strategyName: string | null;
  lastSignal: "up" | "down" | "neutral" | string;
  confidence: number;
  tsUpdated: string;
  lastChangeReason: string | null;
};

type BotDetail = {
  id: string;
  name: string;
  symbol: string;
  status: string;
  exchangeAccountId: string;
  exchangeAccount?: {
    id: string;
    exchange: string;
    label: string;
  } | null;
  futuresConfig?: {
    strategyKey: string;
    marginMode: "isolated" | "cross";
    leverage: number;
    tickMs: number;
    paramsJson?: Record<string, unknown>;
    predictionCopier?: Record<string, unknown> | null;
  } | null;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function toCsvArray(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toRootPredictionCopier(settings: BotDetail["futuresConfig"]): Record<string, any> {
  if (!settings) return {};
  const direct = settings.predictionCopier && typeof settings.predictionCopier === "object"
    ? settings.predictionCopier
    : null;
  if (direct) return { ...direct };
  const paramsJson = settings.paramsJson && typeof settings.paramsJson === "object"
    ? settings.paramsJson
    : {};
  const nested = paramsJson.predictionCopier;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return { ...(nested as Record<string, unknown>) };
  return { ...(paramsJson as Record<string, unknown>) };
}

export default function BotSettingsPage() {
  const t = useTranslations("system.botsSettings");
  const locale = useLocale() as AppLocale;
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  const [exchangeAccountId, setExchangeAccountId] = useState("");
  const [strategyKey, setStrategyKey] = useState<StrategyKey>("dummy");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [marginMode, setMarginMode] = useState<"isolated" | "cross">("isolated");
  const [leverage, setLeverage] = useState(1);
  const [tickMs, setTickMs] = useState(1000);

  const [sources, setSources] = useState<PredictionSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  const [sourceStateId, setSourceStateId] = useState("");
  const [copierTimeframe, setCopierTimeframe] = useState<"5m" | "15m" | "1h" | "4h">("15m");
  const [copierMinConfidence, setCopierMinConfidence] = useState(70);
  const [copierMaxPredictionAgeSec, setCopierMaxPredictionAgeSec] = useState(600);
  const [copierOrderType, setCopierOrderType] = useState<CopierOrderType>("market");
  const [copierSizingType, setCopierSizingType] = useState<CopierSizingType>("fixed_usd");
  const [copierSizingValue, setCopierSizingValue] = useState(100);

  const [riskMaxOpenPositions, setRiskMaxOpenPositions] = useState(3);
  const [riskMaxDailyTrades, setRiskMaxDailyTrades] = useState(20);
  const [riskCooldownSec, setRiskCooldownSec] = useState(120);
  const [riskMaxNotionalSymbol, setRiskMaxNotionalSymbol] = useState(500);
  const [riskMaxNotionalTotal, setRiskMaxNotionalTotal] = useState(1500);
  const [riskStopLossPct, setRiskStopLossPct] = useState("");
  const [riskTakeProfitPct, setRiskTakeProfitPct] = useState("");
  const [riskTimeStopMin, setRiskTimeStopMin] = useState("");
  const [exitOnSignalFlip, setExitOnSignalFlip] = useState(false);
  const [exitOnConfidenceDrop, setExitOnConfidenceDrop] = useState(false);

  const [filtersBlockTags, setFiltersBlockTags] = useState("data_gap,low_liquidity");
  const [filtersNewsRiskBlockEnabled, setFiltersNewsRiskBlockEnabled] = useState(false);
  const [filtersRequireTags, setFiltersRequireTags] = useState("");
  const [filtersMinExpectedMove, setFiltersMinExpectedMove] = useState("");
  const [allowSignalUp, setAllowSignalUp] = useState(true);
  const [allowSignalDown, setAllowSignalDown] = useState(true);
  const [allowSignalNeutral, setAllowSignalNeutral] = useState(false);

  const [executionLimitOffsetBps, setExecutionLimitOffsetBps] = useState(2);
  const [executionReduceOnlyOnExit, setExecutionReduceOnlyOnExit] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function loadBot() {
      setLoading(true);
      setError(null);
      try {
        const bot = await apiGet<BotDetail>(`/bots/${id}`);
        if (!mounted) return;

        setName(bot.name ?? "");
        setSymbol(bot.symbol ?? "BTCUSDT");
        setExchangeAccountId(bot.exchangeAccountId ?? bot.exchangeAccount?.id ?? "");

        const strategy = (bot.futuresConfig?.strategyKey ?? "dummy") as StrategyKey;
        setStrategyKey(strategy);
        setMarginMode((bot.futuresConfig?.marginMode ?? "isolated") as "isolated" | "cross");
        setLeverage(Number(bot.futuresConfig?.leverage ?? 1));
        setTickMs(Number(bot.futuresConfig?.tickMs ?? 1000));

        const root = toRootPredictionCopier(bot.futuresConfig ?? null);
        const allowSignals = Array.isArray(root.filters?.allowSignals) ? root.filters.allowSignals : ["up", "down"];

        setSourceStateId(typeof root.sourceStateId === "string" ? root.sourceStateId : "");
        if (root.timeframe === "5m" || root.timeframe === "15m" || root.timeframe === "1h" || root.timeframe === "4h") {
          setCopierTimeframe(root.timeframe);
        }
        setCopierMinConfidence(Number(root.minConfidence ?? 70));
        setCopierMaxPredictionAgeSec(Number(root.maxPredictionAgeSec ?? 600));
        setCopierOrderType(root.execution?.orderType === "limit" ? "limit" : "market");
        setCopierSizingType(root.positionSizing?.type === "equity_pct" || root.positionSizing?.type === "risk_pct" ? root.positionSizing.type : "fixed_usd");
        setCopierSizingValue(Number(root.positionSizing?.value ?? 100));

        setRiskMaxOpenPositions(Number(root.risk?.maxOpenPositions ?? 3));
        setRiskMaxDailyTrades(Number(root.risk?.maxDailyTrades ?? 20));
        setRiskCooldownSec(Number(root.risk?.cooldownSecAfterTrade ?? 120));
        setRiskMaxNotionalSymbol(Number(root.risk?.maxNotionalPerSymbolUsd ?? 500));
        setRiskMaxNotionalTotal(Number(root.risk?.maxTotalNotionalUsd ?? 1500));
        setRiskStopLossPct(root.risk?.stopLossPct == null ? "" : String(root.risk.stopLossPct));
        setRiskTakeProfitPct(root.risk?.takeProfitPct == null ? "" : String(root.risk.takeProfitPct));
        setRiskTimeStopMin(root.risk?.timeStopMin == null ? "" : String(root.risk.timeStopMin));
        setExitOnSignalFlip(Boolean(root.exit?.onSignalFlip ?? false));
        setExitOnConfidenceDrop(Boolean(root.exit?.onConfidenceDrop ?? false));

        setFiltersBlockTags(Array.isArray(root.filters?.blockTags) ? root.filters.blockTags.join(",") : "data_gap,low_liquidity");
        setFiltersNewsRiskBlockEnabled(Boolean(root.filters?.newsRiskBlockEnabled ?? false));
        setFiltersRequireTags(Array.isArray(root.filters?.requireTags) ? root.filters.requireTags.join(",") : "");
        setFiltersMinExpectedMove(root.filters?.minExpectedMovePct == null ? "" : String(root.filters.minExpectedMovePct));

        setAllowSignalUp(allowSignals.includes("up"));
        setAllowSignalDown(allowSignals.includes("down"));
        setAllowSignalNeutral(allowSignals.includes("neutral"));

        setExecutionLimitOffsetBps(Number(root.execution?.limitOffsetBps ?? 2));
        setExecutionReduceOnlyOnExit(Boolean(root.execution?.reduceOnlyOnExit ?? true));
      } catch (e) {
        if (!mounted) return;
        setError(errMsg(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void loadBot();
    return () => {
      mounted = false;
    };
  }, [id]);

  useEffect(() => {
    let mounted = true;
    async function loadSources() {
      if (strategyKey !== "prediction_copier" || !exchangeAccountId) {
        setSources([]);
        setSourcesError(null);
        return;
      }
      setLoadingSources(true);
      setSourcesError(null);
      try {
        const response = await apiGet<{ items: PredictionSource[] }>(
          `/bots/prediction-sources?exchangeAccountId=${encodeURIComponent(exchangeAccountId)}`
        );
        if (!mounted) return;
        const items = Array.isArray(response.items) ? response.items : [];
        setSources(items);
        setSourceStateId((prev) => {
          if (prev && items.some((item) => item.stateId === prev)) return prev;
          return items[0]?.stateId ?? "";
        });
      } catch (e) {
        if (!mounted) return;
        setSourcesError(errMsg(e));
        setSources([]);
      } finally {
        if (mounted) setLoadingSources(false);
      }
    }
    void loadSources();
    return () => {
      mounted = false;
    };
  }, [strategyKey, exchangeAccountId]);

  const selectedSource = useMemo(
    () => sources.find((item) => item.stateId === sourceStateId) ?? null,
    [sources, sourceStateId]
  );

  useEffect(() => {
    if (!selectedSource) return;
    setSymbol(selectedSource.symbol);
    if (
      selectedSource.timeframe === "5m"
      || selectedSource.timeframe === "15m"
      || selectedSource.timeframe === "1h"
      || selectedSource.timeframe === "4h"
    ) {
      setCopierTimeframe(selectedSource.timeframe);
    }
  }, [selectedSource]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (strategyKey === "prediction_copier" && !sourceStateId) {
      setError(t("sourceRequired"));
      return;
    }

    setSaving(true);
    setError(null);
    setRestartRequired(false);

    try {
      const allowSignals: CopierSignal[] = [];
      if (allowSignalUp) allowSignals.push("up");
      if (allowSignalDown) allowSignals.push("down");
      if (allowSignalNeutral) allowSignals.push("neutral");

      const payload = {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        strategyKey,
        marginMode,
        leverage,
        tickMs,
        paramsJson: strategyKey === "prediction_copier"
          ? {
              predictionCopier: {
                sourceStateId,
                sourceSnapshot: selectedSource
                  ? {
                      stateId: selectedSource.stateId,
                      symbol: selectedSource.symbol,
                      timeframe: selectedSource.timeframe,
                      signalMode: selectedSource.signalMode,
                      strategyRef: selectedSource.strategyRef,
                      strategyKind: selectedSource.strategyKind,
                      strategyName: selectedSource.strategyName
                    }
                  : undefined,
                timeframe: copierTimeframe,
                minConfidence: copierMinConfidence,
                maxPredictionAgeSec: copierMaxPredictionAgeSec,
                symbols: [symbol.trim().toUpperCase()],
                positionSizing: {
                  type: copierSizingType,
                  value: copierSizingValue
                },
                risk: {
                  maxOpenPositions: riskMaxOpenPositions,
                  maxDailyTrades: riskMaxDailyTrades,
                  cooldownSecAfterTrade: riskCooldownSec,
                  maxNotionalPerSymbolUsd: riskMaxNotionalSymbol,
                  maxTotalNotionalUsd: riskMaxNotionalTotal,
                  stopLossPct: riskStopLossPct.trim() ? Number(riskStopLossPct) : null,
                  takeProfitPct: riskTakeProfitPct.trim() ? Number(riskTakeProfitPct) : null,
                  timeStopMin: riskTimeStopMin.trim() ? Number(riskTimeStopMin) : null
                },
                filters: {
                  blockTags: toCsvArray(filtersBlockTags),
                  newsRiskBlockEnabled: filtersNewsRiskBlockEnabled,
                  requireTags: toCsvArray(filtersRequireTags).length > 0 ? toCsvArray(filtersRequireTags) : null,
                  allowSignals,
                  minExpectedMovePct: filtersMinExpectedMove.trim() ? Number(filtersMinExpectedMove) : null
                },
                execution: {
                  orderType: copierOrderType,
                  limitOffsetBps: executionLimitOffsetBps,
                  reduceOnlyOnExit: executionReduceOnlyOnExit
                },
                exit: {
                  onSignalFlip: exitOnSignalFlip,
                  onConfidenceDrop: exitOnConfidenceDrop
                }
              }
            }
          : {}
      };

      const updated = await apiPut<{ restartRequired?: boolean }>(`/bots/${id}`, payload);
      setRestartRequired(Boolean(updated.restartRequired));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="container botsSettingsPage" style={{ maxWidth: 900 }}>
        <div className="card" style={{ padding: 14 }}>{t("loading")}</div>
      </div>
    );
  }

  return (
    <div className="container botsSettingsPage" style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Link href={withLocalePath(`/bots/${id}`, locale)} className="btn">{t("backToBot")}</Link>
      </div>

      <form onSubmit={onSave} className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>{t("title")}</h2>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("description")}</div>

        {restartRequired ? (
          <div className="card" style={{ padding: 10, borderColor: "#f59e0b", fontSize: 13 }}>
            {t("restartRequired")}
          </div>
        ) : null}

        {error ? (
          <div className="card" style={{ padding: 10, borderColor: "#ef4444", color: "#fecaca", fontSize: 13 }}>
            {error}
          </div>
        ) : null}

        <div className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sections.base")}</div>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.name")}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.strategy")}</span>
              <select className="input" value={strategyKey} onChange={(e) => setStrategyKey(e.target.value as StrategyKey)}>
                <option value="dummy">dummy</option>
                <option value="prediction_copier">prediction_copier</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.exchangeAccount")}</span>
              <input className="input" value={exchangeAccountId} disabled />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.symbol")}</span>
              <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} disabled={strategyKey === "prediction_copier"} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.marginMode")}</span>
              <select className="input" value={marginMode} onChange={(e) => setMarginMode(e.target.value as "isolated" | "cross")}>
                <option value="isolated">isolated</option>
                <option value="cross">cross</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.leverage")}</span>
              <input className="input" type="number" min={1} max={125} value={leverage} onChange={(e) => setLeverage(Number(e.target.value || 1))} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.tickMs")}</span>
              <input className="input" type="number" min={100} max={60_000} value={tickMs} onChange={(e) => setTickMs(Number(e.target.value || 1000))} />
            </label>
          </div>
        </div>

        {strategyKey === "prediction_copier" ? (
          <>
            <div className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sections.source")}</div>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.source")}</span>
                <select className="input" value={sourceStateId} onChange={(e) => setSourceStateId(e.target.value)} disabled={loadingSources || sources.length === 0}>
                  {sources.length === 0 ? (
                    <option value="">{loadingSources ? t("loadingSources") : t("noSources")}</option>
                  ) : null}
                  {sources.map((source) => (
                    <option key={source.stateId} value={source.stateId}>
                      {source.symbol} · {source.timeframe} · {source.strategyKind ?? "legacy"} · {source.lastSignal}
                    </option>
                  ))}
                </select>
              </label>

              {sourcesError ? <div style={{ color: "#ef4444", fontSize: 12 }}>{sourcesError}</div> : null}
            </div>

            <div className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sections.risk")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxOpenPositions")}</span><input className="input" type="number" min={1} value={riskMaxOpenPositions} onChange={(e) => setRiskMaxOpenPositions(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxDailyTrades")}</span><input className="input" type="number" min={1} value={riskMaxDailyTrades} onChange={(e) => setRiskMaxDailyTrades(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.cooldownSec")}</span><input className="input" type="number" min={0} value={riskCooldownSec} onChange={(e) => setRiskCooldownSec(Number(e.target.value || 0))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxNotionalPerSymbol")}</span><input className="input" type="number" min={1} value={riskMaxNotionalSymbol} onChange={(e) => setRiskMaxNotionalSymbol(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxNotionalTotal")}</span><input className="input" type="number" min={1} value={riskMaxNotionalTotal} onChange={(e) => setRiskMaxNotionalTotal(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.stopLossPct")}</span><input className="input" type="number" min={0} step="0.1" value={riskStopLossPct} onChange={(e) => setRiskStopLossPct(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.takeProfitPct")}</span><input className="input" type="number" min={0} step="0.1" value={riskTakeProfitPct} onChange={(e) => setRiskTakeProfitPct(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.timeStopMin")}</span><input className="input" type="number" min={0} step="1" value={riskTimeStopMin} onChange={(e) => setRiskTimeStopMin(e.target.value)} /></label>
                <label className="botsNewCheckField">
                  <span className="botsNewCheckFieldLabel">{t("fields.exitOnSignalFlip")}</span>
                  <input className="botsNewCheckInput" type="checkbox" checked={exitOnSignalFlip} onChange={(e) => setExitOnSignalFlip(e.target.checked)} />
                </label>
                <label className="botsNewCheckField">
                  <span className="botsNewCheckFieldLabel">{t("fields.exitOnConfidenceDrop")}</span>
                  <input className="botsNewCheckInput" type="checkbox" checked={exitOnConfidenceDrop} onChange={(e) => setExitOnConfidenceDrop(e.target.checked)} />
                </label>
              </div>
            </div>

            <div className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sections.filters")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.blockTags")}</span><input className="input" value={filtersBlockTags} onChange={(e) => setFiltersBlockTags(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.requireTags")}</span><input className="input" value={filtersRequireTags} onChange={(e) => setFiltersRequireTags(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.minExpectedMove")}</span><input className="input" type="number" min={0} step="0.01" value={filtersMinExpectedMove} onChange={(e) => setFiltersMinExpectedMove(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.orderType")}</span><select className="input" value={copierOrderType} onChange={(e) => setCopierOrderType(e.target.value as CopierOrderType)}><option value="market">market</option><option value="limit">limit</option></select></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.sizingType")}</span><select className="input" value={copierSizingType} onChange={(e) => setCopierSizingType(e.target.value as CopierSizingType)}><option value="fixed_usd">fixed_usd</option><option value="equity_pct">equity_pct</option><option value="risk_pct">risk_pct</option></select></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.sizingValue")}</span><input className="input" type="number" min={0.01} step="0.01" value={copierSizingValue} onChange={(e) => setCopierSizingValue(Number(e.target.value || 100))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.minConfidence")}</span><input className="input" type="number" min={0} max={100} value={copierMinConfidence} onChange={(e) => setCopierMinConfidence(Number(e.target.value || 0))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxPredictionAge")}</span><input className="input" type="number" min={30} max={86400} value={copierMaxPredictionAgeSec} onChange={(e) => setCopierMaxPredictionAgeSec(Number(e.target.value || 600))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.limitOffsetBps")}</span><input className="input" type="number" min={0} max={500} value={executionLimitOffsetBps} onChange={(e) => setExecutionLimitOffsetBps(Number(e.target.value || 0))} /></label>
                <label className="botsNewCheckField"><span className="botsNewCheckFieldLabel">{t("fields.newsRiskBlockEnabled")}</span><input className="botsNewCheckInput" type="checkbox" checked={filtersNewsRiskBlockEnabled} onChange={(e) => setFiltersNewsRiskBlockEnabled(e.target.checked)} /></label>
                <label className="botsNewCheckField"><span className="botsNewCheckFieldLabel">{t("fields.reduceOnlyOnExit")}</span><input className="botsNewCheckInput" type="checkbox" checked={executionReduceOnlyOnExit} onChange={(e) => setExecutionReduceOnlyOnExit(e.target.checked)} /></label>
              </div>

              <div className="botsNewSignalRow">
                <span className="botsNewSignalLabel">{t("fields.allowSignals")}</span>
                <div className="botsNewSignalOptions">
                  <label className="botsNewSignalOption">
                    <input className="botsNewCheckInput" type="checkbox" checked={allowSignalUp} onChange={(e) => setAllowSignalUp(e.target.checked)} />
                    <span>up</span>
                  </label>
                  <label className="botsNewSignalOption">
                    <input className="botsNewCheckInput" type="checkbox" checked={allowSignalDown} onChange={(e) => setAllowSignalDown(e.target.checked)} />
                    <span>down</span>
                  </label>
                  <label className="botsNewSignalOption">
                    <input className="botsNewCheckInput" type="checkbox" checked={allowSignalNeutral} onChange={(e) => setAllowSignalNeutral(e.target.checked)} />
                    <span>neutral</span>
                  </label>
                </div>
              </div>
            </div>
          </>
        ) : null}

        <button className="btn btnPrimary" type="submit" disabled={saving}>
          {saving ? t("saving") : t("save")}
        </button>
      </form>
    </div>
  );
}
