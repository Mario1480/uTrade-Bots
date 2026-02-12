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

type ApiKeyHealthResponse = {
  ok: boolean;
  status: "ok" | "missing_key" | "error";
  source: "env" | "db" | "none";
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  message: string;
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
  const [healthLoading, setHealthLoading] = useState(false);
  const [health, setHealth] = useState<ApiKeyHealthResponse | null>(null);

  async function loadHealthStatus() {
    setHealthLoading(true);
    try {
      const res = await apiGet<ApiKeyHealthResponse>("/admin/settings/api-keys/status");
      setHealth(res);
    } catch (e) {
      setHealth({
        ok: false,
        status: "error",
        source: "none",
        checkedAt: new Date().toISOString(),
        message: errMsg(e)
      });
    } finally {
      setHealthLoading(false);
    }
  }

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
      await loadHealthStatus();
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
      await loadHealthStatus();
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
      await loadHealthStatus();
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <span
              className={`badge ${
                health?.status === "ok"
                  ? "badgeOk"
                  : health?.status === "missing_key"
                    ? "badgeWarn"
                    : "badgeDanger"
              }`}
              title={health?.message ?? "Status not checked yet."}
            >
              OpenAI status:{" "}
              {healthLoading
                ? "checking..."
                : health?.status === "ok"
                  ? "OK"
                  : health?.status === "missing_key"
                    ? "missing key"
                    : "error"}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Source: {health?.source ?? (envOverride ? "env" : hasOpenAiApiKey ? "db" : "none")}
              {typeof health?.latencyMs === "number" ? ` · ${health.latencyMs}ms` : ""}
              {health?.checkedAt ? ` · checked ${new Date(health.checkedAt).toLocaleString()}` : ""}
            </span>
            <button className="btn" type="button" onClick={() => void loadHealthStatus()} disabled={healthLoading}>
              {healthLoading ? "Checking..." : "Refresh status"}
            </button>
          </div>
          {health?.message ? (
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              {health.message}
            </div>
          ) : null}
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
