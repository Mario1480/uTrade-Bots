"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiPost } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("signing in...");
    setError("");
    try {
      await apiPost("/auth/login", { email, password });
      router.push("/");
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <img src="/images/logo.png" alt="uLiquid logo" style={{ width: 52, height: 52 }} />
        <div style={{ fontSize: 24, fontWeight: 700 }}>uLiquid</div>
      </div>
      <h1 style={{ marginTop: 0 }}>Login</h1>
      <div className="card" style={{ padding: 16 }}>
        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            Email
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Password
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, lineHeight: 1.4 }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 2 }}
              required
            />
            <span>
              I have read and agree to{" "}
              <button
                type="button"
                onClick={() => setShowAgreement(true)}
                style={{
                  background: "none",
                  border: 0,
                  padding: 0,
                  color: "inherit",
                  textDecoration: "underline",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                uLiquid Market Making Agreement Terms
              </button>
              .
            </span>
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btnPrimary" type="submit" disabled={!email || !password || !agreed}>
              Sign in
            </button>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{status}</span>
          </div>
          {error && <div style={{ fontSize: 12, color: "#ff6b6b" }}>{error}</div>}
        </form>
      </div>
      {showAgreement && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="uLiquid Market Making Agreement"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => setShowAgreement(false)}
        >
          <div
            className="card"
            style={{ width: "min(720px, 100%)", maxHeight: "80vh", padding: 18, overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ fontWeight: 700 }}>uLiquid Market Making Agreement</div>
              <button className="btn btnGhost" type="button" onClick={() => setShowAgreement(false)}>
                Close
              </button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 12 }}>
              <p>
                uLiquid shall not be liable for any loss of funds incurred by the Customer, nor for any
                indirect, special, incidental, or consequential damages of any kind, regardless of the form of
                action, whether in contract, tort (including negligence), strict liability, or otherwise, even
                if uLiquid has been advised of the possibility of such damages.
              </p>
              <p>
                In the event that the Customer intentionally fails or refuses to pay uLiquid’s agreed fees and
                accumulates outstanding payments exceeding a period of two (2) months, uLiquid reserves the
                right to take any lawful and necessary actions to recover the outstanding debt from the
                Customer.
              </p>
              <p>
                The Customer acknowledges and agrees that all payments made to uLiquid are strictly
                non-refundable. This non-refundable policy applies without exception, including but not
                limited to cases involving the closure, suspension, delisting, or operational interruption of
                any exchange, trading venue, or platform.
              </p>
              <p>
                Once a payment has been made, the Customer is deemed to have accepted the non-refundable
                nature of the transaction. uLiquid assumes no responsibility or liability for any financial
                losses, damages, or missed opportunities resulting from the closure, suspension, or
                unavailability of any exchange or platform.
              </p>
              <p>
                The Customer acknowledges that cryptocurrency trading, market making, and automated trading
                involve significant risk and volatility. Past performance is not indicative of future results,
                and uLiquid does not guarantee profitability, volume targets, or exchange rankings.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
