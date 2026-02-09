"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, apiPost } from "../../lib/api";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("creating account...");
    setError("");
    try {
      await apiPost("/auth/register", { email, password });
      router.push("/");
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>Create Account</h1>
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
              placeholder="at least 8 characters"
              minLength={8}
              required
            />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btnPrimary" type="submit" disabled={!email || password.length < 8}>
              Register
            </button>
            <Link href="/login" className="btn">
              Back to login
            </Link>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{status}</span>
          </div>
          {error ? <div style={{ fontSize: 12, color: "#ef4444" }}>{error}</div> : null}
        </form>
      </div>
    </div>
  );
}
