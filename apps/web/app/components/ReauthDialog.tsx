"use client";

import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPost } from "../../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  onVerified: () => Promise<void> | void;
};

export default function ReauthDialog({ open, onClose, onVerified }: Props) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [password, setPassword] = useState("");
  const [otpEnabled, setOtpEnabled] = useState(true);

  useEffect(() => {
    if (!open) {
      setCode("");
      setStatus("");
      setError("");
      setSending(false);
      setVerifying(false);
      setPassword("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    apiGet<{ reauthOtpEnabled?: boolean }>("/settings/security")
      .then((data) => setOtpEnabled(data.reauthOtpEnabled !== false))
      .catch(() => setOtpEnabled(true));
  }, [open]);

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  async function sendCode() {
    setSending(true);
    setStatus("sending...");
    setError("");
    try {
      await apiPost("/auth/reauth/request-otp");
      setStatus("code sent");
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    } finally {
      setSending(false);
    }
  }

  async function verify() {
    setVerifying(true);
    setStatus("verifying...");
    setError("");
    try {
      if (otpEnabled) {
        await apiPost("/auth/reauth/verify-otp", { code });
      } else {
        await apiPost("/auth/reauth", { password });
      }
      await onVerified();
      onClose();
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    } finally {
      setVerifying(false);
    }
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50
      }}
    >
      <div className="card" style={{ padding: 16, width: 360, maxWidth: "92vw" }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Re-auth required</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 12 }}>
          {otpEnabled
            ? "Send a 6-digit code to your email and enter it here."
            : "Confirm your password to continue."}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {otpEnabled ? (
            <>
              <button className="btn" onClick={sendCode} disabled={sending}>
                {sending ? "Sending..." : "Send code"}
              </button>
              <input
                className="input"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                inputMode="numeric"
              />
            </>
          ) : (
            <input
              className="input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <button
            className="btn btnPrimary"
            onClick={verify}
            disabled={verifying || (otpEnabled ? code.trim().length !== 6 : password.length < 6)}
          >
            {verifying ? "Verifying..." : "Verify"}
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {status ? <div style={{ fontSize: 12, opacity: 0.8 }}>{status}</div> : null}
          {error ? <div style={{ fontSize: 12, color: "var(--danger)" }}>{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
