"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, apiGet } from "../../lib/api";
import { Suspense, useEffect, useState } from "react";

type BotItem = {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  exchangeAccountId?: string | null;
  status: "running" | "stopped" | "error" | string;
  lastError?: string | null;
  exchangeAccount?: {
    id: string;
    exchange: string;
    label: string;
  } | null;
  runtime?: {
    lastHeartbeatAt?: string | null;
    lastError?: string | null;
    reason?: string | null;
  } | null;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function BotsPageContent() {
  const searchParams = useSearchParams();
  const [bots, setBots] = useState<BotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const exchangeAccountId = searchParams.get("exchangeAccountId");
  const statusFilter = searchParams.get("status");

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiGet<BotItem[]>("/bots");
        if (!mounted) return;
        setBots(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!mounted) return;
        setError(errMsg(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();
    const timer = setInterval(() => {
      void load();
    }, 6000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const visibleBots = useMemo(() => {
    return bots.filter((bot) => {
      if (exchangeAccountId && bot.exchangeAccountId !== exchangeAccountId) return false;
      if (statusFilter && bot.status !== statusFilter) return false;
      return true;
    });
  }, [bots, exchangeAccountId, statusFilter]);

  const titleSuffix = useMemo(() => {
    if (!exchangeAccountId) return "";
    return ` for account ${exchangeAccountId.slice(0, 8)}…`;
  }, [exchangeAccountId]);

  return (
    <div>
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>Bots{titleSuffix}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {statusFilter ? `Status filter: ${statusFilter}` : "All bot statuses"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/dashboard" className="btn">Dashboard</Link>
          <Link href="/bots/new" className="btn btnPrimary">New Bot</Link>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          <strong>Load error:</strong> {error}
        </div>
      ) : null}

      <div className="botGrid">
        {loading ? (
          <div className="card" style={{ padding: 16 }}>Loading bots…</div>
        ) : visibleBots.length === 0 ? (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>No bots match this filter</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
              Try another account/status filter or create a new bot.
            </div>
            <Link href="/bots/new" className="btn btnPrimary">Create Bot</Link>
          </div>
        ) : (
          visibleBots.map((bot) => (
            <article key={bot.id} className="card botCard">
              <div className="botCardHeader">
                <div>
                  <div className="botName">{bot.name}</div>
                  <div className="botMeta">
                    {bot.exchangeAccount?.label ?? "No Account"} · {bot.exchange} · {bot.symbol}
                  </div>
                </div>
                <span className={`badge ${bot.status === "running" ? "badgeOk" : bot.status === "error" ? "badgeDanger" : "badgeWarn"}`}>
                  {bot.status}
                </span>
              </div>

              {bot.lastError || bot.runtime?.lastError ? (
                <div style={{ marginTop: 10, fontSize: 12, color: "#fecaca" }}>
                  {bot.lastError ?? bot.runtime?.lastError}
                </div>
              ) : null}

              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link href={`/bots/${bot.id}`} className="btn">Open</Link>
                {bot.exchangeAccountId ? (
                  <Link href={`/trade?exchangeAccountId=${encodeURIComponent(bot.exchangeAccountId)}`} className="btn">
                    Manual Trading
                  </Link>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

export default function BotsPage() {
  return (
    <Suspense fallback={<div>Loading bots page…</div>}>
      <BotsPageContent />
    </Suspense>
  );
}
