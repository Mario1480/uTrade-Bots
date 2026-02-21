"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type RiskLimits = {
  dailyLossWarnPct: number;
  dailyLossWarnUsd: number;
  dailyLossCriticalPct: number;
  dailyLossCriticalUsd: number;
  marginWarnPct: number;
  marginWarnUsd: number;
  marginCriticalPct: number;
  marginCriticalUsd: number;
};

type SettingsRiskItem = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
  limits: RiskLimits;
  preview?: {
    lossUsd?: number;
    lossPct?: number | null;
    marginPct?: number | null;
    severity?: "critical" | "warning" | "ok";
    triggers?: string[];
  };
};

type SettingsRiskResponse = {
  items: SettingsRiskItem[];
};

type SettingsRiskUpdateResponse = {
  item: SettingsRiskItem;
};

type RiskDraft = Record<keyof RiskLimits, string>;

type RiskLimitField = {
  key: keyof RiskLimits;
  labelKey: string;
  step: string;
};

const RISK_LIMIT_FIELDS: RiskLimitField[] = [
  { key: "dailyLossWarnPct", labelKey: "dailyWarnPct", step: "0.1" },
  { key: "dailyLossWarnUsd", labelKey: "dailyWarnUsd", step: "1" },
  { key: "dailyLossCriticalPct", labelKey: "dailyCriticalPct", step: "0.1" },
  { key: "dailyLossCriticalUsd", labelKey: "dailyCriticalUsd", step: "1" },
  { key: "marginWarnPct", labelKey: "marginWarnPct", step: "0.1" },
  { key: "marginWarnUsd", labelKey: "marginWarnUsd", step: "1" },
  { key: "marginCriticalPct", labelKey: "marginCriticalPct", step: "0.1" },
  { key: "marginCriticalUsd", labelKey: "marginCriticalUsd", step: "1" }
];

function errMsg(error: unknown): string {
  if (error instanceof ApiError) {
    const details =
      error.payload && typeof error.payload === "object" && "details" in error.payload
        ? (error.payload as { details?: unknown }).details
        : null;
    if (details && typeof details === "object" && "issues" in (details as Record<string, unknown>)) {
      const issues = (details as { issues?: unknown }).issues;
      if (Array.isArray(issues) && issues.length > 0) {
        return `${error.message}: ${String(issues[0])}`;
      }
    }
    return `${error.message} (HTTP ${error.status})`;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? error);
  }
  return String(error);
}

function limitsToDraft(limits: RiskLimits): RiskDraft {
  return {
    dailyLossWarnPct: String(limits.dailyLossWarnPct),
    dailyLossWarnUsd: String(limits.dailyLossWarnUsd),
    dailyLossCriticalPct: String(limits.dailyLossCriticalPct),
    dailyLossCriticalUsd: String(limits.dailyLossCriticalUsd),
    marginWarnPct: String(limits.marginWarnPct),
    marginWarnUsd: String(limits.marginWarnUsd),
    marginCriticalPct: String(limits.marginCriticalPct),
    marginCriticalUsd: String(limits.marginCriticalUsd)
  };
}

function parseDraft(draft: RiskDraft): RiskLimits | null {
  const parsed = Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [key, Number(value)])
  ) as RiskLimits;

  for (const value of Object.values(parsed)) {
    if (!Number.isFinite(value) || value < 0) return null;
  }

  return parsed;
}

export default function SettingsRiskPage() {
  const t = useTranslations("system.settingsRisk");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [items, setItems] = useState<SettingsRiskItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RiskDraft>>({});
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});
  const [rowMessages, setRowMessages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<SettingsRiskResponse>("/settings/risk");
      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      const nextDrafts = nextItems.reduce<Record<string, RiskDraft>>((acc, item) => {
        acc[item.exchangeAccountId] = limitsToDraft(item.limits);
        return acc;
      }, {});
      setItems(nextItems);
      setDrafts(nextDrafts);
      setRowMessages({});
    } catch (loadError) {
      setItems([]);
      setDrafts({});
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const isEmpty = useMemo(() => !loading && items.length === 0 && !error, [items, loading, error]);

  function updateDraft(exchangeAccountId: string, key: keyof RiskLimits, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [exchangeAccountId]: {
        ...(prev[exchangeAccountId] ?? limitsToDraft(items.find((item) => item.exchangeAccountId === exchangeAccountId)?.limits ?? {
          dailyLossWarnPct: 0,
          dailyLossWarnUsd: 0,
          dailyLossCriticalPct: 0,
          dailyLossCriticalUsd: 0,
          marginWarnPct: 0,
          marginWarnUsd: 0,
          marginCriticalPct: 0,
          marginCriticalUsd: 0
        })),
        [key]: value
      }
    }));
  }

  async function saveRow(exchangeAccountId: string) {
    const draft = drafts[exchangeAccountId];
    if (!draft) return;
    const parsed = parseDraft(draft);
    if (!parsed) {
      setRowMessages((prev) => ({ ...prev, [exchangeAccountId]: t("errors.invalidNumber") }));
      return;
    }

    setSavingById((prev) => ({ ...prev, [exchangeAccountId]: true }));
    setRowMessages((prev) => ({ ...prev, [exchangeAccountId]: "" }));
    try {
      const payload = await apiPut<SettingsRiskUpdateResponse>(`/settings/risk/${exchangeAccountId}`, parsed);
      const updated = payload.item;
      setItems((prev) => prev.map((item) => (item.exchangeAccountId === exchangeAccountId ? updated : item)));
      setDrafts((prev) => ({ ...prev, [exchangeAccountId]: limitsToDraft(updated.limits) }));
      setRowMessages((prev) => ({ ...prev, [exchangeAccountId]: t("saved") }));
    } catch (saveError) {
      setRowMessages((prev) => ({ ...prev, [exchangeAccountId]: errMsg(saveError) }));
    } finally {
      setSavingById((prev) => ({ ...prev, [exchangeAccountId]: false }));
    }
  }

  function resetRow(exchangeAccountId: string) {
    const item = items.find((entry) => entry.exchangeAccountId === exchangeAccountId);
    if (!item) return;
    setDrafts((prev) => ({ ...prev, [exchangeAccountId]: limitsToDraft(item.limits) }));
    setRowMessages((prev) => ({ ...prev, [exchangeAccountId]: "" }));
  }

  return (
    <div className="settingsWrap settingsRiskPage">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
        <Link href={withLocalePath("/", locale)} className="btn">
          ← {tCommon("backToDashboard")}
        </Link>
      </div>

      <div className="settingsRiskHead">
        <h2 style={{ margin: 0 }}>{t("title")}</h2>
        <div className="settingsSectionMeta">{t("subtitle")}</div>
      </div>

      {error ? (
        <div className="card" style={{ borderColor: "#ef4444" }}>
          <strong>{t("errors.load")}</strong> {error}
        </div>
      ) : null}

      {loading ? (
        <div className="card settingsRiskState">{t("loading")}</div>
      ) : isEmpty ? (
        <div className="card settingsRiskState">{t("empty")}</div>
      ) : (
        <div className="settingsRiskTable" role="table" aria-label={t("title")}>
          <div className="settingsRiskRow settingsRiskRowHead" role="row">
            <div role="columnheader">{t("columns.account")}</div>
            {RISK_LIMIT_FIELDS.map((field) => (
              <div key={field.key} role="columnheader">{t(`columns.${field.labelKey}`)}</div>
            ))}
            <div role="columnheader">{t("columns.actions")}</div>
          </div>

          {items.map((item) => {
            const draft = drafts[item.exchangeAccountId] ?? limitsToDraft(item.limits);
            const saving = Boolean(savingById[item.exchangeAccountId]);
            return (
              <div key={item.exchangeAccountId} className="settingsRiskRow" role="row">
                <div className="settingsRiskAccountCell" role="cell">
                  <div className="settingsRiskAccountLabel">{item.label}</div>
                  <div className="settingsRiskAccountMeta">{item.exchange.toUpperCase()}</div>
                </div>

                {RISK_LIMIT_FIELDS.map((field) => (
                  <label key={field.key} className="settingsRiskCell" role="cell">
                    <span className="settingsRiskCellLabel">{t(`columns.${field.labelKey}`)}</span>
                    <input
                      type="number"
                      className="input settingsRiskInput"
                      step={field.step}
                      min={0}
                      value={draft[field.key]}
                      onChange={(event) => updateDraft(item.exchangeAccountId, field.key, event.target.value)}
                      disabled={saving}
                    />
                  </label>
                ))}

                <div className="settingsRiskActions" role="cell">
                  <button className="btn btnPrimary" type="button" onClick={() => void saveRow(item.exchangeAccountId)} disabled={saving}>
                    {saving ? tCommon("saving") : t("save")}
                  </button>
                  <button className="btn" type="button" onClick={() => resetRow(item.exchangeAccountId)} disabled={saving}>
                    {t("reset")}
                  </button>
                  {rowMessages[item.exchangeAccountId] ? (
                    <div className="settingsRiskRowMessage">{rowMessages[item.exchangeAccountId]}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
