"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import {
  buildLicensePageModel,
  centsToCurrency,
  type BillingOrder,
  type AuthMePayload,
  type ServerInfoPayload,
  type SubscriptionPayload
} from "../../../src/billing/subscriptionViewModel";

function formatMaybeDate(value: string | null, locale: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale);
}

function formatOrderPackageLabel(order: BillingOrder): string {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items
      .map((item) => `${item.package?.name ?? "-"} x${item.quantity}`)
      .join(", ");
  }
  return order.package?.name ?? "-";
}

function renderOrderPackageCell(order: BillingOrder) {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return (
      <div className="subscriptionOrderPackageCell">
        {order.items.map((item) => (
          <div key={item.id} className="subscriptionOrderPackageLine">
            {item.package?.name ?? "-"} x{item.quantity}
          </div>
        ))}
      </div>
    );
  }
  return <span>{formatOrderPackageLabel(order)}</span>;
}

export default function SubscriptionPage() {
  const t = useTranslations("settings.subscription");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [payload, setPayload] = useState<SubscriptionPayload | null>(null);
  const [me, setMe] = useState<AuthMePayload | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfoPayload | null>(null);

  const model = useMemo(
    () => buildLicensePageModel(payload, me, serverInfo),
    [payload, me, serverInfo]
  );

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const [subscriptionResult, meResult, serverInfoResult] = await Promise.allSettled([
        apiGet<SubscriptionPayload>("/settings/subscription"),
        apiGet<AuthMePayload>("/auth/me"),
        apiGet<ServerInfoPayload>("/settings/server-info")
      ]);

      if (subscriptionResult.status === "fulfilled") {
        setPayload(subscriptionResult.value);
      } else {
        setPayload(null);
        const reason = subscriptionResult.reason;
        if (reason instanceof ApiError) {
          setMessage(reason.message);
        } else {
          setMessage(String(reason));
        }
      }

      if (meResult.status === "fulfilled") {
        setMe(meResult.value);
      } else {
        setMe(null);
      }

      if (serverInfoResult.status === "fulfilled") {
        setServerInfo(serverInfoResult.value);
      } else {
        setServerInfo(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="subscriptionPortalWrap">
      <div className="subscriptionPortalTopActions">
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
        <Link href={withLocalePath("/", locale)} className="btn">
          ← {tCommon("backToDashboard")}
        </Link>
      </div>

      <div className="subscriptionPortalHeader">
        <p className="subscriptionPortalEyebrow">{t("portalEyebrow")}</p>
        <h2>{t("license.title")}</h2>
        <p className="subscriptionPortalMuted">{t("license.subtitle")}</p>
      </div>

      {loading ? (
        <div className="card subscriptionPortalLoading">{tCommon("loading")}</div>
      ) : model ? (
        <>
          <div className="subscriptionPortalGrid">
            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardHead">
                <div className="subscriptionCardTitle">{t("license.cards.status")}</div>
                <span className={`subscriptionStatusBadge ${model.status === "active" ? "subscriptionStatusBadgeActive" : "subscriptionStatusBadgeInactive"}`}>
                  {model.status === "active" ? t("license.states.active") : t("license.states.inactive")}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.plan")}</span>
                <b>{model.plan === "pro" ? t("license.plans.pro") : t("license.plans.free")}</b>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.validUntil")}</span>
                <span>{formatMaybeDate(model.proValidUntil, locale)}</span>
              </div>
              {model.fallbackReason ? (
                <div className="subscriptionPortalWarn">
                  {t("license.fallbackMode", { reason: model.fallbackReason })}
                </div>
              ) : null}
            </div>

            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.account")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.email")}</span>
                <span>{model.account.email ?? "-"}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.userId")}</span>
                <span className="subscriptionMono">{model.account.userId ?? "-"}</span>
              </div>
            </div>

            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.limits")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.bots")}</span>
                <span>
                  {model.limits.bots.running}/{model.limits.bots.maxRunning} {t("license.running")} ·{" "}
                  {model.limits.bots.total}/{model.limits.bots.maxTotal} {t("license.total")}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.predictionsAi")}</span>
                <span>
                  {model.limits.predictionsAi.running}/
                  {model.limits.predictionsAi.maxRunning ?? t("license.unlimited")} {t("license.running")} ·{" "}
                  {model.limits.predictionsAi.total}/
                  {model.limits.predictionsAi.maxTotal ?? t("license.unlimited")} {t("license.total")}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.predictionsComposite")}</span>
                <span>
                  {model.limits.predictionsComposite.running}/
                  {model.limits.predictionsComposite.maxRunning ?? t("license.unlimited")} {t("license.running")} ·{" "}
                  {model.limits.predictionsComposite.total}/
                  {model.limits.predictionsComposite.maxTotal ?? t("license.unlimited")} {t("license.total")}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.exchanges")}</span>
                <span>{model.limits.exchanges.join(", ") || "-"}</span>
              </div>
            </div>

            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.features")}</div>
              <div className="subscriptionFeatureWrap">
                <span className={`subscriptionFeatureBadge ${model.features.proPlan ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.proPlan")}
                </span>
                <span className={`subscriptionFeatureBadge ${model.features.aiBillingEnabled ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.aiBilling")}
                </span>
                <span className={`subscriptionFeatureBadge ${model.features.aiTopupAvailable ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.aiTopup")}
                </span>
                <span className={`subscriptionFeatureBadge ${model.features.capacityTopupAvailable ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.capacityTopup")}
                </span>
              </div>
            </div>

            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.aiWallet")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiBalance")}</span>
                <span>{model.ai.balance}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiMonthlyIncluded")}</span>
                <span>{model.ai.monthlyIncluded}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiUsedLifetime")}</span>
                <span>{model.ai.usedLifetime}</span>
              </div>
            </div>

            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.instance")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.serverIp")}</span>
                <span>{model.instance.serverIpAddress ?? "-"}</span>
              </div>
              <Link href={withLocalePath("/settings/subscription/order", locale)} className="btn btnPrimary subscriptionPortalCardAction">
                {t("license.openOrderPage")}
              </Link>
            </div>
          </div>

          <div className="card subscriptionPortalOrdersCard">
            <div className="subscriptionCardHead">
              <div className="subscriptionCardTitle">{t("orders.title")}</div>
              <button className="btn" type="button" onClick={() => void load()}>
                {t("orders.refresh")}
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="table subscriptionOrdersTable">
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
                  {model.orders.map((order) => (
                    <tr key={order.id}>
                      <td>{formatMaybeDate(order.createdAt, locale)}</td>
                      <td>{renderOrderPackageCell(order)}</td>
                      <td>{centsToCurrency(order.amountCents, order.currency)}</td>
                      <td>
                        <span className={`subscriptionStatusPill subscriptionStatusPill${order.status}`}>
                          {order.status.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {order.status === "pending" && order.payUrl ? (
                          <a href={order.payUrl} target="_blank" rel="noreferrer">{t("orders.payNow")}</a>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                  {model.orders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="subscriptionPortalMuted">{t("orders.empty")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card subscriptionPortalUpgradeCard">
            <div>
              <div className="subscriptionCardTitle">{t("license.upgradeTitle")}</div>
              <div className="subscriptionPortalMuted">{t("license.upgradeDescription")}</div>
            </div>
            <Link href={withLocalePath("/settings/subscription/order", locale)} className="btn btnPrimary">
              {t("license.openOrderPage")}
            </Link>
          </div>
        </>
      ) : (
        <div className="card subscriptionPortalLoading">{t("messages.noData")}</div>
      )}

      {message ? <div className="subscriptionPortalMessage">{message}</div> : null}
    </div>
  );
}
