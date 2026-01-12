"use client";

import Link from "next/link";
import { useState } from "react";
import { apiPost } from "../../../lib/api";

export default function Setup() {
  const [msg, setMsg] = useState("");

  async function create() {
    setMsg("creating...");
    try {
      await apiPost("/bots", {
        id: "local-bot-1",
        name: "USHARK MM",
        symbol: "USHARK_USDT",
        exchange: "bitmart"
      });
      setMsg("created local-bot-1. Go back to Bots.");
    } catch (e: any) {
      setMsg(String(e));
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/settings" className="btn">
          ← Back to settings
        </Link>
        <Link href="/" className="btn">
          ← Back to dashboard
        </Link>
      </div>
      <h2>Setup</h2>
      <button onClick={create} className="btn btnPrimary">
        Create default bot (local-bot-1)
      </button>
      <p>{msg}</p>
    </div>
  );
}
