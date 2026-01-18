"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReauthDialog from "../../components/ReauthDialog";
import { ApiError, apiGet, apiPost, apiPut, apiDel } from "../../../lib/api";

const PERMISSIONS = [
  { key: "bots.view", label: "View bots" },
  { key: "bots.create", label: "Create bots" },
  { key: "bots.edit_config", label: "Edit configs" },
  { key: "bots.start_pause_stop", label: "Start/pause/stop" },
  { key: "bots.delete", label: "Delete bots" },
  { key: "trading.manual_limit", label: "Manual limit trades" },
  { key: "trading.manual_market", label: "Manual market trades" },
  { key: "trading.price_support", label: "Price support" },
  { key: "exchange_keys.view_present", label: "View keys configured" },
  { key: "exchange_keys.edit", label: "Edit exchange keys" },
  { key: "risk.edit", label: "Edit risk" },
  { key: "users.manage_members", label: "Manage members" },
  { key: "users.manage_roles", label: "Manage roles" },
  { key: "settings.security", label: "Security settings" },
  { key: "audit.view", label: "View audit log" }
];

export default function RolesPage() {
  const [me, setMe] = useState<any>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  function isReauthError(e: any) {
    return e instanceof ApiError && e.status === 401 && e.payload?.error === "REAUTH_REQUIRED";
  }

  function requireReauth(next: () => Promise<void>) {
    setPendingAction(() => next);
    setReauthOpen(true);
  }

  function handleReauthError(e: any, retry: () => Promise<void>) {
    if (isReauthError(e)) {
      setError("Re-auth required to manage roles.");
      requireReauth(retry);
      return true;
    }
    return false;
  }

  async function handleReauthVerified() {
    if (pendingAction) {
      const action = pendingAction;
      setPendingAction(null);
      await action();
    }
  }

  async function load() {
    try {
      const meRes = await apiGet<any>("/auth/me");
      setMe(meRes);
      const rolesRes = await apiGet<any[]>(`/workspaces/${meRes.workspaceId}/roles`);
      setRoles(rolesRes);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const canManage = Boolean(me?.permissions?.["users.manage_roles"] || me?.isSuperadmin);

  async function togglePerm(roleId: string, key: string, next: boolean) {
    setError("");
    try {
      const role = roles.find((r) => r.id === roleId);
      const nextPerms = { ...(role?.permissions ?? {}), [key]: next };
      await apiPut(`/workspaces/${me.workspaceId}/roles/${roleId}`, { permissions: nextPerms });
      setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, permissions: nextPerms } : r)));
    } catch (e) {
      if (!handleReauthError(e, () => togglePerm(roleId, key, next))) {
        setError(errMsg(e));
      }
    }
  }

  async function renameRole(roleId: string, name: string) {
    setError("");
    try {
      await apiPut(`/workspaces/${me.workspaceId}/roles/${roleId}`, { name });
      setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, name } : r)));
    } catch (e) {
      if (!handleReauthError(e, () => renameRole(roleId, name))) {
        setError(errMsg(e));
      }
    }
  }

  async function createRole() {
    if (!newRoleName) return;
    setStatus("creating...");
    setError("");
    try {
      const role = await apiPost(`/workspaces/${me.workspaceId}/roles`, { name: newRoleName, permissions: {} });
      setRoles((prev) => [...prev, role]);
      setNewRoleName("");
      setStatus("created");
      setTimeout(() => setStatus(""), 1200);
    } catch (e) {
      setStatus("");
      if (!handleReauthError(e, createRole)) {
        setError(errMsg(e));
      }
    }
  }

  async function deleteRole(roleId: string) {
    if (!confirm("Delete this role?")) return;
    setError("");
    try {
      await apiDel(`/workspaces/${me.workspaceId}/roles/${roleId}`);
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
    } catch (e) {
      if (!handleReauthError(e, () => deleteRole(roleId))) {
        setError(errMsg(e));
      }
    }
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/settings" className="btn">← Back to settings</Link>
        <Link href="/" className="btn">← Back to dashboard</Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Roles</h2>
      {!canManage ? (
        <div className="card" style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>
          You don’t have permission to manage roles.
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        {roles.map((role) => (
          <div key={role.id} className="card" style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ maxWidth: 220 }}
                value={role.name}
                disabled={!canManage || role.isSystem}
                onChange={(e) => renameRole(role.id, e.target.value)}
              />
              {role.isSystem ? (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>System role</span>
              ) : (
                <button className="btn btnStop" disabled={!canManage} onClick={() => deleteRole(role.id)}>
                  Delete
                </button>
              )}
            </div>
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {PERMISSIONS.map((p) => (
                <label key={p.key} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(role.permissions?.[p.key])}
                    disabled={!canManage}
                    onChange={(e) => togglePerm(role.id, p.key, e.target.checked)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {canManage ? (
        <div className="card" style={{ padding: 12, marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Create role</div>
          <input
            className="input"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="Role name"
          />
          <button className="btn btnPrimary" style={{ marginTop: 8 }} onClick={createRole}>
            Create role
          </button>
          {status ? <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{status}</div> : null}
        </div>
      ) : null}

      <ReauthDialog
        open={reauthOpen}
        onClose={() => {
          setReauthOpen(false);
          setPendingAction(null);
        }}
        onVerified={handleReauthVerified}
      />

      {error ? <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 10 }}>{error}</div> : null}
    </div>
  );
}
