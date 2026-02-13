"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminSmtpPage() {
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpHasPassword, setSmtpHasPassword] = useState(false);
  const [smtpTestTo, setSmtpTestTo] = useState("");

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
      const smtpRes = await apiGet<any>("/admin/settings/smtp");
      setSmtpHost(smtpRes.host ?? "");
      setSmtpPort(String(smtpRes.port ?? 465));
      setSmtpUser(smtpRes.user ?? "");
      setSmtpFrom(smtpRes.from ?? "");
      setSmtpSecure(Boolean(smtpRes.secure));
      setSmtpHasPassword(Boolean(smtpRes.hasPassword));
      setSmtpPassword("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveSmtp() {
    setError(null);
    setNotice(null);
    try {
      const payload: any = {
        host: smtpHost,
        port: Number(smtpPort),
        user: smtpUser,
        from: smtpFrom,
        secure: smtpSecure
      };
      if (smtpPassword.trim()) payload.password = smtpPassword.trim();
      const res = await apiPut<any>("/admin/settings/smtp", payload);
      setSmtpHasPassword(Boolean(res.hasPassword));
      setSmtpPassword("");
      setNotice("SMTP settings saved.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function testSmtp() {
    setError(null);
    setNotice(null);
    try {
      await apiPost("/admin/settings/smtp/test", { to: smtpTestTo.trim() });
      setNotice("SMTP test email sent.");
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
      <h2 style={{ marginTop: 0 }}>Admin · SMTP</h2>
      <div className="adminPageIntro">
        Manage SMTP transport used for system and reset emails.
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
            <h3 style={{ margin: 0 }}>SMTP Settings</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Password stored: {smtpHasPassword ? "yes" : "no"}
          </div>
          <div className="settingsFormGrid">
            <label className="settingsField">
              <span className="settingsFieldLabel">Host</span>
              <input className="input" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">Port</span>
              <input className="input" type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">User</span>
              <input className="input" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">From</span>
              <input className="input" value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} />
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
              <span>Use secure connection</span>
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">Password (leave empty to keep)</span>
              <input
                className="input"
                type="password"
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btnPrimary" onClick={() => void saveSmtp()}>
                Save SMTP
              </button>
            </div>
            <label className="settingsField">
              <span className="settingsFieldLabel">Test recipient</span>
              <input className="input" value={smtpTestTo} onChange={(e) => setSmtpTestTo(e.target.value)} />
            </label>
            <div>
              <button className="btn" onClick={() => void testSmtp()} disabled={!smtpTestTo.trim()}>
                Send SMTP test
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
