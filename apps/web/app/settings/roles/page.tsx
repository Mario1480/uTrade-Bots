"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ReauthDialog from "../../components/ReauthDialog";
import { ApiError, apiGet, apiPost, apiPut, apiDel } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

const PERMISSIONS = [
  { key: "bots.view", labelKey: "botsView" },
  { key: "bots.create", labelKey: "botsCreate" },
  { key: "bots.edit_config", labelKey: "botsEditConfig" },
  { key: "bots.start_pause_stop", labelKey: "botsStartPauseStop" },
  { key: "bots.delete", labelKey: "botsDelete" },
  { key: "trading.manual_limit", labelKey: "tradingManualLimit" },
  { key: "trading.manual_market", labelKey: "tradingManualMarket" },
  { key: "trading.price_support", labelKey: "tradingPriceSupport" },
  { key: "exchange_keys.view_present", labelKey: "exchangeKeysViewPresent" },
  { key: "exchange_keys.edit", labelKey: "exchangeKeysEdit" },
  { key: "risk.edit", labelKey: "riskEdit" },
  { key: "presets.view", labelKey: "presetsView" },
  { key: "presets.create", labelKey: "presetsCreate" },
  { key: "presets.apply", labelKey: "presetsApply" },
  { key: "presets.delete", labelKey: "presetsDelete" },
  { key: "users.manage_members", labelKey: "usersManageMembers" },
  { key: "users.manage_roles", labelKey: "usersManageRoles" },
  { key: "settings.security", labelKey: "settingsSecurity" },
  { key: "audit.view", labelKey: "auditView" }
];

export default function RolesPage() {
  const t = useTranslations("settings.roles");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
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
      setError(t("messages.reauthRequired"));
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
      const sortedRoles = sortRoles(rolesRes);
      setRoles(sortedRoles);
      if (!inviteRoleId && sortedRoles.length) setInviteRoleId(sortedRoles[0].id);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const canManage = Boolean(me?.permissions?.["users.manage_roles"] || me?.isSuperadmin);
  const canManageMembers = Boolean(me?.permissions?.["users.manage_members"] || me?.isSuperadmin);

  function sortRoles(list: any[]) {
    const order = new Map([
      ["Admin", 0],
      ["Operator 1", 1],
      ["Operator 2", 2],
      ["Viewer", 3]
    ]);
    return [...list].sort((a, b) => {
      const aRank = order.has(a.name) ? order.get(a.name) : 99;
      const bRank = order.has(b.name) ? order.get(b.name) : 99;
      if (aRank !== bRank) return aRank - bRank;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function handleMemberReauthError(e: any, retry: () => Promise<void>) {
    if (isReauthError(e)) {
      setMemberError(t("messages.reauthRequiredMembers"));
      requireReauth(retry);
      return true;
    }
    return false;
  }

  async function invite() {
    if (!inviteEmail || !inviteRoleId || !me?.workspaceId) return;
    setMemberStatus(t("messages.inviting"));
    setMemberError("");
    try {
      await apiPost(`/workspaces/${me.workspaceId}/members/invite`, {
        email: inviteEmail,
        roleId: inviteRoleId,
        resetPassword: inviteResetPassword
      });
      setInviteEmail("");
      setInviteResetPassword(false);
      setMemberStatus(t("messages.invited"));
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
    if (!confirm(t("confirm.removeMember"))) return;
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
    setStatus(t("messages.creating"));
    setError("");
    try {
      const role = await apiPost(`/workspaces/${me.workspaceId}/roles`, { name: newRoleName, permissions: {} });
      setRoles((prev) => [...prev, role]);
      setNewRoleName("");
      setStatus(t("messages.created"));
      setTimeout(() => setStatus(""), 1200);
    } catch (e) {
      setStatus("");
      if (!handleReauthError(e, createRole)) {
        setError(errMsg(e));
      }
    }
  }

  async function deleteRole(roleId: string) {
    if (!confirm(t("confirm.deleteRole"))) return;
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
        <Link href={withLocalePath("/settings", locale)} className="btn">← {tCommon("backToSettings")}</Link>
        <Link href={withLocalePath("/", locale)} className="btn">← {tCommon("backToDashboard")}</Link>
      </div>
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("members.title")}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          {t("members.description")}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {members.length ? (
            members.map((m) => (
              <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 600 }}>{m.email}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{m.status}</div>
                </div>
                {["admin@utrade.vip", "admin@uliquid.vip"].includes(String(m.email ?? "").toLowerCase()) ? (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("members.superadmin")}</div>
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
                      {t("members.remove")}
                    </button>
                  </>
                )}
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("members.empty")}</div>
          )}
        </div>
        {canManageMembers ? (
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>{t("members.inviteTitle")}</div>
            <input
              className="input"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={t("members.invitePlaceholder")}
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
              {t("members.inviteResetPassword")}
            </label>
            <button className="btn btnPrimary" onClick={invite} disabled={!inviteEmail || !inviteRoleId}>
              {t("members.invite")}
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            {t("members.noPermission")}
          </div>
        )}
        {memberStatus ? <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>{memberStatus}</div> : null}
        {memberError ? <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 8 }}>{memberError}</div> : null}
      </div>
      {!canManage ? (
        <div className="card" style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>
          {t("roles.noPermission")}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        {roles.map((role) => (
          <details key={role.id} className="card" style={{ padding: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: 10 }}>
              {role.name}
            </summary>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ maxWidth: 220 }}
                value={role.name}
                disabled={!canManage || role.isSystem}
                onChange={(e) => renameRole(role.id, e.target.value)}
              />
              {role.isSystem ? (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("roles.systemRole")}</span>
              ) : (
                <button className="btn btnStop" disabled={!canManage} onClick={() => deleteRole(role.id)}>
                  {t("roles.delete")}
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
                  {t(`permissions.${p.labelKey}`)}
                </label>
              ))}
            </div>
          </details>
        ))}
      </div>

      {canManage ? (
        <div className="card" style={{ padding: 12, marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("roles.createTitle")}</div>
          <input
            className="input"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder={t("roles.namePlaceholder")}
          />
          <button className="btn btnPrimary" style={{ marginTop: 8 }} onClick={createRole}>
            {t("roles.create")}
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
