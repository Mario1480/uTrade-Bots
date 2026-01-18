"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPut } from "../../../lib/api";

type SecuritySettings = {
  autoLogoutEnabled: boolean;
  autoLogoutMinutes: number;
  reauthOtpEnabled?: boolean;
  isSuperadmin?: boolean;
};

export default function SecurityPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [minutes, setMinutes] = useState(60);
  const [otpEnabled, setOtpEnabled] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  function errMsg(e: any): string {
    if (e instanceof ApiError) {
      return `${e.message} (HTTP ${e.status})`;
    }
    return e?.message ? String(e.message) : String(e);
  }

  async function loadSettings() {
    setLoading(true);
    setMsg(null);
    try {
      const data = await apiGet<SecuritySettings>("/settings/security");
      setEnabled(Boolean(data.autoLogoutEnabled));
      setMinutes(Number(data.autoLogoutMinutes) || 60);
      setOtpEnabled(data.reauthOtpEnabled !== false);
      setIsSuperadmin(Boolean(data.isSuperadmin));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setMsg(null);
    const safeMinutes = Math.max(1, Math.min(1440, Math.floor(minutes)));
    try {
      const payload: SecuritySettings = {
        autoLogoutEnabled: enabled,
        autoLogoutMinutes: safeMinutes
      };
      if (isSuperadmin) {
        payload.reauthOtpEnabled = otpEnabled;
      }
      const data = await apiPut<SecuritySettings>("/settings/security", payload);
      setEnabled(Boolean(data.autoLogoutEnabled));
      setMinutes(Number(data.autoLogoutMinutes) || safeMinutes);
      setOtpEnabled(data.reauthOtpEnabled !== false);
      setIsSuperadmin(Boolean(data.isSuperadmin));
      setMsg("Saved.");
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
        <Link href="/" className="btn">
          ← Back to dashboard
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Security</h2>
      <div className="card" style={{ padding: 12, fontSize: 13 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Session idle timeout</div>
        <div style={{ color: "var(--muted)", marginBottom: 10 }}>
          Automatically log out after inactivity.
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 10, maxWidth: 320 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={loading || saving}
            />
            <span>Enable auto-logout</span>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Idle minutes</span>
            <input
              className="input"
              type="number"
              min={1}
              max={1440}
              value={Number.isFinite(minutes) ? minutes : 60}
              onChange={(e) => setMinutes(Number(e.target.value))}
              disabled={!enabled || loading || saving}
            />
          </label>
          {isSuperadmin ? (
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={otpEnabled}
                onChange={(e) => setOtpEnabled(e.target.checked)}
                disabled={loading || saving}
              />
              <span>Require OTP re-auth for sensitive actions</span>
            </label>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btnPrimary" onClick={saveSettings} disabled={loading || saving}>
            {saving ? "Saving..." : "Save settings"}
          </button>
          <button className="btn" onClick={loadSettings} disabled={loading || saving}>
            {loading ? "Loading..." : "Reload"}
          </button>
        </div>
        {msg ? (
          <div style={{ marginTop: 10, color: "var(--muted)" }}>{msg}</div>
        ) : null}
      </div>
    </div>
  );
}
