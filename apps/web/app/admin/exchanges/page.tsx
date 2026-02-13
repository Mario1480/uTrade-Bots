"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPut } from "../../../lib/api";

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
      if (!me?.isSuperadmin) {
        setIsSuperadmin(false);
        setError("Superadmin access required.");
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
      setNotice("Exchange offer updated.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href="/admin" className="btn">
          ← Back to admin
        </Link>
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Admin · Offered Exchanges</h2>
      <div className="adminPageIntro">
        Choose which exchanges are available for user account onboarding.
      </div>

      {loading ? <div className="settingsMutedText">Loading...</div> : null}
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
            <h3 style={{ margin: 0 }}>Exchange Availability</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Enabled exchanges are offered to users in exchange account setup.
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
              Save exchanges
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
