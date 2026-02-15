"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type SubscriptionStatus = {
  configured: boolean;
  licenseKeyMasked: string | null;
  instanceId: string | null;
  status: string | null;
  validUntil: string | null;
  limits: {
    includedBots: number;
    addOnBots: number;
    includedCex: number;
    addOnCex: number;
  } | null;
  features: {
    priceSupport: boolean;
    priceFollow: boolean;
    aiRecommendations: boolean;
    dexPriceFeed?: boolean;
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
  checkedAt: string | null;
  error: { code: string; status?: number; message?: string } | null;
  source: "db" | "env" | "none";
};

export default function SubscriptionPage() {
  const t = useTranslations("settings.subscription");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);

  function errMsg(e: any): string {
    if (e instanceof ApiError) {
      const detail = e.payload?.details ? ` — ${e.payload.details}` : "";
      return `${e.message}${detail} (HTTP ${e.status})`;
    }
    return e?.message ? String(e.message) : String(e);
  }

  async function loadStatus() {
    setLoading(true);
    try {
      const [data, me] = await Promise.all([
        apiGet<SubscriptionStatus>("/settings/subscription"),
        apiGet<{ workspaceId: string }>("/auth/me")
      ]);
      setStatus(data);
      setWorkspaceId(me.workspaceId ?? "");
      setLicenseKey("");
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        licenseKey: licenseKey.trim()
      };
      const res = await apiPut<SubscriptionStatus>("/settings/subscription", payload);
      setStatus(res);
      setLicenseKey("");
      setMsg(t("messages.savedVerified"));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function clearLicense() {
    if (!confirm(t("confirmRemove"))) {
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiDelete<SubscriptionStatus>("/settings/subscription");
      setStatus(res);
      setLicenseKey("");
      setWorkspaceId("");
      setMsg(t("messages.removed"));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
        <Link href={withLocalePath("/", locale)} className="btn">
          ← {tCommon("backToDashboard")}
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="card" style={{ padding: 12, fontSize: 13 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("status.title")}</div>
        {loading ? (
          <div style={{ color: "var(--muted)" }}>{tCommon("loading")}</div>
        ) : status ? (
          <div style={{ display: "grid", gap: 6 }}>
            <div>
              <b>{t("status.status")}:</b>{" "}
              {status.status ?? (status.configured ? t("status.unknown") : t("status.notConfigured"))}
            </div>
            <div>
              <b>{t("status.validUntil")}:</b> {status.validUntil ?? "—"}
            </div>
            <div>
              <b>{t("status.checkedAt")}:</b> {status.checkedAt ?? "—"}
            </div>
            <div>
              <b>{t("status.source")}:</b> {status.source}
            </div>
            {status.error ? (
              <div style={{ color: "var(--warn)" }}>
                {t("status.error")}: {status.error.code}
                {status.error.status ? ` (HTTP ${status.error.status})` : ""}
                {status.error.message ? ` — ${status.error.message}` : ""}
              </div>
            ) : null}
            {status.limits ? (
              <div>
                <b>{t("status.limits")}:</b> {t("status.bots")} {status.limits.includedBots + status.limits.addOnBots}
                {", "}cex {status.limits.includedCex + status.limits.addOnCex}
              </div>
            ) : null}
            {status.usage ? (
              <div>
                <b>{t("status.usage")}:</b> {t("status.bots")} {status.usage.bots}
                {status.limits ? ` / ${status.limits.includedBots + status.limits.addOnBots}` : ""}
                {", "}cex {status.usage.cex}
                {status.limits ? ` / ${status.limits.includedCex + status.limits.addOnCex}` : ""}
              </div>
            ) : null}
            {status.features ? (
              <div>
                <b>{t("status.features")}:</b>{" "}
                {`priceSupport=${status.features.priceSupport ? "on" : "off"}, `}
                {`priceFollow=${status.features.priceFollow ? "on" : "off"}, `}
                {`ai=${status.features.aiRecommendations ? "on" : "off"}, `}
                {`dexPriceFeed=${status.features.dexPriceFeed ? "on" : "off"}`}
              </div>
            ) : null}
            {status.overrides ? (
              <div>
                <b>{t("status.overrides")}:</b>{" "}
                {`manual=${status.overrides.manual ? "on" : "off"}, `}
                {`unlimited=${status.overrides.unlimited ? "on" : "off"}`}
                {status.overrides.note ? ` — ${status.overrides.note}` : ""}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card" style={{ padding: 12, fontSize: 13, marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("config.title")}</div>
        <div style={{ color: "var(--muted)", marginBottom: 10 }}>
          {t("config.description")}
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("config.licenseKey")}</span>
            <input
              className="input"
              placeholder={
                status?.licenseKeyMasked
                  ? t("config.currentKeyPlaceholder", { key: status.licenseKeyMasked })
                  : "UUID"
              }
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
            />
          </label>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {t("config.instanceId")}
            <span style={{ marginLeft: 6, fontWeight: 600 }}>
              {workspaceId || status?.instanceId || "—"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button className="btn btnPrimary" onClick={save} disabled={saving}>
            {saving ? tCommon("saving") : t("config.saveVerify")}
          </button>
          <button className="btn" onClick={loadStatus} disabled={loading}>
            {t("config.refreshStatus")}
          </button>
          <button className="btn btnStop" onClick={clearLicense} disabled={saving || loading}>
            {t("config.removeLicense")}
          </button>
        </div>
        {msg ? <div style={{ marginTop: 10, color: "var(--muted)" }}>{msg}</div> : null}
      </div>
    </div>
  );
}
