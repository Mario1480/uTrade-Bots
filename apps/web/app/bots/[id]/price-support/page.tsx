"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiGet, apiPost, apiPut } from "../../../../lib/api";

type PriceSupportConfig = {
  enabled: boolean;
  active: boolean;
  floorPrice: number | null;
  budgetUsdt: number;
  spentUsdt: number;
  maxOrderUsdt: number;
  cooldownMs: number;
  mode: "PASSIVE" | "MIXED";
  stoppedReason?: string | null;
};

export default function PriceSupportPage() {
  const params = useParams();
  const id = params.id as string;

  const [bot, setBot] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [config, setConfig] = useState<PriceSupportConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "error" | "success"; msg: string } | null>(null);

  function showToast(type: "error" | "success", msg: string) {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 3000);
  }

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  async function loadAll() {
    try {
      const [b, meRes] = await Promise.all([apiGet<any>(`/bots/${id}`), apiGet<any>("/auth/me")]);
      setBot(b);
      setMe(meRes);
      const ps = b.priceSupportConfig ?? null;
      setConfig(ps);
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  useEffect(() => {
    if (!id) return;
    loadAll();
  }, [id]);

  const featureEnabled = Boolean(me?.features?.priceSupport);
  const canManage = Boolean(me?.permissions?.["trading.price_support"] || me?.isSuperadmin);
  const remaining = useMemo(() => {
    if (!config) return 0;
    return Math.max(0, (config.budgetUsdt || 0) - (config.spentUsdt || 0));
  }, [config]);

  async function save() {
    if (!config || !bot) return;
    try {
      setSaving(true);
      await apiPut(`/bots/${id}/config`, {
        mm: bot.mmConfig,
        vol: bot.volConfig,
        risk: bot.riskConfig,
        notify: bot.notificationConfig ?? { fundsWarnEnabled: true, fundsWarnPct: 0.1 },
        priceSupport: {
          enabled: config.enabled,
          floorPrice: config.floorPrice,
          budgetUsdt: config.budgetUsdt,
          maxOrderUsdt: config.maxOrderUsdt,
          cooldownMs: config.cooldownMs,
          mode: config.mode
        }
      });
      showToast("success", "Price Support saved");
      await loadAll();
    } catch (e) {
      showToast("error", errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function restartSupport() {
    try {
      await apiPost(`/bots/${id}/price-support/restart`);
      showToast("success", "Price Support restarted");
      await loadAll();
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  if (!featureEnabled) {
    return (
      <div>
        <div className="dashboardHeader">
          <div>
            <h2 style={{ margin: 0 }}>Price Support</h2>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Floor defense is disabled for this workspace.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href={`/bots/${id}`} className="btn">Back to overview</Link>
            <Link href={`/bots/${id}/settings`} className="btn">Bot Settings</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!canManage) {
    return (
      <div>
        <h2 style={{ margin: 0, textAlign: "center" }}>Price Support</h2>
        <div style={{ marginBottom: 10, marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/bots/${id}`} className="btn">
            ← Back to overview
          </Link>
          <Link href={`/bots/${id}/settings`} className="btn">
            Bot Settings
          </Link>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Price Support is disabled for your role.
          </div>
        </div>
      </div>
    );
  }

  if (!config) {
    return <div>Loading…</div>;
  }

  const status = !config.enabled ? "OFF" : config.active ? "ON" : "STOPPED";

  return (
    <div>
      <h2 style={{ margin: 0, textAlign: "center" }}>Price Support</h2>
      <div style={{ marginBottom: 10, marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={`/bots/${id}`} className="btn">
          ← Back to overview
        </Link>
        <Link href={`/bots/${id}/settings`} className="btn">
          Bot Settings
        </Link>
      </div>

      <details className="card" style={{ padding: 12, marginBottom: 16 }} open>
        <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: 10 }}>
          Floor defense controls and budget
        </summary>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <span className={`badge ${status === "ON" ? "badgeOk" : status === "STOPPED" ? "badgeWarn" : ""}`}>
            {status}
          </span>
          {config.stoppedReason ? (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{config.stoppedReason}</span>
          ) : null}
        </div>

        <label className="fieldRow">
          <span style={{ fontSize: 13 }}>Enable Price Support</span>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          />
        </label>

        <div className="gridTwoCol" style={{ marginTop: 8 }}>
          <Field
            label="Floor price (USDT)"
            hint="Support buys start below this price"
            value={config.floorPrice ?? ""}
            onChange={(v) => setConfig({ ...config, floorPrice: v ? Number(v) : null })}
          />
          <Field
            label="Budget (USDT)"
            hint="Total budget for support buys"
            value={config.budgetUsdt}
            onChange={(v) => setConfig({ ...config, budgetUsdt: Number(v) })}
          />
          <Field
            label="Max order (USDT)"
            hint="Cap per support order"
            value={config.maxOrderUsdt}
            onChange={(v) => setConfig({ ...config, maxOrderUsdt: Number(v) })}
          />
          <Field
            label="Cooldown (ms)"
            hint="Minimum delay between support actions"
            value={config.cooldownMs}
            onChange={(v) => setConfig({ ...config, cooldownMs: Number(v) })}
          />
          <SelectField
            label="Mode"
            hint="PASSIVE = post-only, MIXED = more aggressive"
            value={config.mode}
            options={[
              { label: "Passive", value: "PASSIVE" },
              { label: "Mixed", value: "MIXED" }
            ]}
            onChange={(v) => setConfig({ ...config, mode: v as "PASSIVE" | "MIXED" })}
          />
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
          Spent: {config.spentUsdt.toFixed(4)} USDT · Remaining: {remaining.toFixed(4)} USDT
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btnPrimary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          {config.enabled && !config.active ? (
            <button className="btn" onClick={restartSupport}>
              Restart Price Support
            </button>
          ) : null}
        </div>
      </details>

      {toast ? (
        <div className={`toast ${toast.type === "error" ? "toastError" : "toastSuccess"}`}>{toast.msg}</div>
      ) : null}
    </div>
  );
}

function Field(props: {
  label: string;
  hint?: string;
  value: any;
  onChange: (v: string) => void;
}) {
  return (
    <label className="fieldRow">
      <span style={{ fontSize: 13 }}>
        {props.label}
        {props.hint ? <span style={{ display: "block", fontSize: 11, opacity: 0.7 }}>{props.hint}</span> : null}
      </span>
      <input
        className="input"
        inputMode="decimal"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  hint?: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="fieldRow">
      <span style={{ fontSize: 13 }}>
        {props.label}
        {props.hint ? <span style={{ display: "block", fontSize: 11, opacity: 0.7 }}>{props.hint}</span> : null}
      </span>
      <select className="input" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
