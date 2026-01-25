"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import ReauthDialog from "../../components/ReauthDialog";
import { useSystemSettings } from "../../components/SystemBanner";
import { ApiError, apiDel, apiGet, apiPost } from "../../../lib/api";

type Order = {
  id: string;
  side: string;
  price: number;
  qty: number;
  clientOrderId?: string | null;
  createdAt?: string | null;
};

type AlertItem = {
  id: string;
  level: string;
  title: string;
  message?: string | null;
  createdAt: string;
};

export default function BotOverviewPage() {
  const params = useParams();
  const id = params.id as string;

  const [bot, setBot] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [rt, setRt] = useState<any>(null);
  const [orders, setOrders] = useState<{ mm: Order[]; vol: Order[]; other: Order[] } | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [toast, setToast] = useState<{ type: "error" | "success"; msg: string } | null>(null);
  const [manualType, setManualType] = useState<"LIMIT" | "MARKET">("LIMIT");
  const [manualSide, setManualSide] = useState<"buy" | "sell">("buy");
  const [manualQty, setManualQty] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualSpend, setManualSpend] = useState("");
  const [manualPostOnly, setManualPostOnly] = useState(true);
  const [manualConfirm, setManualConfirm] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualCancelId, setManualCancelId] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const systemSettings = useSystemSettings();
  const isReadOnly = systemSettings.readOnlyMode;
  const priceFollowLabel = bot?.priceFollowEnabled
    ? `${bot.priceSourceExchange || bot.exchange} · ${bot.priceSourceSymbol || bot.symbol}`
    : null;
  const feedUpdatedAt = rt?.updatedAt ? new Date(rt.updatedAt as string) : null;
  const feedAgeSec = feedUpdatedAt ? Math.max(0, (Date.now() - feedUpdatedAt.getTime()) / 1000) : null;
  const feedStale = Boolean(bot?.priceFollowEnabled && rt?.reason === "MASTER_FEED_STALE");

  function showToast(type: "error" | "success", msg: string) {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 3000);
  }

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  function isReauthError(e: any) {
    return e instanceof ApiError && e.status === 401 && e.payload?.error === "REAUTH_REQUIRED";
  }

  function requireReauth(next: () => Promise<void>) {
    setPendingAction(() => next);
    setReauthOpen(true);
  }

  async function handleReauthVerified() {
    if (pendingAction) {
      const action = pendingAction;
      setPendingAction(null);
      await action();
    }
  }

  async function loadBot() {
    try {
      const b = await apiGet<any>(`/bots/${id}`);
      setBot(b);
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  async function loadMe() {
    try {
      const meRes = await apiGet<any>("/auth/me");
      setMe(meRes);
    } catch {
      // ignore
    }
  }

  async function loadRuntime() {
    try {
      const r = await apiGet<any>(`/bots/${id}/runtime`);
      setRt(r);
    } catch (e) {
      if (!rt) showToast("error", errMsg(e));
    }
  }

  async function loadOrders() {
    try {
      const o = await apiGet<any>(`/bots/${id}/open-orders`);
      setOrders(o);
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  async function loadAlerts() {
    try {
      const a = await apiGet<AlertItem[]>(`/bots/${id}/alerts?limit=10`);
      setAlerts(a);
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  async function clearAlerts() {
    try {
      await apiDel(`/bots/${id}/alerts`);
      showToast("success", "Alerts cleared");
      await loadAlerts();
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  useEffect(() => {
    if (!id) return;
    loadBot();
    loadMe();
    loadRuntime();
    loadOrders();
    loadAlerts();
    const t1 = setInterval(loadRuntime, 1200);
    const t2 = setInterval(loadOrders, 4000);
    const t3 = setInterval(loadAlerts, 5000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
    };
  }, [id]);

  async function submitManual() {
    setManualError(null);
    const canLimit = Boolean(me?.permissions?.["trading.manual_limit"] || me?.isSuperadmin);
    const canMarket = Boolean(me?.permissions?.["trading.manual_market"] || me?.isSuperadmin);
    if (manualType === "LIMIT" && !canLimit) {
      setManualError("Manual limit trading disabled.");
      showToast("error", "Manual limit trading disabled.");
      return;
    }
    if (manualType === "MARKET" && !canMarket) {
      setManualError("Manual market trading disabled.");
      showToast("error", "Manual market trading disabled.");
      return;
    }
    setManualBusy(true);
    try {
      if (manualType === "LIMIT") {
        const price = Number(manualPrice);
        const qty = Number(manualQty);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
          setManualError("Enter a valid price and quantity.");
          showToast("error", "Enter a valid price and quantity.");
          return;
        }
        await apiPost(`/bots/${id}/manual/limit`, {
          side: manualSide,
          price,
          quantity: qty,
          postOnly: manualPostOnly,
          timeInForce: "GTC"
        });
        showToast("success", "Limit order submitted");
      } else {
        if (!manualConfirm) {
          setManualError("Confirm market order first.");
          showToast("error", "Confirm market order first.");
          return;
        }
        if (manualSide === "buy") {
          const spend = Number(manualSpend);
          if (!Number.isFinite(spend) || spend <= 0) {
            setManualError("Enter a valid spend amount.");
            showToast("error", "Enter a valid spend amount.");
            return;
          }
          await apiPost(`/bots/${id}/manual/market`, {
            side: manualSide,
            quoteNotionalUsdt: spend
          });
        } else {
          const qty = Number(manualQty);
          if (!Number.isFinite(qty) || qty <= 0) {
            setManualError("Enter a valid quantity.");
            showToast("error", "Enter a valid quantity.");
            return;
          }
          await apiPost(`/bots/${id}/manual/market`, {
            side: manualSide,
            quantity: qty
          });
        }
        showToast("success", "Market order submitted");
      }
    } catch (e) {
      if (isReauthError(e)) {
        setManualError("Re-auth required for manual trades.");
        showToast("error", "Re-auth required for manual trades.");
        requireReauth(submitManual);
        return;
      }
      setManualError(errMsg(e));
      showToast("error", errMsg(e));
    } finally {
      setManualBusy(false);
    }
  }

  async function startMm() {
    try {
      await apiPost(`/bots/${id}/mm/start`);
      showToast("success", "Market Making started");
      await loadBot();
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  async function stopMm() {
    try {
      await apiPost(`/bots/${id}/mm/stop`);
      showToast("success", "Market Making stopped");
      await loadBot();
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  async function startVol() {
    try {
      await apiPost(`/bots/${id}/vol/start`);
      showToast("success", "Volume bot started");
      await loadBot();
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  async function stopVol() {
    try {
      await apiPost(`/bots/${id}/vol/stop`);
      showToast("success", "Volume bot stopped");
      await loadBot();
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  async function cancelManual(orderId: string) {
    if (!canManualLimit) {
      showToast("error", "Manual limit trading disabled.");
      return;
    }
    setManualCancelId(orderId);
    try {
      await apiPost(`/bots/${id}/manual/cancel`, { orderId });
      showToast("success", "Manual order cancelled");
      await loadOrders();
    } catch (e) {
      if (isReauthError(e)) {
        setManualCancelId(null);
        requireReauth(() => cancelManual(orderId));
        return;
      }
      showToast("error", errMsg(e));
    } finally {
      setManualCancelId(null);
    }
  }

  const openAll = useMemo(() => {
    if (!orders) return [];
    return [...orders.mm, ...orders.vol, ...orders.other];
  }, [orders]);

  const canManualLimit = Boolean(me?.permissions?.["trading.manual_limit"] || me?.isSuperadmin);
  const canManualMarket = Boolean(me?.permissions?.["trading.manual_market"] || me?.isSuperadmin);
  const manualOrders = useMemo(() => {
    if (!orders) return [];
    return orders.other.filter((o) => (o.clientOrderId ?? "").startsWith("man_"));
  }, [orders]);

  const baseSymbol = useMemo(() => {
    const raw = bot?.symbol ? String(bot.symbol) : "";
    return raw.split(/[/_-]/)[0] || "Base";
  }, [bot]);

  const asks = useMemo(() => {
    return openAll
      .filter((o) => o.side === "sell")
      .sort((a, b) => Number(a.price) - Number(b.price));
  }, [openAll]);

  const bids = useMemo(() => {
    return openAll
      .filter((o) => o.side === "buy")
      .sort((a, b) => Number(b.price) - Number(a.price));
  }, [openAll]);

  if (!bot) return <div>Loading…</div>;
  const ps = bot.priceSupportConfig;
  const psStatus = !ps?.enabled ? "OFF" : ps.active ? "ON" : "STOPPED";
  const psRemaining = ps ? Math.max(0, (ps.budgetUsdt || 0) - (ps.spentUsdt || 0)) : null;

  return (
    <div>
      <h2 style={{ margin: 0, textAlign: "center" }}>Overview</h2>
      <div style={{ marginBottom: 10, marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/" className="btn">
          ← Back to dashboard
        </Link>
        <Link href={`/bots/${id}/settings`} className="btn">
          Settings →
        </Link>
      </div>

      {toast ? (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            border: toast.type === "error" ? "1px solid #ef4444" : "1px solid var(--brand)",
            background: toast.type === "error" ? "rgba(239,68,68,0.12)" : "rgba(20,129,192,0.16)",
            color: "#e8eef7",
            fontSize: 13
          }}
        >
          <b style={{ marginRight: 8 }}>{toast.type === "error" ? "Error" : "OK"}</b>
          {toast.msg}
        </div>
      ) : null}

      <ReauthDialog
        open={reauthOpen}
        onClose={() => {
          setReauthOpen(false);
          setPendingAction(null);
        }}
        onVerified={handleReauthVerified}
      />

      <div className="adminHeader" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{bot.name}</h2>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {bot.exchange} · {bot.symbol}
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Bot status: <b>{bot.status}</b>
            {rt?.status ? (
              <>
                {" "}
                · Runtime: <b>{rt.status}</b>
                {rt.reason ? <span style={{ color: "var(--muted)" }}> — {rt.reason}</span> : null}
              </>
            ) : null}
            {ps ? (
              <>
                {" "}
                · Price Support: <b>{psStatus}</b>
                {psStatus !== "OFF" && psRemaining !== null ? (
                  <span style={{ color: "var(--muted)" }}> — {psRemaining.toFixed(4)} USDT left</span>
                ) : null}
              </>
            ) : null}
            {priceFollowLabel ? (
              <>
                {" "}
                · Price Follow: <b>{priceFollowLabel}</b>
                <span style={{ marginLeft: 8, fontSize: 11, color: feedStale ? "#fca5a5" : "var(--muted)" }}>
                  {feedStale ? "STALE" : "OK"}
                  {feedAgeSec !== null ? ` · ${Math.round(feedAgeSec)}s` : ""}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="card" style={{ padding: 10, minWidth: 260 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Strategy controls (MM and Volume run independently)
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12 }}>Market Making</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className={`btn btnStart ${bot.mmEnabled || isReadOnly ? "btnDisabled" : ""}`}
                  onClick={startMm}
                  disabled={bot.mmEnabled || isReadOnly}
                >
                  Start
                </button>
                <button
                  className={`btn btnStop ${!bot.mmEnabled || isReadOnly ? "btnDisabled" : ""}`}
                  onClick={stopMm}
                  disabled={!bot.mmEnabled || isReadOnly}
                >
                  Stop
                </button>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12 }}>Volume Bot</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className={`btn btnStart ${bot.volEnabled || isReadOnly ? "btnDisabled" : ""}`}
                  onClick={startVol}
                  disabled={bot.volEnabled || isReadOnly}
                >
                  Start
                </button>
                <button
                  className={`btn btnStop ${!bot.volEnabled || isReadOnly ? "btnDisabled" : ""}`}
                  onClick={stopVol}
                  disabled={!bot.volEnabled || isReadOnly}
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="overviewGrid">
        <section className="card" style={{ padding: 12, overflow: "hidden" }}>
          <h3 style={{ marginTop: 0 }}>Budget</h3>
          <div className="gridTwoCol">
            <div className="card" style={{ padding: 10 }}>
              <div className="adminMeta">Free {baseSymbol}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{rt?.freeBase ?? "—"}</div>
              <div className="adminMeta" style={{ marginTop: 6 }}>Required {baseSymbol}</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{bot.mmConfig?.budgetBaseToken ?? "—"}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="adminMeta">Free USDT</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{rt?.freeUsdt ?? "—"}</div>
              <div className="adminMeta" style={{ marginTop: 6 }}>Required USDT</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{bot.mmConfig?.budgetQuoteUsdt ?? "—"}</div>
            </div>
          </div>
        </section>

        <section className="card" style={{ padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Live Runtime</h3>
          <div className="gridTwoCol" style={{ "--grid-gap": "8px" } as CSSProperties}>
            <Kv k="Mid price" v={rt?.mid} />
            <Kv k="Best bid" v={rt?.bid} />
            <Kv k="Best ask" v={rt?.ask} />
            <Kv k="Open orders (total)" v={rt?.openOrders} />
            <Kv k="Open orders (MM)" v={rt?.openOrdersMm} />
            <Kv k="Open orders (Volume)" v={rt?.openOrdersVol} />
            <Kv k="Traded notional today" v={rt?.tradedNotionalToday} />
            <Kv k="Updated at" v={formatUpdated(rt?.updatedAt)} />
          </div>
          {rt && me?.isSuperadmin ? (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer" }}>Raw runtime JSON</summary>
              <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{JSON.stringify(rt, null, 2)}</pre>
            </details>
          ) : null}
        </section>
      </div>

      <div className="overviewGrid" style={{ marginTop: 16 }}>
        <section className="card" style={{ padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Live Orders</h3>
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
            Mid: {rt?.mid ?? "—"}
          </div>
          <div
            className="gridTwoCol"
          >
            <OrderTable title="Asks" rows={asks} accent="#ef4444" />
            <OrderTable title="Bids" rows={bids} accent="#22c55e" />
          </div>
          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: "8px 0 6px 0" }}>Manual Limit Orders</h4>
            {manualOrders.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>No manual limit orders.</div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {manualOrders.map((o) => (
                  <div
                    key={o.id}
                    className="card"
                    style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div style={{ width: 42, fontWeight: 700, textTransform: "uppercase", fontSize: 12 }}>
                      {o.side}
                    </div>
                    <div style={{ flex: 1, fontSize: 12 }}>
                      <div>Price: {o.price}</div>
                      <div>Qty: {o.qty}</div>
                      <div style={{ color: "var(--muted)" }}>CID: {o.clientOrderId ?? "—"}</div>
                    </div>
                    <button
                      className={`btn ${manualCancelId === o.id ? "btnDisabled" : ""}`}
                      onClick={() => cancelManual(o.id)}
                      disabled={manualCancelId === o.id || isReadOnly}
                    >
                      {manualCancelId === o.id ? "Cancelling..." : "Cancel"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h3 style={{ marginTop: 0 }}>Recent Alerts</h3>
            <button className="btn" onClick={clearAlerts} disabled={alerts.length === 0}>
              Clear alerts
            </button>
          </div>
          {alerts.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No alerts yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {alerts.slice(0, 10).map((a) => (
                <div key={a.id} className="card" style={{ padding: 8 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{formatUpdated(a.createdAt)}</div>
                  <div style={{ fontWeight: 700 }}>{a.title}</div>
                  {a.message ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{a.message}</div> : null}
                </div>
              ))}
            </div>
          )}
        </section>

      </div>

      <div className="overviewGrid" style={{ marginTop: 16 }}>
        <section className="card" style={{ padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Manual Trades</h3>
          {!((canManualLimit || canManualMarket)) ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Manual trading disabled by admin.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  className={`btn ${manualType === "LIMIT" ? "btnPrimary" : ""} ${isReadOnly ? "btnDisabled" : ""}`}
                  onClick={() => setManualType("LIMIT")}
                  disabled={!canManualLimit || isReadOnly}
                >
                  Limit
                </button>
                <button
                  className={`btn ${manualType === "MARKET" ? "btnPrimary" : ""} ${isReadOnly ? "btnDisabled" : ""}`}
                  onClick={() => setManualType("MARKET")}
                  disabled={!canManualMarket || isReadOnly}
                >
                  Market
                </button>
                <button
                  className={`btn ${manualSide === "buy" ? "btnStart" : ""} ${isReadOnly ? "btnDisabled" : ""}`}
                  onClick={() => setManualSide("buy")}
                  disabled={isReadOnly}
                >
                  Buy
                </button>
                <button
                  className={`btn ${manualSide === "sell" ? "btnStop" : ""} ${isReadOnly ? "btnDisabled" : ""}`}
                  onClick={() => setManualSide("sell")}
                  disabled={isReadOnly}
                >
                  Sell
                </button>
              </div>

              {manualType === "LIMIT" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <label style={{ fontSize: 13, display: "grid", gap: 6 }}>
                    <span>Price</span>
                    <input
                      className="input"
                      style={{ maxWidth: 180 }}
                      value={manualPrice}
                      onChange={(e) => setManualPrice(e.target.value)}
                      placeholder="0.0000"
                    />
                  </label>
                  <label style={{ fontSize: 13, display: "grid", gap: 6 }}>
                    <span>Quantity</span>
                    <input
                      className="input"
                      style={{ maxWidth: 180 }}
                      value={manualQty}
                      onChange={(e) => setManualQty(e.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={manualPostOnly}
                      onChange={(e) => setManualPostOnly(e.target.checked)}
                    />
                    Post-only
                  </label>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {manualSide === "buy" ? (
                    <label style={{ fontSize: 13, display: "grid", gap: 6 }}>
                      <span>Spend (USDT)</span>
                      <input
                        className="input"
                        style={{ maxWidth: 180 }}
                        value={manualSpend}
                        onChange={(e) => setManualSpend(e.target.value)}
                        placeholder="0"
                      />
                    </label>
                  ) : (
                    <label style={{ fontSize: 13, display: "grid", gap: 6 }}>
                      <span>Quantity</span>
                      <input
                        className="input"
                        style={{ maxWidth: 180 }}
                        value={manualQty}
                        onChange={(e) => setManualQty(e.target.value)}
                        placeholder="0"
                      />
                    </label>
                  )}
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={manualConfirm}
                      onChange={(e) => setManualConfirm(e.target.checked)}
                    />
                    I understand market orders can cause slippage.
                  </label>
                </div>
              )}

              <button
                className={`btn btnPrimary ${manualBusy || isReadOnly ? "btnDisabled" : ""}`}
                onClick={submitManual}
                disabled={manualBusy || isReadOnly}
              >
                {manualBusy ? "Submitting..." : "Submit manual order"}
              </button>
              {manualError ? (
                <div style={{ fontSize: 12, color: "#fca5a5" }}>{manualError}</div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Kv(props: { k: string; v: any }) {
  return (
    <div className="card" style={{ padding: "8px 10px" }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{props.k}</div>
      <div style={{ fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
        {props.v === null || props.v === undefined ? "—" : String(props.v)}
      </div>
    </div>
  );
}

function OrderTable({ title, rows, accent }: { title: string; rows: Order[]; accent: string }) {
  return (
    <div className="card" style={{ padding: 10, borderColor: accent, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: accent }} />
        <div style={{ fontSize: 12, fontWeight: 700 }}>{title}</div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
          {rows.length} open
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", color: "var(--muted)", fontWeight: 600, width: "38%" }}>
                Price (USDT)
              </th>
              <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 600, width: "32%" }}>
                Amount
              </th>
              <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 600, width: "30%" }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ color: "var(--muted)", paddingTop: 8 }}>No open orders</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                  <td style={{ paddingTop: 6, paddingBottom: 6, overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {formatNum(r.price)}
                      {(r.clientOrderId ?? "").startsWith("man_") ? (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "2px 6px",
                            borderRadius: 999,
                            border: "1px solid rgba(59,130,246,0.7)",
                            color: "#93c5fd",
                            whiteSpace: "nowrap"
                          }}
                        >
                          manual
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {formatNum(r.qty)}
                  </td>
                  <td style={{ textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {formatNum(r.price * r.qty, 3)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatNum(v: any, maxDecimals = 8) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return Number(v).toFixed(maxDecimals).replace(/\.?0+$/, "");
}

function formatUpdated(value: any) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}
