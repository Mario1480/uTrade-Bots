"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type ServerInfoResponse = {
  serverIpAddress: string | null;
  updatedAt: string | null;
  source: "db" | "env" | "none";
  defaults: {
    serverIpAddress: string | null;
  };
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

export default function AdminServerInfoPage() {
  const t = useTranslations("admin.serverInfo");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<ServerInfoResponse | null>(null);
  const [serverIpAddress, setServerIpAddress] = useState("");

  function applyResponse(payload: ServerInfoResponse) {
    setData(payload);
    setServerIpAddress(payload.serverIpAddress ?? "");
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
      const payload = await apiGet<ServerInfoResponse>("/admin/settings/server-info");
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

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPut<ServerInfoResponse>("/admin/settings/server-info", {
        serverIpAddress: serverIpAddress.trim() || null
      });
      applyResponse(payload);
      setNotice(t("messages.saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  function loadDefault() {
    setServerIpAddress(data?.defaults.serverIpAddress ?? "");
    setNotice(t("messages.defaultLoaded"));
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
              {t("sourceLabel")}: {data?.source ?? "none"} · {t("lastUpdatedLabel")}:{" "}
              {data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : t("never")}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fieldLabel")}</span>
              <input
                className="input"
                value={serverIpAddress}
                onChange={(event) => setServerIpAddress(event.target.value)}
                placeholder={t("placeholder")}
              />
            </label>
            <div className="settingsMutedText">{t("hint")}</div>
            <div className="settingsMutedText">
              {t("defaultLabel")}: {data?.defaults.serverIpAddress ?? t("notConfigured")}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={loadDefault}>
              {t("loadDefault")}
            </button>
            <button className="btn btnPrimary" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

