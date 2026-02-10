"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiPost } from "../../lib/api";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);

  async function requestResetCode() {
    setStatus("sending code...");
    setError("");
    setDevCode(null);
    try {
      const payload = await apiPost<{ devCode?: string; expiresInMinutes?: number }>(
        "/auth/password-reset/request",
        { email }
      );
      setStatus(
        `If the account exists, a reset code was sent${payload?.expiresInMinutes ? ` (valid ${payload.expiresInMinutes} min)` : ""}.`
      );
      if (payload?.devCode) setDevCode(payload.devCode);
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  async function confirmResetPassword() {
    setStatus("updating password...");
    setError("");
    if (newPassword !== confirmPassword) {
      setStatus("");
      setError("New password and confirmation do not match.");
      return;
    }
    try {
      await apiPost("/auth/password-reset/confirm", {
        email,
        code,
        newPassword
      });
      setStatus("Password updated. Redirecting to login...");
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        router.push("/login");
      }, 1000);
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>Reset Password</h1>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            Account email
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" type="button" disabled={!email} onClick={() => void requestResetCode()}>
              Send reset code
            </button>
          </div>
          <label style={{ fontSize: 13 }}>
            Reset code (6 digits)
            <input
              className="input"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              maxLength={6}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            New password
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="at least 8 characters"
              minLength={8}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Confirm new password
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="repeat new password"
              minLength={8}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btnPrimary"
              type="button"
              disabled={!email || code.length !== 6 || newPassword.length < 8}
              onClick={() => void confirmResetPassword()}
            >
              Set new password
            </button>
            <Link href="/login" className="btn">
              Back to login
            </Link>
          </div>
          {status ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{status}</div> : null}
          {devCode ? (
            <div style={{ fontSize: 12, color: "#facc15" }}>
              Dev reset code: <b>{devCode}</b>
            </div>
          ) : null}
          {error ? <div style={{ fontSize: 12, color: "#ef4444" }}>{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
