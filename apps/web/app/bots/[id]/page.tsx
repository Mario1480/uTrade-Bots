"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../lib/api";

type BotDetail = {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  status: string;
  exchangeAccount?: {
    id: string;
    exchange: string;
    label: string;
  } | null;
  futuresConfig?: {
    strategyKey: string;
    marginMode: string;
    leverage: number;
    tickMs: number;
    testnet: boolean;
  } | null;
  runtime?: {
    status: string;
    reason: string | null;
    updatedAt: string;
  } | null;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function BotDetailsPage() {
  const t = useTranslations("system.botsDetails");
  const params = useParams();
  const id = params.id as string;

  const [bot, setBot] = useState<BotDetail | null>(null);
  const [runtime, setRuntime] = useState<{ status: string; reason: string | null; updatedAt: string } | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | "" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [b, r] = await Promise.all([
        apiGet<BotDetail>(`/bots/${id}`),
        apiGet<{ status: string; reason: string | null; updatedAt: string }>(`/bots/${id}/runtime`).catch(() => null)
      ]);
      setBot(b);
      setRuntime(r);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  useEffect(() => {
    if (!id) return;
    void load();
    const timer = setInterval(() => {
      void load();
    }, 2500);
    return () => clearInterval(timer);
  }, [id]);

  async function startBot() {
    setBusy("start");
    setError(null);
    try {
      await apiPost(`/bots/${id}/start`, {});
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy("");
    }
  }

  async function stopBot() {
    setBusy("stop");
    setError(null);
    try {
      await apiPost(`/bots/${id}/stop`, {});
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy("");
    }
  }

  if (!bot) {
    return (
      <div className="card" style={{ padding: 14 }}>
        {error ? `${t("loadError")}: ${error}` : t("loading")}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>{bot.name}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{bot.exchange} · {bot.symbol}</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/" className="btn">{t("actions.back")}</Link>
          <button className="btn btnPrimary" onClick={startBot} disabled={busy === "start" || bot.status === "running"}>
            {busy === "start" ? t("actions.starting") : t("actions.start")}
          </button>
          <button className="btn" onClick={stopBot} disabled={busy === "stop" || bot.status === "stopped"}>
            {busy === "stop" ? t("actions.stopping") : t("actions.stop")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <InfoRow label={t("fields.botStatus")} value={bot.status} />
          <InfoRow label={t("fields.exchangeAccount")} value={bot.exchangeAccount?.label ?? "-"} />
          <InfoRow label={t("fields.runnerStatus")} value={runtime?.status ?? t("na")} />
          <InfoRow label={t("fields.runtimeReason")} value={runtime?.reason ?? "-"} />
          <InfoRow label={t("fields.runtimeUpdated")} value={runtime?.updatedAt ? new Date(runtime.updatedAt).toLocaleString() : "-"} />
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>{t("futuresConfigTitle")}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <InfoRow label={t("fields.strategy")} value={bot.futuresConfig?.strategyKey ?? "-"} />
          <InfoRow label={t("fields.marginMode")} value={bot.futuresConfig?.marginMode ?? "-"} />
          <InfoRow label={t("fields.leverage")} value={bot.futuresConfig?.leverage ?? "-"} />
          <InfoRow label={t("fields.tickInterval")} value={bot.futuresConfig?.tickMs ? `${bot.futuresConfig.tickMs} ms` : "-"} />
          <InfoRow label={t("fields.testnet")} value={String(bot.futuresConfig?.testnet ?? false)} />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card" style={{ padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 14 }}>{String(value)}</div>
    </div>
  );
}
