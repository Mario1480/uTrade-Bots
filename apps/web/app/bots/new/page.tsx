"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../lib/api";

type ExchangeAccount = {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
};

type StrategyKey = "dummy" | "prediction_copier";
type CopierTimeframe = "5m" | "15m" | "1h" | "4h";
type CopierOrderType = "market" | "limit";
type CopierSizingType = "fixed_usd" | "equity_pct" | "risk_pct";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function NewBotPage() {
  const t = useTranslations("system.botsNew");
  const router = useRouter();
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [exchangeAccountId, setExchangeAccountId] = useState("");
  const [strategyKey, setStrategyKey] = useState<StrategyKey>("dummy");
  const [marginMode, setMarginMode] = useState<"isolated" | "cross">("isolated");
  const [leverage, setLeverage] = useState(1);
  const [tickMs, setTickMs] = useState(1000);
  const [copierTimeframe, setCopierTimeframe] = useState<CopierTimeframe>("15m");
  const [copierMinConfidence, setCopierMinConfidence] = useState(70);
  const [copierMaxPredictionAgeSec, setCopierMaxPredictionAgeSec] = useState(600);
  const [copierOrderType, setCopierOrderType] = useState<CopierOrderType>("market");
  const [copierSizingType, setCopierSizingType] = useState<CopierSizingType>("fixed_usd");
  const [copierSizingValue, setCopierSizingValue] = useState(100);
  const [copierBlockTags, setCopierBlockTags] = useState("news_risk,data_gap,low_liquidity");
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
      const cleanedSymbol = symbol.trim().toUpperCase();
      const predictionCopierParams =
        strategyKey === "prediction_copier"
          ? {
              timeframe: copierTimeframe,
              minConfidence: copierMinConfidence,
              maxPredictionAgeSec: copierMaxPredictionAgeSec,
              symbols: [cleanedSymbol],
              positionSizing: {
                type: copierSizingType,
                value: copierSizingValue
              },
              filters: {
                blockTags: copierBlockTags
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean)
              },
              execution: {
                orderType: copierOrderType
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
        <Link href="/" className="btn">{t("actions.back")}</Link>
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
            <Link href="/settings" className="btn btnPrimary">{t("actions.addExchangeAccount")}</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.name")}</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.symbol")}</span>
              <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
            </label>

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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.strategy")}</span>
                <select className="input" value={strategyKey} onChange={(e) => setStrategyKey(e.target.value as StrategyKey)}>
                  <option value="dummy">dummy</option>
                  <option value="prediction_copier">prediction_copier</option>
                </select>
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

            {strategyKey === "prediction_copier" ? (
              <div className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t("copier.title")}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {t("copier.descriptionBefore")} <code>predictions_state</code> {t("copier.descriptionAfter")}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.predictionTf")}</span>
                    <select className="input" value={copierTimeframe} onChange={(e) => setCopierTimeframe(e.target.value as CopierTimeframe)}>
                      <option value="5m">5m</option>
                      <option value="15m">15m</option>
                      <option value="1h">1h</option>
                      <option value="4h">4h</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.minConfidence")}</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={100}
                      value={copierMinConfidence}
                      onChange={(e) => setCopierMinConfidence(Number(e.target.value || 0))}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.maxPredictionAge")}</span>
                    <input
                      className="input"
                      type="number"
                      min={30}
                      max={86_400}
                      value={copierMaxPredictionAgeSec}
                      onChange={(e) => setCopierMaxPredictionAgeSec(Number(e.target.value || 600))}
                    />
                  </label>
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
                    <input
                      className="input"
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={copierSizingValue}
                      onChange={(e) => setCopierSizingValue(Number(e.target.value || 100))}
                    />
                  </label>
                </div>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("copier.fields.blockTags")}</span>
                  <input
                    className="input"
                    value={copierBlockTags}
                    onChange={(e) => setCopierBlockTags(e.target.value)}
                    placeholder={t("copier.blockTagsPlaceholder")}
                  />
                </label>
              </div>
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
