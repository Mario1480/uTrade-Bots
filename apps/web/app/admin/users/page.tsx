"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type AdminUser = {
  id: string;
  email: string;
  isSuperadmin: boolean;
  hasAdminBackendAccess: boolean;
  createdAt: string;
  updatedAt: string;
  sessions: number;
  exchangeAccounts: number;
  bots: number;
  workspaceMemberships: number;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminUsersPage() {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetPassword, setResetPassword] = useState<Record<string, string>>({});

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      setCurrentUserId(typeof me?.id === "string" ? me.id : null);
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsSuperadmin(false);
        setError(t("messages.accessRequired"));
        setUsers([]);
        return;
      }
      setIsSuperadmin(true);
      const res = await apiGet<{ items: AdminUser[] }>("/admin/users");
      setUsers(res.items ?? []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.email.toLowerCase().includes(q));
  }, [users, query]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await apiPost<any>("/admin/users", {
        email: newEmail,
        password: newPassword.trim() || undefined
      });
      setNewEmail("");
      setNewPassword("");
      setNotice(
        res.temporaryPassword
          ? t("messages.userCreatedWithPassword", { password: res.temporaryPassword })
          : t("messages.userCreated")
      );
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function updateUserPassword(userId: string) {
    const value = (resetPassword[userId] ?? "").trim();
    if (!value) return;
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/admin/users/${userId}/password`, { password: value });
      setResetPassword((prev) => ({ ...prev, [userId]: "" }));
      setNotice(t("messages.passwordUpdated"));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function deleteUser(user: AdminUser) {
    if (!confirm(t("confirmDelete", { email: user.email }))) return;
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/admin/users/${user.id}`);
      setNotice(t("messages.deleted", { email: user.email }));
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function updateAdminBackendAccess(user: AdminUser, enabled: boolean) {
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/admin/users/${user.id}/admin-access`, { enabled });
      setUsers((prev) =>
        prev.map((entry) =>
          entry.id === user.id
            ? { ...entry, hasAdminBackendAccess: enabled || entry.isSuperadmin }
            : entry
        )
      );
      setNotice(
        enabled
          ? t("messages.adminAccessGranted", { email: user.email })
          : t("messages.adminAccessRevoked", { email: user.email })
      );
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href={withLocalePath("/admin", locale)} className="btn">
          ← {tCommon("backToAdmin")}
        </Link>
        <Link href={withLocalePath("/settings", locale)} className="btn">
          ← {tCommon("backToSettings")}
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="adminPageIntro">
        {t("subtitle")}
      </div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
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
              <h3 style={{ margin: 0 }}>{t("createUserTitle")}</h3>
            </div>
            <form onSubmit={createUser} className="settingsFormGrid">
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("email")}</span>
                <input className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("temporaryPassword")}</span>
                <input className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </label>
              <button className="btn btnPrimary" type="submit">
                {t("createUser")}
              </button>
            </form>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("userListTitle")}</h3>
            </div>
            <label className="settingsField" style={{ marginBottom: 12 }}>
              <span className="settingsFieldLabel">{t("searchUser")}</span>
              <input
                className="input"
                placeholder={t("searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div style={{ display: "grid", gap: 8 }}>
              {filtered.map((user) => (
                <div key={user.id} className="card settingsSection adminUserCard">
                  <div className="adminUserHead">
                    <div>
                  <div style={{ fontWeight: 700 }}>
                        {user.email} {user.isSuperadmin ? `· ${t("superadmin")}` : ""}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {t("stats", {
                          bots: user.bots,
                          accounts: user.exchangeAccounts,
                          sessions: user.sessions
                        })}
                      </div>
                      <label className="inlineCheck" style={{ marginTop: 8 }}>
                        <input
                          type="checkbox"
                          checked={user.hasAdminBackendAccess}
                          disabled={user.isSuperadmin}
                          onChange={(e) => void updateAdminBackendAccess(user, e.target.checked)}
                        />
                        {t("adminBackendAccess")}
                      </label>
                    </div>
                    <div className="adminUserActions">
                      <input
                        className="input adminUserPasswordInput"
                        placeholder={t("newPassword")}
                        value={resetPassword[user.id] ?? ""}
                        onChange={(e) =>
                          setResetPassword((prev) => ({ ...prev, [user.id]: e.target.value }))
                        }
                      />
                      <button className="btn" onClick={() => void updateUserPassword(user.id)}>
                        {t("setPassword")}
                      </button>
                      <button
                        className="btn btnStop"
                        disabled={user.isSuperadmin || user.id === currentUserId}
                        onClick={() => void deleteUser(user)}
                      >
                        {t("delete")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {filtered.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("noUsers")}</div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
