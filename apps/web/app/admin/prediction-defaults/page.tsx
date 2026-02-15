"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type SignalMode = "local_only" | "ai_only" | "both";

type PredictionDefaultsResponse = {
  signalMode: SignalMode;
  updatedAt: string | null;
  source: "env" | "db";
  defaults: {
    signalMode: SignalMode;
  };
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function signalModeLabel(value: SignalMode, t: (key: string) => string): string {
  if (value === "local_only") return t("modes.localOnly");
  if (value === "ai_only") return t("modes.aiOnly");
  return t("modes.both");
}

export default function AdminPredictionDefaultsPage() {
  const t = useTranslations("admin.predictionDefaults");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<PredictionDefaultsResponse | null>(null);
  const [signalMode, setSignalMode] = useState<SignalMode>("both");

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
      const res = await apiGet<PredictionDefaultsResponse>("/admin/settings/prediction-defaults");
      setSettings(res);
      setSignalMode(res.signalMode);
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
    if (!settings?.defaults) return;
    setSignalMode(settings.defaults.signalMode);
    setNotice(t("messages.defaultsLoaded"));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<PredictionDefaultsResponse>("/admin/settings/prediction-defaults", {
        signalMode
      });
      setSettings(res);
      setSignalMode(res.signalMode);
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
            <h3 style={{ margin: 0 }}>{t("globalDefaultsTitle")}</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            {t("sourceLabel")}: {settings?.source ?? "env"} · {t("lastUpdatedLabel")}:{" "}
            {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : t("never")}
          </div>

          <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("signalMode")}</span>
            <select
              className="input"
              value={signalMode}
              onChange={(e) => setSignalMode(e.target.value as SignalMode)}
            >
              <option value="local_only">{t("modes.localOnly")}</option>
              <option value="ai_only">{t("modes.aiOnly")}</option>
              <option value="both">{t("modes.both")}</option>
            </select>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {t("signalModeHint", { current: signalModeLabel(signalMode, t) })}.
            </span>
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={loadDefaults}>
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
