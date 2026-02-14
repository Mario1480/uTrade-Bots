"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPut } from "../../../lib/api";

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

function signalModeLabel(value: SignalMode): string {
  if (value === "local_only") return "Local only";
  if (value === "ai_only") return "AI only";
  return "Local + AI";
}

export default function AdminPredictionDefaultsPage() {
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
      if (!me?.isSuperadmin) {
        setIsSuperadmin(false);
        setError("Superadmin access required.");
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
    setNotice("Default values loaded into form (not saved yet).");
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
      setNotice("Prediction default settings saved.");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
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
      <h2 style={{ marginTop: 0 }}>Admin · Prediction Defaults</h2>
      <div className="adminPageIntro">
        Global defaults for newly created prediction schedules.
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
            <h3 style={{ margin: 0 }}>Global Create Defaults</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Source: {settings?.source ?? "env"} · Last updated:{" "}
            {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : "never"}
          </div>

          <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Signal mode</span>
            <select
              className="input"
              value={signalMode}
              onChange={(e) => setSignalMode(e.target.value as SignalMode)}
            >
              <option value="local_only">Local only</option>
              <option value="ai_only">AI only</option>
              <option value="both">Local + AI</option>
            </select>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              Applies to newly created predictions. Current: {signalModeLabel(signalMode)}.
            </span>
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={loadDefaults}>
              Load defaults
            </button>
            <button className="btn btnPrimary" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
