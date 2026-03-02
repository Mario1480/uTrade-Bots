"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type BillingPackage = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: "plan" | "ai_topup";
  isActive: boolean;
  priceCents: number;
  currency: string;
  billingMonths: number;
  plan: "free" | "pro" | null;
  maxRunningBots: number | null;
  maxBotsTotal: number | null;
  monthlyAiTokens: string;
  topupAiTokens: string;
};

type BillingOrder = {
  id: string;
  merchantOrderId: string;
  status: "pending" | "paid" | "failed" | "expired";
  amountCents: number;
  currency: string;
  payUrl: string | null;
  paymentStatusRaw: string | null;
  paidAt: string | null;
  createdAt: string | null;
  package: {
    id: string;
    code: string;
    name: string;
    kind: "plan" | "ai_topup";
  } | null;
};

type SubscriptionPayload = {
  billingEnabled: boolean;
  plan: "free" | "pro";
  status: "active" | "inactive";
  proValidUntil: string | null;
  limits: {
    maxRunningBots: number;
    maxBotsTotal: number;
    allowedExchanges: string[];
  };
  usage: {
    totalBots: number;
    runningBots: number;
  };
  ai: {
    tokenBalance: string;
    tokenUsedLifetime: string;
    monthlyIncluded: string;
    billingEnabled: boolean;
  };
  packages: BillingPackage[];
  orders: BillingOrder[];
};

function centsToCurrency(cents: number, currency: string): string {
  const value = Number(cents) / 100;
  return `${value.toFixed(2)} ${currency}`;
}

export default function SubscriptionPage() {
  const t = useTranslations("settings.subscription");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [checkoutLoadingPackageId, setCheckoutLoadingPackageId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [payload, setPayload] = useState<SubscriptionPayload | null>(null);

  const planPackages = useMemo(
    () => (payload?.packages ?? []).filter((item) => item.kind === "plan"),
    [payload]
  );
  const topupPackages = useMemo(
    () => (payload?.packages ?? []).filter((item) => item.kind === "ai_topup"),
    [payload]
  );

  function errMsg(error: unknown): string {
    if (error instanceof ApiError) {
      const detail = typeof error.payload?.error === "string" ? error.payload.error : null;
      const reason = typeof error.payload?.reason === "string" ? error.payload.reason : null;
      if (detail && reason) return `${error.message} (${detail}: ${reason})`;
      if (detail) return `${error.message} (${detail})`;
      if (reason) return `${error.message} (${reason})`;
      return `${error.message}`;
    }
    if (error && typeof error === "object" && "message" in error) {
      return String((error as { message?: unknown }).message ?? error);
    }
    return String(error);
  }

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const data = await apiGet<SubscriptionPayload>("/settings/subscription");
      setPayload(data);
    } catch (error) {
      setMsg(errMsg(error));
    } finally {
      setLoading(false);
    }
  }

  async function checkout(packageId: string) {
    setCheckoutLoadingPackageId(packageId);
    setMsg(null);
    try {
      const res = await apiPost<{ payUrl: string }>("/settings/subscription/checkout", { packageId });
      if (!res.payUrl) {
        throw new Error("checkout_url_missing");
      }
      window.location.assign(res.payUrl);
    } catch (error) {
      setMsg(errMsg(error));
    } finally {
      setCheckoutLoadingPackageId(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
        <Link href={withLocalePath("/", locale)} className="btn">
          ← {tCommon("backToDashboard")}
        </Link>
      </div>

      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>

      <div className="card" style={{ padding: 12, fontSize: 13, marginBottom: 12 }}>
        {loading ? (
          <div style={{ color: "var(--muted)" }}>{tCommon("loading")}</div>
        ) : payload ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div><b>{t("status.plan")}:</b> {payload.plan.toUpperCase()}</div>
            <div><b>{t("status.state")}:</b> {payload.status.toUpperCase()}</div>
            <div><b>{t("status.validUntil")}:</b> {payload.proValidUntil ?? "-"}</div>
            <div>
              <b>{t("status.botLimits")}:</b> {payload.usage.runningBots}/{payload.limits.maxRunningBots} running, {payload.usage.totalBots}/{payload.limits.maxBotsTotal} total
            </div>
            <div><b>{t("status.exchanges")}:</b> {payload.limits.allowedExchanges.join(", ")}</div>
            <div><b>{t("status.aiBalance")}:</b> {payload.ai.tokenBalance}</div>
            <div><b>{t("status.aiMonthlyIncluded")}:</b> {payload.ai.monthlyIncluded}</div>
            <div><b>{t("status.aiUsedLifetime")}:</b> {payload.ai.tokenUsedLifetime}</div>
          </div>
        ) : (
          <div style={{ color: "var(--muted)" }}>{t("messages.noData")}</div>
        )}
      </div>

      <div className="card" style={{ padding: 12, fontSize: 13, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("packages.title")}</div>
        <div style={{ color: "var(--muted)", marginBottom: 10 }}>{t("packages.description")}</div>

        <div style={{ display: "grid", gap: 10 }}>
          {[...planPackages, ...topupPackages].map((pkg) => (
            <div key={pkg.id} className="settingsPanel" style={{ padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{pkg.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{pkg.description ?? "-"}</div>
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    {pkg.kind === "plan" ? t("packages.kindPlan") : t("packages.kindTopup")}
                    {pkg.plan ? ` · ${pkg.plan.toUpperCase()}` : ""}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    {t("packages.price")}: {centsToCurrency(pkg.priceCents, pkg.currency)}
                  </div>
                  {pkg.kind === "plan" ? (
                    <div style={{ marginTop: 4, fontSize: 12 }}>
                      {t("packages.planDetails", {
                        months: pkg.billingMonths,
                        running: pkg.maxRunningBots ?? 0,
                        total: pkg.maxBotsTotal ?? 0,
                        tokens: pkg.monthlyAiTokens
                      })}
                    </div>
                  ) : (
                    <div style={{ marginTop: 4, fontSize: 12 }}>
                      {t("packages.topupDetails", { tokens: pkg.topupAiTokens })}
                    </div>
                  )}
                </div>
                <div>
                  <button
                    className="btn btnPrimary"
                    onClick={() => checkout(pkg.id)}
                    disabled={checkoutLoadingPackageId === pkg.id || !payload?.billingEnabled}
                  >
                    {checkoutLoadingPackageId === pkg.id ? tCommon("saving") : t("packages.buy")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 12, fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>{t("orders.title")}</div>
          <button className="btn" onClick={load} disabled={loading}>{t("orders.refresh")}</button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>{t("orders.createdAt")}</th>
                <th>{t("orders.package")}</th>
                <th>{t("orders.amount")}</th>
                <th>{t("orders.status")}</th>
                <th>{t("orders.action")}</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.orders ?? []).map((order) => (
                <tr key={order.id}>
                  <td>{order.createdAt ?? "-"}</td>
                  <td>{order.package?.name ?? "-"}</td>
                  <td>{centsToCurrency(order.amountCents, order.currency)}</td>
                  <td>{order.status.toUpperCase()}</td>
                  <td>
                    {order.status === "pending" && order.payUrl ? (
                      <a href={order.payUrl} target="_blank" rel="noreferrer">{t("orders.payNow")}</a>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
              {(payload?.orders ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>{t("orders.empty")}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {msg ? <div style={{ marginTop: 10, color: "var(--warn)" }}>{msg}</div> : null}
    </div>
  );
}
