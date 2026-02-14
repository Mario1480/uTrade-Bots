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
  fmpApiKeyMasked: string | null;
  hasFmpApiKey: boolean;
  updatedAt: string | null;
  envOverride: boolean;
  envOverrideFmp: boolean;
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
  const [fmpApiKey, setFmpApiKey] = useState("");
  const [fmpApiKeyMasked, setFmpApiKeyMasked] = useState<string | null>(null);
  const [hasFmpApiKey, setHasFmpApiKey] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [envOverride, setEnvOverride] = useState(false);
  const [envOverrideFmp, setEnvOverrideFmp] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [health, setHealth] = useState<ApiKeyHealthResponse | null>(null);
  const [fmpHealthLoading, setFmpHealthLoading] = useState(false);
  const [fmpHealth, setFmpHealth] = useState<ApiKeyHealthResponse | null>(null);

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

  async function loadFmpHealthStatus() {
    setFmpHealthLoading(true);
    try {
      const res = await apiGet<ApiKeyHealthResponse>("/admin/settings/api-keys/fmp-status");
      setFmpHealth(res);
    } catch (e) {
      setFmpHealth({
        ok: false,
        status: "error",
        source: "none",
        checkedAt: new Date().toISOString(),
        message: errMsg(e)
      });
    } finally {
      setFmpHealthLoading(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsSuperadmin(false);
        setError("Admin backend access required.");
        return;
      }
      setIsSuperadmin(true);

      const res = await apiGet<ApiKeysSettingsResponse>("/admin/settings/api-keys");
      setOpenaiApiKeyMasked(res.openaiApiKeyMasked ?? null);
      setHasOpenAiApiKey(Boolean(res.hasOpenAiApiKey));
      setFmpApiKeyMasked(res.fmpApiKeyMasked ?? null);
      setHasFmpApiKey(Boolean(res.hasFmpApiKey));
      setUpdatedAt(res.updatedAt ?? null);
      setEnvOverride(Boolean(res.envOverride));
      setEnvOverrideFmp(Boolean(res.envOverrideFmp));
      setOpenaiApiKey("");
      setFmpApiKey("");
      await loadHealthStatus();
      await loadFmpHealthStatus();
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
      setFmpApiKeyMasked(res.fmpApiKeyMasked ?? null);
      setHasFmpApiKey(Boolean(res.hasFmpApiKey));
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
      setFmpApiKeyMasked(res.fmpApiKeyMasked ?? null);
      setHasFmpApiKey(Boolean(res.hasFmpApiKey));
      setUpdatedAt(res.updatedAt ?? null);
      setNotice("OpenAI API key removed.");
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function saveFmpKey() {
    const trimmed = fmpApiKey.trim();
    if (!trimmed) {
      setError("Please enter an FMP API key.");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        fmpApiKey: trimmed,
        clearFmpApiKey: false
      });
      setFmpApiKey("");
      setOpenaiApiKeyMasked(res.openaiApiKeyMasked ?? null);
      setHasOpenAiApiKey(Boolean(res.hasOpenAiApiKey));
      setFmpApiKeyMasked(res.fmpApiKeyMasked ?? null);
      setHasFmpApiKey(Boolean(res.hasFmpApiKey));
      setUpdatedAt(res.updatedAt ?? null);
      setNotice("FMP API key saved.");
      await loadFmpHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function clearFmpKey() {
    const confirmed = window.confirm("Remove the stored FMP API key?");
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        clearFmpApiKey: true
      });
      setFmpApiKey("");
      setOpenaiApiKeyMasked(res.openaiApiKeyMasked ?? null);
      setHasOpenAiApiKey(Boolean(res.hasOpenAiApiKey));
      setFmpApiKeyMasked(res.fmpApiKeyMasked ?? null);
      setHasFmpApiKey(Boolean(res.hasFmpApiKey));
      setUpdatedAt(res.updatedAt ?? null);
      setNotice("FMP API key removed.");
      await loadFmpHealthStatus();
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
      <h2 style={{ marginTop: 0 }}>Admin · API Keys</h2>
      <div className="adminPageIntro">
        Manage encrypted provider keys and run availability checks.
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
        <>
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

          <section className="card settingsSection">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>FMP Key (Economic Calendar)</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Stored key: {hasFmpApiKey ? "yes" : "no"}
            {fmpApiKeyMasked ? ` · ${fmpApiKeyMasked}` : ""}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : "never"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <span
              className={`badge ${
                fmpHealth?.status === "ok"
                  ? "badgeOk"
                  : fmpHealth?.status === "missing_key"
                    ? "badgeWarn"
                    : "badgeDanger"
              }`}
              title={fmpHealth?.message ?? "Status not checked yet."}
            >
              FMP status:{" "}
              {fmpHealthLoading
                ? "checking..."
                : fmpHealth?.status === "ok"
                  ? "OK"
                  : fmpHealth?.status === "missing_key"
                    ? "missing key"
                    : "error"}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Source: {fmpHealth?.source ?? (envOverrideFmp ? "env" : hasFmpApiKey ? "db" : "none")}
              {typeof fmpHealth?.latencyMs === "number" ? ` · ${fmpHealth.latencyMs}ms` : ""}
              {fmpHealth?.checkedAt ? ` · checked ${new Date(fmpHealth.checkedAt).toLocaleString()}` : ""}
            </span>
            <button className="btn" type="button" onClick={() => void loadFmpHealthStatus()} disabled={fmpHealthLoading}>
              {fmpHealthLoading ? "Checking..." : "Refresh status"}
            </button>
          </div>
          {fmpHealth?.message ? (
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              {fmpHealth.message}
            </div>
          ) : null}
          {envOverrideFmp ? (
            <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 10 }}>
              ENV `FMP_API_KEY` is still set. Remove it from `.env.prod` if you want DB-only key handling.
            </div>
          ) : null}
          <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>New FMP API key</span>
            <input
              className="input"
              type="password"
              placeholder="fmp_..."
              value={fmpApiKey}
              onChange={(e) => setFmpApiKey(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btnPrimary" onClick={() => void saveFmpKey()}>
              Save FMP key
            </button>
            <button className="btn btnStop" onClick={() => void clearFmpKey()} disabled={!hasFmpApiKey}>
              Remove stored key
            </button>
          </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
