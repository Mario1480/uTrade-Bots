"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPut } from "../../../lib/api";

type SubscriptionStatus = {
  configured: boolean;
  licenseKeyMasked: string | null;
  instanceId: string | null;
  status: string | null;
  validUntil: string | null;
  limits: {
    includedBots: number;
    addOnBots: number;
    includedCex: number;
    addOnCex: number;
  } | null;
  features: {
    priceSupport: boolean;
    priceFollow: boolean;
    aiRecommendations: boolean;
  } | null;
  overrides: {
    manual: boolean;
    unlimited: boolean;
    note?: string;
  } | null;
  usage?: {
    bots: number;
    cex: number;
  } | null;
  checkedAt: string | null;
  error: { code: string; status?: number; message?: string } | null;
  source: "db" | "env" | "none";
};

export default function SubscriptionPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);

  function errMsg(e: any): string {
    if (e instanceof ApiError) {
      const detail = e.payload?.details ? ` — ${e.payload.details}` : "";
      return `${e.message}${detail} (HTTP ${e.status})`;
    }
    return e?.message ? String(e.message) : String(e);
  }

  async function loadStatus() {
    setLoading(true);
    try {
      const data = await apiGet<SubscriptionStatus>("/settings/subscription");
      setStatus(data);
      setInstanceId(data.instanceId ?? "");
      setLicenseKey("");
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        licenseKey: licenseKey.trim(),
        instanceId: instanceId.trim()
      };
      const res = await apiPut<SubscriptionStatus>("/settings/subscription", payload);
      setStatus(res);
      setLicenseKey("");
      setMsg("Saved and verified.");
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadStatus();
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
      <h2 style={{ marginTop: 0 }}>Subscription</h2>
      <div className="card" style={{ padding: 12, fontSize: 13 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>License status</div>
        {loading ? (
          <div style={{ color: "var(--muted)" }}>Loading...</div>
        ) : status ? (
          <div style={{ display: "grid", gap: 6 }}>
            <div>
              <b>Status:</b>{" "}
              {status.status ?? (status.configured ? "UNKNOWN" : "NOT CONFIGURED")}
            </div>
            <div>
              <b>Valid until:</b> {status.validUntil ?? "—"}
            </div>
            <div>
              <b>Checked at:</b> {status.checkedAt ?? "—"}
            </div>
            <div>
              <b>Source:</b> {status.source}
            </div>
            {status.error ? (
              <div style={{ color: "var(--warn)" }}>
                Error: {status.error.code}
                {status.error.status ? ` (HTTP ${status.error.status})` : ""}
                {status.error.message ? ` — ${status.error.message}` : ""}
              </div>
            ) : null}
            {status.limits ? (
              <div>
                <b>Limits:</b> bots {status.limits.includedBots + status.limits.addOnBots}
                {", "}cex {status.limits.includedCex + status.limits.addOnCex}
              </div>
            ) : null}
            {status.usage ? (
              <div>
                <b>Usage:</b> bots {status.usage.bots}
                {status.limits ? ` / ${status.limits.includedBots + status.limits.addOnBots}` : ""}
                {", "}cex {status.usage.cex}
                {status.limits ? ` / ${status.limits.includedCex + status.limits.addOnCex}` : ""}
              </div>
            ) : null}
            {status.features ? (
              <div>
                <b>Features:</b>{" "}
                {`priceSupport=${status.features.priceSupport ? "on" : "off"}, `}
                {`priceFollow=${status.features.priceFollow ? "on" : "off"}, `}
                {`ai=${status.features.aiRecommendations ? "on" : "off"}`}
              </div>
            ) : null}
            {status.overrides ? (
              <div>
                <b>Overrides:</b>{" "}
                {`manual=${status.overrides.manual ? "on" : "off"}, `}
                {`unlimited=${status.overrides.unlimited ? "on" : "off"}`}
                {status.overrides.note ? ` — ${status.overrides.note}` : ""}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card" style={{ padding: 12, fontSize: 13, marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>License configuration</div>
        <div style={{ color: "var(--muted)", marginBottom: 10 }}>
          License changes are picked up automatically by the runner during the next verification cycle.
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>License key</span>
            <input
              className="input"
              placeholder={status?.licenseKeyMasked ? `Current: ${status.licenseKeyMasked}` : "UUID"}
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Instance ID</span>
            <input
              className="input"
              placeholder="vps-123"
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button className="btn btnPrimary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save & verify"}
          </button>
          <button className="btn" onClick={loadStatus} disabled={loading}>
            Refresh status
          </button>
        </div>
        {msg ? <div style={{ marginTop: 10, color: "var(--muted)" }}>{msg}</div> : null}
      </div>
    </div>
  );
}
