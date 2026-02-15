"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type ExchangeOption = {
  value: string;
  label: string;
  enabled: boolean;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminExchangesPage() {
  const t = useTranslations("admin.exchanges");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exchangeOptions, setExchangeOptions] = useState<ExchangeOption[]>([]);

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

      const exchangesRes = await apiGet<{ options: ExchangeOption[] }>("/admin/settings/exchanges");
      setExchangeOptions(exchangesRes.options ?? []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveExchanges() {
    setError(null);
    setNotice(null);
    try {
      const allowed = exchangeOptions.filter((item) => item.enabled).map((item) => item.value);
      const res = await apiPut<{ options: ExchangeOption[] }>("/admin/settings/exchanges", { allowed });
      setExchangeOptions(res.options ?? []);
      setNotice(t("messages.saved"));
    } catch (e) {
      setError(errMsg(e));
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
            <h3 style={{ margin: 0 }}>{t("sectionTitle")}</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            {t("description")}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {exchangeOptions.map((option, idx) => (
              <label key={option.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={option.enabled}
                  onChange={(e) =>
                    setExchangeOptions((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, enabled: e.target.checked } : item))
                    )
                  }
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn btnPrimary" onClick={() => void saveExchanges()}>
              {t("save")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
