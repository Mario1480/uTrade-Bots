"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPut } from "../../../lib/api";

type GlobalSetting = {
  key: string;
  value: unknown;
};

export default function GlobalDefaultsPage() {
  const [me, setMe] = useState<any>(null);
  const [settings, setSettings] = useState<GlobalSetting[]>([]);
  const [key, setKey] = useState("default");
  const [value, setValue] = useState("{}");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  async function load() {
    try {
      const meRes = await apiGet<any>("/auth/me");
      setMe(meRes);
      const data = await apiGet<any[]>("/global-settings");
      setSettings(data);
      if (data.length) {
        setKey(data[0].key);
        setValue(JSON.stringify(data[0].value ?? {}, null, 2));
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setStatus("saving...");
    setError("");
    try {
      const parsed = JSON.parse(value || "{}");
      const res = await apiPut(`/global-settings/${encodeURIComponent(key)}`, { value: parsed });
      setStatus("saved");
      setTimeout(() => setStatus(""), 1200);
      setSettings((prev) => {
        const next = prev.filter((s) => s.key !== res.key);
        return [...next, res];
      });
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  const allowed = Boolean(me?.isSuperadmin);

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/settings" className="btn">← Back to settings</Link>
        <Link href="/" className="btn">← Back to dashboard</Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Global Defaults</h2>
      {!allowed ? (
        <div className="card" style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>
          Superadmin only.
        </div>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 13 }}>
              Key
              <input className="input" value={key} onChange={(e) => setKey(e.target.value)} />
            </label>
            <label style={{ fontSize: 13 }}>
              JSON Value
              <textarea
                className="input"
                style={{ minHeight: 160 }}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <button className="btn btnPrimary" onClick={save}>Save</button>
            {status ? <div style={{ fontSize: 12, opacity: 0.7 }}>{status}</div> : null}
          </div>
        </div>
      )}
      {error ? <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 10 }}>{error}</div> : null}
    </div>
  );
}
