"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";

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

  if (!config) {
    return <div>Loading…</div>;
  }

  const status = !config.enabled ? "OFF" : config.active ? "ON" : "STOPPED";

  return (
    <div>
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>Price Support</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Floor defense controls and budget.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/bots/${id}`} className="btn">Back to overview</Link>
          <Link href={`/bots/${id}/settings`} className="btn">Bot Settings</Link>
        </div>
      </div>

      <div className="card" style={{ padding: 16, maxWidth: 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className={`badge ${status === "ON" ? "badgeOk" : status === "STOPPED" ? "badgeWarn" : ""}`}>
            {status}
          </span>
          {config.stoppedReason ? (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{config.stoppedReason}</span>
          ) : null}
        </div>

        <div className="formRow" style={{ marginTop: 14 }}>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />
            <span className="slider" />
          </label>
          <span style={{ fontSize: 13 }}>Enable Price Support</span>
        </div>

        <div className="formGrid" style={{ marginTop: 14 }}>
          <div className="formField">
            <label>Floor price (USDT)</label>
            <input
              value={config.floorPrice ?? ""}
              onChange={(e) => setConfig({ ...config, floorPrice: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <div className="formField">
            <label>Budget (USDT)</label>
            <input
              value={config.budgetUsdt}
              onChange={(e) => setConfig({ ...config, budgetUsdt: Number(e.target.value) })}
            />
          </div>
          <div className="formField">
            <label>Max order (USDT)</label>
            <input
              value={config.maxOrderUsdt}
              onChange={(e) => setConfig({ ...config, maxOrderUsdt: Number(e.target.value) })}
            />
          </div>
          <div className="formField">
            <label>Cooldown (ms)</label>
            <input
              value={config.cooldownMs}
              onChange={(e) => setConfig({ ...config, cooldownMs: Number(e.target.value) })}
            />
          </div>
          <div className="formField">
            <label>Mode</label>
            <select
              value={config.mode}
              onChange={(e) => setConfig({ ...config, mode: e.target.value as "PASSIVE" | "MIXED" })}
            >
              <option value="PASSIVE">PASSIVE</option>
              <option value="MIXED">MIXED</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14, fontSize: 13, color: "var(--muted)" }}>
          Spent: {config.spentUsdt.toFixed(4)} USDT · Remaining: {remaining.toFixed(4)} USDT
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btnPrimary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          {config.enabled && !config.active ? (
            <button className="btn" onClick={restartSupport}>
              Restart Price Support
            </button>
          ) : null}
        </div>
      </div>

      {toast ? (
        <div className={`toast ${toast.type === "error" ? "toastError" : "toastSuccess"}`}>{toast.msg}</div>
      ) : null}
    </div>
  );
}
