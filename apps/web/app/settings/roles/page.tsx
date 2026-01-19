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
  { key: "presets.view", label: "View presets" },
  { key: "presets.create", label: "Create presets" },
  { key: "presets.apply", label: "Apply presets" },
  { key: "presets.delete", label: "Delete presets" },
  { key: "users.manage_members", label: "Manage members" },
  { key: "users.manage_roles", label: "Manage roles" },
  { key: "settings.security", label: "Security settings" },
  { key: "audit.view", label: "View audit log" }
];

export default function RolesPage() {
  const [me, setMe] = useState<any>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [inviteResetPassword, setInviteResetPassword] = useState(false);
  const [memberStatus, setMemberStatus] = useState("");
  const [memberError, setMemberError] = useState("");
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
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
      setError("Re-auth required.");
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
      const [membersRes, rolesRes] = await Promise.all([
        apiGet<any[]>(`/workspaces/${meRes.workspaceId}/members`),
        apiGet<any[]>(`/workspaces/${meRes.workspaceId}/roles`)
      ]);
      setMembers(membersRes);
      setRoles(rolesRes);
      if (!inviteRoleId && rolesRes.length) setInviteRoleId(rolesRes[0].id);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const canManage = Boolean(me?.permissions?.["users.manage_roles"] || me?.isSuperadmin);
  const canManageMembers = Boolean(me?.permissions?.["users.manage_members"] || me?.isSuperadmin);

  function handleMemberReauthError(e: any, retry: () => Promise<void>) {
    if (isReauthError(e)) {
      setMemberError("Re-auth required to manage members.");
      requireReauth(retry);
      return true;
    }
    return false;
  }

  async function invite() {
    if (!inviteEmail || !inviteRoleId || !me?.workspaceId) return;
    setMemberStatus("inviting...");
    setMemberError("");
    try {
      await apiPost(`/workspaces/${me.workspaceId}/members/invite`, {
        email: inviteEmail,
        roleId: inviteRoleId,
        resetPassword: inviteResetPassword
      });
      setInviteEmail("");
      setInviteResetPassword(false);
      setMemberStatus("invited");
      await load();
      setTimeout(() => setMemberStatus(""), 1200);
    } catch (e) {
      setMemberStatus("");
      if (!handleMemberReauthError(e, invite)) {
        setMemberError(errMsg(e));
      }
    }
  }

  async function updateMember(memberId: string, roleId: string) {
    if (!me?.workspaceId) return;
    setSavingMemberId(memberId);
    setMemberError("");
    try {
      await apiPut(`/workspaces/${me.workspaceId}/members/${memberId}`, { roleId });
      await load();
    } catch (e) {
      if (!handleMemberReauthError(e, () => updateMember(memberId, roleId))) {
        setMemberError(errMsg(e));
      }
    } finally {
      setSavingMemberId(null);
    }
  }

  async function removeMember(memberId: string) {
    if (!me?.workspaceId) return;
    if (!confirm("Remove member from workspace?")) return;
    setSavingMemberId(memberId);
    setMemberError("");
    try {
      await apiDel(`/workspaces/${me.workspaceId}/members/${memberId}`);
      await load();
    } catch (e) {
      if (!handleMemberReauthError(e, () => removeMember(memberId))) {
        setMemberError(errMsg(e));
      }
    } finally {
      setSavingMemberId(null);
    }
  }

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
      <h2 style={{ marginTop: 0 }}>Members & Roles</h2>
      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Workspace members</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          Invite users and assign roles for this workspace.
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {members.length ? (
            members.map((m) => (
              <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 600 }}>{m.email}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{m.status}</div>
                </div>
                {m.email?.toLowerCase() === "admin@uliquid.vip" ? (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Superadmin</div>
                ) : (
                  <>
                    <select
                      className="input"
                      style={{ maxWidth: 220 }}
                      disabled={!canManageMembers || savingMemberId === m.id}
                      value={m.roleId}
                      onChange={(e) => updateMember(m.id, e.target.value)}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btnStop"
                      onClick={() => removeMember(m.id)}
                      disabled={!canManageMembers || savingMemberId === m.id}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No members yet.</div>
          )}
        </div>
        {canManageMembers ? (
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Invite member</div>
            <input
              className="input"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@domain.com"
            />
            <select
              className="input"
              value={inviteRoleId}
              onChange={(e) => setInviteRoleId(e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
              <input
                type="checkbox"
                checked={inviteResetPassword}
                onChange={(e) => setInviteResetPassword(e.target.checked)}
              />
              Reset password and include a temporary password in the email
            </label>
            <button className="btn btnPrimary" onClick={invite} disabled={!inviteEmail || !inviteRoleId}>
              Invite
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            You don’t have permission to manage members.
          </div>
        )}
        {memberStatus ? <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>{memberStatus}</div> : null}
        {memberError ? <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 8 }}>{memberError}</div> : null}
      </div>
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
