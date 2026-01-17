"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";

export default function UsersPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [me, setMe] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [permError, setPermError] = useState("");
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  async function loadUsers() {
    try {
      const [meRes, usersRes] = await Promise.all([
        apiGet<any>("/auth/me"),
        apiGet<any[]>("/settings/users")
      ]);
      setMe(meRes);
      setUsers(usersRes);
    } catch (e) {
      setPermError(errMsg(e));
    }
  }

  async function setManualTrading(userId: string, next: boolean) {
    setSavingUserId(userId);
    setPermError("");
    try {
      await apiPut(`/settings/users/${userId}/permissions`, {
        allowManualTrading: next
      });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, allowManualTrading: next } : u)));
    } catch (e) {
      setPermError(errMsg(e));
    } finally {
      setSavingUserId(null);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function save() {
    setStatus("saving...");
    setError("");
    if (newPassword !== confirmPassword) {
      setStatus("");
      setError("Passwords do not match.");
      return;
    }
    try {
      await apiPost("/auth/change-password", {
        currentPassword,
        newPassword
      });
      setStatus("updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setStatus(""), 1200);
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
        <Link href="/" className="btn">
          ← Back to dashboard
        </Link>
      </div>
      <h2 style={{ marginTop: 0 }}>Users</h2>
      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Manual trading permissions</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          Allow specific users to place manual orders from the bot overview.
        </div>
        {users.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {users.map((u) => (
              <label
                key={u.id}
                style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(u.allowManualTrading)}
                  disabled={me?.role !== "owner" || savingUserId === u.id}
                  onChange={(e) => setManualTrading(u.id, e.target.checked)}
                />
                <span style={{ fontWeight: 600 }}>{u.email}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{u.role}</span>
              </label>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>No users found.</div>
        )}
        {me?.role !== "owner" ? (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            Only workspace owners can change permissions.
          </div>
        ) : null}
        {permError ? <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 8 }}>{permError}</div> : null}
      </div>
      <div className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Change password</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          Set a new password for your account.
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontSize: 13 }}>
            Current password
            <input
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            New password
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Confirm new password
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btnPrimary" onClick={save} disabled={!currentPassword || !newPassword}>
              Update password
            </button>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{status}</span>
          </div>
          {error ? <div style={{ fontSize: 12, color: "#ff6b6b" }}>{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
