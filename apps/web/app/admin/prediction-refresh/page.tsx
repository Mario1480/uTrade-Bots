"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type PredictionRefreshSettingsResponse = {
  triggerDebounceSec: number;
  aiCooldownSec: number;
  eventThrottleSec: number;
  hysteresisRatio: number;
  unstableFlipLimit: number;
  unstableFlipWindowSeconds: number;
  updatedAt: string | null;
  source: "env" | "db";
  defaults: {
    triggerDebounceSec: number;
    aiCooldownSec: number;
    eventThrottleSec: number;
    hysteresisRatio: number;
    unstableFlipLimit: number;
    unstableFlipWindowSeconds: number;
  };
};

type RefreshPreset = {
  key: "conservative" | "balanced" | "aggressive";
  values: {
    triggerDebounceSec: number;
    aiCooldownSec: number;
    eventThrottleSec: number;
    hysteresisRatio: number;
    unstableFlipLimit: number;
    unstableFlipWindowSeconds: number;
  };
};

const REFRESH_PRESETS: RefreshPreset[] = [
  {
    key: "conservative",
    values: {
      triggerDebounceSec: 180,
      aiCooldownSec: 900,
      eventThrottleSec: 300,
      hysteresisRatio: 0.7,
      unstableFlipLimit: 4,
      unstableFlipWindowSeconds: 1800
    }
  },
  {
    key: "balanced",
    values: {
      triggerDebounceSec: 120,
      aiCooldownSec: 600,
      eventThrottleSec: 180,
      hysteresisRatio: 0.65,
      unstableFlipLimit: 4,
      unstableFlipWindowSeconds: 1800
    }
  },
  {
    key: "aggressive",
    values: {
      triggerDebounceSec: 60,
      aiCooldownSec: 300,
      eventThrottleSec: 120,
      hysteresisRatio: 0.55,
      unstableFlipLimit: 5,
      unstableFlipWindowSeconds: 1800
    }
  }
];

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminPredictionRefreshPage() {
  const t = useTranslations("admin.predictionRefresh");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<PredictionRefreshSettingsResponse | null>(null);

  const [triggerDebounceSec, setTriggerDebounceSec] = useState("90");
  const [aiCooldownSec, setAiCooldownSec] = useState("300");
  const [eventThrottleSec, setEventThrottleSec] = useState("180");
  const [hysteresisRatio, setHysteresisRatio] = useState("0.6");
  const [unstableFlipLimit, setUnstableFlipLimit] = useState("4");
  const [unstableFlipWindowSeconds, setUnstableFlipWindowSeconds] = useState("1800");

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
      const res = await apiGet<PredictionRefreshSettingsResponse>("/admin/settings/prediction-refresh");
      setSettings(res);
      setTriggerDebounceSec(String(res.triggerDebounceSec));
      setAiCooldownSec(String(res.aiCooldownSec));
      setEventThrottleSec(String(res.eventThrottleSec));
      setHysteresisRatio(String(res.hysteresisRatio));
      setUnstableFlipLimit(String(res.unstableFlipLimit));
      setUnstableFlipWindowSeconds(String(res.unstableFlipWindowSeconds));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  function restoreDefaults() {
    if (!settings?.defaults) return;
    setTriggerDebounceSec(String(settings.defaults.triggerDebounceSec));
    setAiCooldownSec(String(settings.defaults.aiCooldownSec));
    setEventThrottleSec(String(settings.defaults.eventThrottleSec));
    setHysteresisRatio(String(settings.defaults.hysteresisRatio));
    setUnstableFlipLimit(String(settings.defaults.unstableFlipLimit));
    setUnstableFlipWindowSeconds(String(settings.defaults.unstableFlipWindowSeconds));
    setNotice(t("messages.defaultsLoaded"));
  }

  function applyPreset(values: RefreshPreset["values"], label: string) {
    setTriggerDebounceSec(String(values.triggerDebounceSec));
    setAiCooldownSec(String(values.aiCooldownSec));
    setEventThrottleSec(String(values.eventThrottleSec));
    setHysteresisRatio(String(values.hysteresisRatio));
    setUnstableFlipLimit(String(values.unstableFlipLimit));
    setUnstableFlipWindowSeconds(String(values.unstableFlipWindowSeconds));
    setNotice(t("messages.presetLoaded", { label }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        triggerDebounceSec: Number(triggerDebounceSec),
        aiCooldownSec: Number(aiCooldownSec),
        eventThrottleSec: Number(eventThrottleSec),
        hysteresisRatio: Number(hysteresisRatio),
        unstableFlipLimit: Number(unstableFlipLimit),
        unstableFlipWindowSeconds: Number(unstableFlipWindowSeconds)
      };
      const res = await apiPut<PredictionRefreshSettingsResponse>(
        "/admin/settings/prediction-refresh",
        payload
      );
      setSettings(res);
      setTriggerDebounceSec(String(res.triggerDebounceSec));
      setAiCooldownSec(String(res.aiCooldownSec));
      setEventThrottleSec(String(res.eventThrottleSec));
      setHysteresisRatio(String(res.hysteresisRatio));
      setUnstableFlipLimit(String(res.unstableFlipLimit));
      setUnstableFlipWindowSeconds(String(res.unstableFlipWindowSeconds));
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
      <div className="adminPageIntro">
        {t("subtitle")}
      </div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">
          {notice}
        </div>
      ) : null}

      {isSuperadmin ? (
        <section className="card settingsSection">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{t("controlsTitle")}</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            {t("sourceLabel")}: {settings?.source ?? "env"} · {t("lastUpdatedLabel")}:{" "}
            {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : t("never")}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{t("quickPresets")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {REFRESH_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  className="btn"
                  type="button"
                  title={t(`presets.${preset.key}.description`)}
                  onClick={() => applyPreset(preset.values, t(`presets.${preset.key}.label`))}
                >
                  {t(`presets.${preset.key}.label`)}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
              {t("presetTip")}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.triggerDebounce.label")}</span>
              <input className="input" type="number" min={0} max={3600} value={triggerDebounceSec} onChange={(e) => setTriggerDebounceSec(e.target.value)} />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {t("fields.triggerDebounce.hint")}
              </span>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.aiCooldown.label")}</span>
              <input className="input" type="number" min={30} max={3600} value={aiCooldownSec} onChange={(e) => setAiCooldownSec(e.target.value)} />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {t("fields.aiCooldown.hint")}
              </span>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.eventThrottle.label")}</span>
              <input className="input" type="number" min={0} max={3600} value={eventThrottleSec} onChange={(e) => setEventThrottleSec(e.target.value)} />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {t("fields.eventThrottle.hint")}
              </span>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.hysteresisRatio.label")}</span>
              <input className="input" type="number" min={0.2} max={0.95} step={0.01} value={hysteresisRatio} onChange={(e) => setHysteresisRatio(e.target.value)} />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {t("fields.hysteresisRatio.hint")}
              </span>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.unstableFlipLimit.label")}</span>
              <input className="input" type="number" min={2} max={20} value={unstableFlipLimit} onChange={(e) => setUnstableFlipLimit(e.target.value)} />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {t("fields.unstableFlipLimit.hint")}
              </span>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.unstableFlipWindow.label")}</span>
              <input className="input" type="number" min={60} max={86400} value={unstableFlipWindowSeconds} onChange={(e) => setUnstableFlipWindowSeconds(e.target.value)} />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {t("fields.unstableFlipWindow.hint")}
              </span>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={restoreDefaults}>
              {t("loadDefaults")}
            </button>
            <button className="btn btnPrimary" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? t("saving") : t("saveSettings")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
