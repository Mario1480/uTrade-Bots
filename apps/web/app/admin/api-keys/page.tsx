"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPut } from "../../../lib/api";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

type ApiKeysSettingsResponse = {
  openaiApiKeyMasked: string | null;
  hasOpenAiApiKey: boolean;
  updatedAt: string | null;
  envOverride: boolean;
};

export default function AdminApiKeysPage() {
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiApiKeyMasked, setOpenaiApiKeyMasked] = useState<string | null>(null);
  const [hasOpenAiApiKey, setHasOpenAiApiKey] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [envOverride, setEnvOverride] = useState(false);

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

      const res = await apiGet<ApiKeysSettingsResponse>("/admin/settings/api-keys");
      setOpenaiApiKeyMasked(res.openaiApiKeyMasked ?? null);
      setHasOpenAiApiKey(Boolean(res.hasOpenAiApiKey));
      setUpdatedAt(res.updatedAt ?? null);
      setEnvOverride(Boolean(res.envOverride));
      setOpenaiApiKey("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveOpenAiKey() {
    const trimmed = openaiApiKey.trim();
    if (!trimmed) {
      setError("Please enter an OpenAI API key.");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        openaiApiKey: trimmed,
        clearOpenaiApiKey: false
      });
      setOpenaiApiKey("");
      setOpenaiApiKeyMasked(res.openaiApiKeyMasked ?? null);
      setHasOpenAiApiKey(Boolean(res.hasOpenAiApiKey));
      setUpdatedAt(res.updatedAt ?? null);
      setNotice("OpenAI API key saved.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function clearOpenAiKey() {
    const confirmed = window.confirm("Remove the stored OpenAI API key?");
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        clearOpenaiApiKey: true
      });
      setOpenaiApiKey("");
      setOpenaiApiKeyMasked(res.openaiApiKeyMasked ?? null);
      setHasOpenAiApiKey(Boolean(res.hasOpenAiApiKey));
      setUpdatedAt(res.updatedAt ?? null);
      setNotice("OpenAI API key removed.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="settingsWrap">
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/admin" className="btn">
          ← Back to admin
        </Link>
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Admin · API Keys</h2>

      {loading ? <div>Loading...</div> : null}
      {error ? (
        <div className="card settingsSection" style={{ borderColor: "#ef4444", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="card settingsSection" style={{ borderColor: "#22c55e", marginBottom: 12 }}>
          {notice}
        </div>
      ) : null}

      {isSuperadmin ? (
        <section className="card settingsSection">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>OpenAI Key (Global)</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Stored key: {hasOpenAiApiKey ? "yes" : "no"}
            {openaiApiKeyMasked ? ` · ${openaiApiKeyMasked}` : ""}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : "never"}
          </div>
          {envOverride ? (
            <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 10 }}>
              ENV `AI_API_KEY` is still set. Remove it from `.env.prod` if you want DB-only key handling.
            </div>
          ) : null}
          <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>New OpenAI API key</span>
            <input
              className="input"
              type="password"
              placeholder="sk-proj-..."
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btnPrimary" onClick={() => void saveOpenAiKey()}>
              Save OpenAI key
            </button>
            <button className="btn btnStop" onClick={() => void clearOpenAiKey()} disabled={!hasOpenAiApiKey}>
              Remove stored key
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
