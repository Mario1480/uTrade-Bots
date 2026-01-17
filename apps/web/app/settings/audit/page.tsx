"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet } from "../../../lib/api";

export default function AuditPage() {
  const [me, setMe] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  async function load() {
    try {
      const meRes = await apiGet<any>("/auth/me");
      setMe(meRes);
      const data = await apiGet<any[]>(`/workspaces/${meRes.workspaceId}/audit?limit=100`);
      setItems(data);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const allowed = Boolean(me?.permissions?.["audit.view"] || me?.isSuperadmin);

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/settings" className="btn">← Back to settings</Link>
        <Link href="/" className="btn">← Back to dashboard</Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Audit Log</h2>
      {!allowed ? (
        <div className="card" style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>
          You don’t have permission to view audit logs.
        </div>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          {items.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No audit events yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {items.map((item) => (
                <div key={item.id} className="card" style={{ padding: 8 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{item.createdAt}</div>
                  <div style={{ fontWeight: 700 }}>{item.action}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {item.entityType} {item.entityId ?? ""}
                  </div>
                  {item.meta ? (
                    <pre style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(item.meta, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {error ? <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 10 }}>{error}</div> : null}
    </div>
  );
}
