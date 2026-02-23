"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { type AccessSectionSettingsResponse } from "../../../src/access/accessSection";

type ExchangeAccount = {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
};

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

type StrategyKey = "dummy" | "prediction_copier";
type CopierOrderType = "market" | "limit";
type CopierSizingType = "fixed_usd" | "equity_pct" | "risk_pct";
type CopierSignal = "up" | "down" | "neutral";

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

function formatPredictionSourceStrategy(source: PredictionSource): string {
  const byName = typeof source.strategyName === "string" ? source.strategyName.trim() : "";
  if (byName) return byName;
  const byRef = typeof source.strategyRef === "string" ? source.strategyRef.trim() : "";
  if (byRef) return byRef;
  const byKind = typeof source.strategyKind === "string" ? source.strategyKind.trim() : "";
  if (byKind) return byKind;
  return "legacy";
}

export default function NewBotPage() {
  const t = useTranslations("system.botsNew");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [sources, setSources] = useState<PredictionSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [exchangeAccountId, setExchangeAccountId] = useState("");
  const [strategyKey, setStrategyKey] = useState<StrategyKey>("dummy");
  const [marginMode, setMarginMode] = useState<"isolated" | "cross">("isolated");
  const [leverage, setLeverage] = useState(1);
  const [tickMs, setTickMs] = useState(1000);

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

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessSettings, setAccessSettings] = useState<AccessSectionSettingsResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadAccounts() {
      try {
        const [accountsResponse, accessResponse] = await Promise.all([
          apiGet<{ items: ExchangeAccount[] }>("/exchange-accounts"),
          apiGet<AccessSectionSettingsResponse>("/settings/access-section")
        ]);
        if (!mounted) return;
        const items = accountsResponse.items ?? [];
        setAccounts(items);
        setAccessSettings(accessResponse);
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

  useEffect(() => {
    let mounted = true;
    async function loadSources() {
      if (strategyKey !== "prediction_copier" || !exchangeAccountId) {
        setSources([]);
        setSourceStateId("");
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
        setSources([]);
        setSourceStateId("");
        setSourcesError(errMsg(e));
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

  const canCreate = useMemo(() => {
    const blockedByLimit = Boolean(
      accessSettings
      && !accessSettings.bypass
      && typeof accessSettings.remaining.bots === "number"
      && accessSettings.remaining.bots <= 0
    );
    const hasRequiredSource = strategyKey !== "prediction_copier" || Boolean(sourceStateId);
    return Boolean(name.trim() && symbol.trim() && exchangeAccountId && !saving && !blockedByLimit && hasRequiredSource);
  }, [name, symbol, exchangeAccountId, saving, accessSettings, strategyKey, sourceStateId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    if (
      accessSettings
      && !accessSettings.bypass
      && typeof accessSettings.remaining.bots === "number"
      && accessSettings.remaining.bots <= 0
    ) {
      setError(
        t("limit.blocked", {
          usage: accessSettings.usage.bots,
          limit: accessSettings.limits.bots ?? 0
        })
      );
      return;
    }

    if (strategyKey === "prediction_copier" && !sourceStateId) {
      setError(t("copier.sourceRequired"));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const cleanedSymbol = symbol.trim().toUpperCase();
      const allowSignals: CopierSignal[] = [];
      if (allowSignalUp) allowSignals.push("up");
      if (allowSignalDown) allowSignals.push("down");
      if (allowSignalNeutral) allowSignals.push("neutral");

      const predictionCopierParams =
        strategyKey === "prediction_copier"
          ? {
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
              symbols: [cleanedSymbol],
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
          : null;

      const created = await apiPost<{ id: string }>("/bots", {
        name: name.trim(),
        symbol: cleanedSymbol,
        exchangeAccountId,
        strategyKey,
        marginMode,
        leverage,
        tickMs,
        paramsJson:
          strategyKey === "prediction_copier"
            ? {
                predictionCopier: predictionCopierParams
              }
            : {}
      });
      router.push(withLocalePath(`/bots/${created.id}`, locale));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container botsNewPage" style={{ maxWidth: 860 }}>
      <div style={{ marginBottom: 12 }}>
        <Link href={withLocalePath("/bots", locale)} className="btn">{t("actions.back")}</Link>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          {t("subtitle")}
        </div>

        {error ? <div style={{ marginBottom: 10, color: "#ef4444", fontSize: 13 }}>{error}</div> : null}

        {accounts.length === 0 ? (
          <div className="card" style={{ padding: 10 }}>
            <div style={{ marginBottom: 8 }}>{t("noExchangeAccount")}</div>
            <Link href={withLocalePath("/settings", locale)} className="btn btnPrimary">
              {t("actions.addExchangeAccount")}
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
            {accessSettings && !accessSettings.bypass ? (
              <div className="card" style={{ padding: 10, fontSize: 12, color: "var(--muted)" }}>
                {t("limit.status", {
                  usage: accessSettings.usage.bots,
                  limit:
                    accessSettings.limits.bots === null
                      ? t("limit.unlimited")
                      : String(accessSettings.limits.bots),
                  remaining:
                    accessSettings.remaining.bots === null
                      ? t("limit.unlimited")
                      : String(accessSettings.remaining.bots)
                })}
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
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.exchangeAccount")}</span>
                  <select className="input" value={exchangeAccountId} onChange={(e) => setExchangeAccountId(e.target.value)}>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.label} ({account.exchange})
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.strategy")}</span>
                  <select className="input" value={strategyKey} onChange={(e) => setStrategyKey(e.target.value as StrategyKey)}>
                    <option value="dummy">dummy</option>
                    <option value="prediction_copier">prediction_copier</option>
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.symbol")}</span>
                  <input
                    className="input"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    required
                    disabled={strategyKey === "prediction_copier"}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.marginMode")}</span>
                  <select className="input" value={marginMode} onChange={(e) => setMarginMode(e.target.value as "isolated" | "cross")}>
                    <option value="isolated">{t("options.isolated")}</option>
                    <option value="cross">{t("options.cross")}</option>
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
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("copier.title")}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {t("copier.descriptionBefore")} <code>predictions_state</code> {t("copier.descriptionAfter")}
                  </div>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.source")}</span>
                    <select
                      className="input"
                      value={sourceStateId}
                      onChange={(e) => setSourceStateId(e.target.value)}
                      disabled={loadingSources || sources.length === 0}
                    >
                      {sources.length === 0 ? (
                        <option value="">{loadingSources ? t("copier.loadingSources") : t("copier.noSources")}</option>
                      ) : null}
                      {sources.map((source) => (
                        <option key={source.stateId} value={source.stateId}>
                          {formatPredictionSourceStrategy(source)} · {source.symbol} · {source.timeframe} · {source.lastSignal}
                        </option>
                      ))}
                    </select>
                  </label>

                  {sourcesError ? (
                    <div style={{ color: "#ef4444", fontSize: 12 }}>{sourcesError}</div>
                  ) : null}

                  {selectedSource ? (
                    <div className="card" style={{ padding: 10, fontSize: 12, color: "var(--muted)", display: "grid", gap: 4 }}>
                      <div>{t("copier.sourceMeta.symbol")}: <strong>{selectedSource.symbol}</strong></div>
                      <div>{t("copier.sourceMeta.timeframe")}: <strong>{selectedSource.timeframe}</strong></div>
                      <div>{t("copier.sourceMeta.strategy")}: <strong>{selectedSource.strategyName ?? selectedSource.strategyKind ?? "n/a"}</strong></div>
                      <div>{t("copier.sourceMeta.lastSignal")}: <strong>{selectedSource.lastSignal}</strong> ({selectedSource.confidence.toFixed(1)}%)</div>
                      <div>{t("copier.sourceMeta.updated")}: <strong>{new Date(selectedSource.tsUpdated).toLocaleString()}</strong></div>
                    </div>
                  ) : null}

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.predictionTf")}</span>
                      <input className="input" value={copierTimeframe} disabled />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.minConfidence")}</span>
                      <input className="input" type="number" min={0} max={100} value={copierMinConfidence} onChange={(e) => setCopierMinConfidence(Number(e.target.value || 0))} />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.maxPredictionAge")}</span>
                      <input className="input" type="number" min={30} max={86_400} value={copierMaxPredictionAgeSec} onChange={(e) => setCopierMaxPredictionAgeSec(Number(e.target.value || 600))} />
                    </label>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.orderType")}</span>
                      <select className="input" value={copierOrderType} onChange={(e) => setCopierOrderType(e.target.value as CopierOrderType)}>
                        <option value="market">{t("options.market")}</option>
                        <option value="limit">{t("options.limit")}</option>
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.sizingType")}</span>
                      <select className="input" value={copierSizingType} onChange={(e) => setCopierSizingType(e.target.value as CopierSizingType)}>
                        <option value="fixed_usd">fixed_usd</option>
                        <option value="equity_pct">equity_pct</option>
                        <option value="risk_pct">risk_pct</option>
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.sizingValue")}</span>
                      <input className="input" type="number" min={0.01} step="0.01" value={copierSizingValue} onChange={(e) => setCopierSizingValue(Number(e.target.value || 100))} />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.limitOffsetBps")}</span>
                      <input className="input" type="number" min={0} max={500} value={executionLimitOffsetBps} onChange={(e) => setExecutionLimitOffsetBps(Number(e.target.value || 0))} />
                    </label>
                  </div>
                </div>

                <div className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sections.risk")}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                    <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.maxOpenPositions")}</span><input className="input" type="number" min={1} value={riskMaxOpenPositions} onChange={(e) => setRiskMaxOpenPositions(Number(e.target.value || 1))} /></label>
                    <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.maxDailyTrades")}</span><input className="input" type="number" min={1} value={riskMaxDailyTrades} onChange={(e) => setRiskMaxDailyTrades(Number(e.target.value || 1))} /></label>
                    <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.cooldownSec")}</span><input className="input" type="number" min={0} value={riskCooldownSec} onChange={(e) => setRiskCooldownSec(Number(e.target.value || 0))} /></label>
                    <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.maxNotionalPerSymbol")}</span><input className="input" type="number" min={1} value={riskMaxNotionalSymbol} onChange={(e) => setRiskMaxNotionalSymbol(Number(e.target.value || 1))} /></label>
                    <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.maxNotionalTotal")}</span><input className="input" type="number" min={1} value={riskMaxNotionalTotal} onChange={(e) => setRiskMaxNotionalTotal(Number(e.target.value || 1))} /></label>
                    <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.stopLossPct")}</span><input className="input" type="number" min={0} step="0.1" value={riskStopLossPct} onChange={(e) => setRiskStopLossPct(e.target.value)} /></label>
                    <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.takeProfitPct")}</span><input className="input" type="number" min={0} step="0.1" value={riskTakeProfitPct} onChange={(e) => setRiskTakeProfitPct(e.target.value)} /></label>
                    <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.timeStopMin")}</span><input className="input" type="number" min={0} step="1" value={riskTimeStopMin} onChange={(e) => setRiskTimeStopMin(e.target.value)} /></label>
                    <label className="botsNewCheckField">
                      <span className="botsNewCheckFieldLabel">{t("copier.fields.exitOnSignalFlip")}</span>
                      <input className="botsNewCheckInput" type="checkbox" checked={exitOnSignalFlip} onChange={(e) => setExitOnSignalFlip(e.target.checked)} />
                    </label>
                    <label className="botsNewCheckField">
                      <span className="botsNewCheckFieldLabel">{t("copier.fields.exitOnConfidenceDrop")}</span>
                      <input className="botsNewCheckInput" type="checkbox" checked={exitOnConfidenceDrop} onChange={(e) => setExitOnConfidenceDrop(e.target.checked)} />
                    </label>
                  </div>
                </div>

                <div className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sections.filters")}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.blockTags")}</span>
                      <input className="input" value={filtersBlockTags} onChange={(e) => setFiltersBlockTags(e.target.value)} placeholder={t("copier.blockTagsPlaceholder")} />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.requireTags")}</span>
                      <input className="input" value={filtersRequireTags} onChange={(e) => setFiltersRequireTags(e.target.value)} placeholder={t("copier.requireTagsPlaceholder")} />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.minExpectedMove")}</span>
                      <input className="input" type="number" min={0} step="0.01" value={filtersMinExpectedMove} onChange={(e) => setFiltersMinExpectedMove(e.target.value)} />
                    </label>
                    <label className="botsNewCheckField">
                      <span className="botsNewCheckFieldLabel">{t("copier.fields.newsRiskBlockEnabled")}</span>
                      <input className="botsNewCheckInput" type="checkbox" checked={filtersNewsRiskBlockEnabled} onChange={(e) => setFiltersNewsRiskBlockEnabled(e.target.checked)} />
                    </label>
                    <label className="botsNewCheckField">
                      <span className="botsNewCheckFieldLabel">{t("copier.fields.reduceOnlyOnExit")}</span>
                      <input className="botsNewCheckInput" type="checkbox" checked={executionReduceOnlyOnExit} onChange={(e) => setExecutionReduceOnlyOnExit(e.target.checked)} />
                    </label>
                  </div>
                  <div className="botsNewSignalRow">
                    <span className="botsNewSignalLabel">{t("copier.fields.allowSignals")}</span>
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

            <button className="btn btnPrimary" type="submit" disabled={!canCreate}>
              {saving ? t("actions.creating") : t("actions.createBot")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
