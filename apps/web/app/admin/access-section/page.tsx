"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import {
  DEFAULT_ACCESS_SECTION_LIMITS,
  DEFAULT_ACCESS_SECTION_VISIBILITY,
  type AccessSectionAdminResponse,
  type AccessSectionLimits,
  type AccessSectionVisibility
} from "../../../src/access/accessSection";

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

function limitToInput(value: number | null): string {
  return value === null ? "" : String(value);
}

function parseLimitInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  if (normalized < 0) return null;
  return normalized;
}

export default function AdminAccessSectionPage() {
  const t = useTranslations("admin.accessSection");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<AccessSectionAdminResponse | null>(null);
  const [visibility, setVisibility] = useState<AccessSectionVisibility>(DEFAULT_ACCESS_SECTION_VISIBILITY);
  const [limitInputs, setLimitInputs] = useState<Record<keyof AccessSectionLimits, string>>({
    bots: "",
    predictionsLocal: "",
    predictionsAi: "",
    predictionsComposite: ""
  });

  function applyResponse(payload: AccessSectionAdminResponse) {
    setSettings(payload);
    setVisibility(payload.visibility);
    setLimitInputs({
      bots: limitToInput(payload.limits.bots),
      predictionsLocal: limitToInput(payload.limits.predictionsLocal),
      predictionsAi: limitToInput(payload.limits.predictionsAi),
      predictionsComposite: limitToInput(payload.limits.predictionsComposite)
    });
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsSuperadmin(false);
        setError(t("messages.accessRequired"));
        return;
      }
      setIsSuperadmin(true);
      const payload = await apiGet<AccessSectionAdminResponse>("/admin/settings/access-section");
      applyResponse(payload);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  function loadDefaults() {
    if (!settings) return;
    setVisibility(settings.defaults.visibility);
    setLimitInputs({
      bots: limitToInput(settings.defaults.limits.bots),
      predictionsLocal: limitToInput(settings.defaults.limits.predictionsLocal),
      predictionsAi: limitToInput(settings.defaults.limits.predictionsAi),
      predictionsComposite: limitToInput(settings.defaults.limits.predictionsComposite)
    });
    setNotice(t("messages.defaultsLoaded"));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const nextLimits: AccessSectionLimits = {
        bots: parseLimitInput(limitInputs.bots),
        predictionsLocal: parseLimitInput(limitInputs.predictionsLocal),
        predictionsAi: parseLimitInput(limitInputs.predictionsAi),
        predictionsComposite: parseLimitInput(limitInputs.predictionsComposite)
      };
      const payload = await apiPut<AccessSectionAdminResponse>("/admin/settings/access-section", {
        visibility,
        limits: nextLimits
      });
      applyResponse(payload);
      setNotice(t("messages.saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href={withLocalePath("/admin", locale)} className="btn">
          ← {tCommon("backToAdmin")}
        </Link>
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="adminPageIntro">{t("subtitle")}</div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">{error}</div>
      ) : null}
      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div>
      ) : null}

      {isSuperadmin ? (
        <section className="card settingsSection">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{t("sectionTitle")}</h3>
            <div className="settingsSectionMeta">
              {t("sourceLabel")}: {settings?.source ?? "default"} · {t("lastUpdatedLabel")}:{" "}
              {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : t("never")}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <h4 style={{ margin: 0 }}>{t("visibilityTitle")}</h4>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={visibility.tradingDesk}
                onChange={(event) =>
                  setVisibility((prev) => ({ ...prev, tradingDesk: event.target.checked }))
                }
              />
              <span>{t("visibility.tradingDesk")}</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={visibility.bots}
                onChange={(event) =>
                  setVisibility((prev) => ({ ...prev, bots: event.target.checked }))
                }
              />
              <span>{t("visibility.bots")}</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={visibility.predictionsDashboard}
                onChange={(event) =>
                  setVisibility((prev) => ({ ...prev, predictionsDashboard: event.target.checked }))
                }
              />
              <span>{t("visibility.predictionsDashboard")}</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={visibility.economicCalendar}
                onChange={(event) =>
                  setVisibility((prev) => ({ ...prev, economicCalendar: event.target.checked }))
                }
              />
              <span>{t("visibility.economicCalendar")}</span>
            </label>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <h4 style={{ margin: 0 }}>{t("limitsTitle")}</h4>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("limitsHint")}</div>
            <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("limits.bots")}</span>
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={limitInputs.bots}
                placeholder={t("unlimited")}
                onChange={(event) =>
                  setLimitInputs((prev) => ({ ...prev, bots: event.target.value }))
                }
              />
            </label>
            <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("limits.predictionsLocal")}</span>
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={limitInputs.predictionsLocal}
                placeholder={t("unlimited")}
                onChange={(event) =>
                  setLimitInputs((prev) => ({ ...prev, predictionsLocal: event.target.value }))
                }
              />
            </label>
            <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("limits.predictionsAi")}</span>
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={limitInputs.predictionsAi}
                placeholder={t("unlimited")}
                onChange={(event) =>
                  setLimitInputs((prev) => ({ ...prev, predictionsAi: event.target.value }))
                }
              />
            </label>
            <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("limits.predictionsComposite")}</span>
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={limitInputs.predictionsComposite}
                placeholder={t("unlimited")}
                onChange={(event) =>
                  setLimitInputs((prev) => ({ ...prev, predictionsComposite: event.target.value }))
                }
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={loadDefaults}>
              {t("loadDefaults")}
            </button>
            <button
              className="btn btnPrimary"
              type="button"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? t("saving") : t("saveSettings")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
