"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";

type AdminUser = {
  id: string;
  email: string;
  isSuperadmin: boolean;
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
      if (!me?.isSuperadmin) {
        setIsSuperadmin(false);
        setError("Superadmin access required.");
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
          ? `User created. Temporary password: ${res.temporaryPassword}`
          : "User created."
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
      setNotice("Password updated and sessions revoked.");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function deleteUser(user: AdminUser) {
    if (!confirm(`Delete user ${user.email}? This cannot be undone.`)) return;
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/admin/users/${user.id}`);
      setNotice(`Deleted ${user.email}.`);
      await loadAll();
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
      <h2 style={{ marginTop: 0 }}>Admin · Users</h2>
      <div className="adminPageIntro">
        Manage users, credentials and account access.
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
              <h3 style={{ margin: 0 }}>Create User</h3>
            </div>
            <form onSubmit={createUser} className="settingsFormGrid">
              <label className="settingsField">
                <span className="settingsFieldLabel">Email</span>
                <input className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">Temporary password (optional)</span>
                <input className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </label>
              <button className="btn btnPrimary" type="submit">
                Create user
              </button>
            </form>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>User List</h3>
            </div>
            <label className="settingsField" style={{ marginBottom: 12 }}>
              <span className="settingsFieldLabel">Search user</span>
              <input
                className="input"
                placeholder="Filter by email..."
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
                        {user.email} {user.isSuperadmin ? "· superadmin" : ""}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        Bots: {user.bots} · Accounts: {user.exchangeAccounts} · Sessions: {user.sessions}
                      </div>
                    </div>
                    <div className="adminUserActions">
                      <input
                        className="input adminUserPasswordInput"
                        placeholder="New password"
                        value={resetPassword[user.id] ?? ""}
                        onChange={(e) =>
                          setResetPassword((prev) => ({ ...prev, [user.id]: e.target.value }))
                        }
                      />
                      <button className="btn" onClick={() => void updateUserPassword(user.id)}>
                        Set password
                      </button>
                      <button
                        className="btn btnStop"
                        disabled={user.isSuperadmin || user.id === currentUserId}
                        onClick={() => void deleteUser(user)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {filtered.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>No users match the filter.</div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
