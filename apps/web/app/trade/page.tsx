"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, apiGet, apiPost } from "../../lib/api";
import {
  parseTradeDeskPrefill,
  TRADE_DESK_PREFILL_SESSION_KEY,
  type TradeDeskPrefillPayload
} from "../../src/schemas/tradeDeskPrefill";
import { LightweightChart } from "./LightweightChart";

type ExchangeAccountItem = {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
  lastUsedAt: string | null;
};

type TradingSettings = {
  exchangeAccountId: string | null;
  symbol: string | null;
  timeframe: string | null;
};

type SymbolItem = {
  symbol: string;
  exchangeSymbol: string;
  status: string;
  tradable: boolean;
  tickSize: number | null;
  stepSize: number | null;
  minQty: number | null;
  maxQty: number | null;
};

type AccountSummary = {
  exchangeAccountId: string;
  exchange: string;
  equity: number | null;
  availableMargin: number | null;
  positionsCount: number;
  updatedAt: string;
};

type PositionItem = {
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
};

type OpenOrderItem = {
  orderId: string;
  symbol: string;
  side: string | null;
  type: string | null;
  status: string | null;
  price: number | null;
  qty: number | null;
  createdAt: string | null;
};

type TickerState = {
  symbol: string;
  last: number | null;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  ts: number | null;
};

type WsEnvelope = {
  type: string;
  symbol?: string;
  data?: any;
  message?: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  process.env.API_BASE_URL ??
  "http://localhost:4000";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

type OrderTypeValue = "market" | "limit";

type TradeDirection = "long" | "short";
type MarginModeValue = "cross" | "isolated";
type EntryModeValue = "open" | "close";
type QtyInputModeValue = "quantity" | "cost" | "value";

type QtyInputModeOption = {
  value: QtyInputModeValue;
  title: string;
  description: string;
  unit: string;
};

const QTY_INPUT_MODE_OPTIONS: QtyInputModeOption[] = [
  {
    value: "quantity",
    title: "Quantity",
    description: "Quantity of the futures position, measured in base asset.",
    unit: "BASE"
  },
  {
    value: "cost",
    title: "Cost",
    description: "Margin amount used for the trade.",
    unit: "USDT"
  },
  {
    value: "value",
    title: "Value",
    description: "Notional value of the position.",
    unit: "USDT"
  }
];

function toWsBase(url: string): string {
  if (url.startsWith("https://")) return `wss://${url.slice("https://".length)}`;
  if (url.startsWith("http://")) return `ws://${url.slice("http://".length)}`;
  return url;
}

function errMsg(e: unknown): string {
  if (e instanceof TypeError) {
    const msg = String(e.message ?? "");
    if (msg.includes("NetworkError") || msg.includes("Failed to fetch")) {
      return `API connection failed (${API_BASE}). Check if apps/api is running on port 4000.`;
    }
  }
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function fmtConfidence(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const normalized = value <= 1 ? value * 100 : value;
  const clamped = Math.max(0, Math.min(100, normalized));
  return `${clamped.toFixed(1)}%`;
}

function fmtIndicator(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return Number(value).toFixed(digits);
}

function decodeBase64UrlJson(value: string): unknown | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function TradePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wsBase = useMemo(() => toWsBase(API_BASE), []);

  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<string>("15m");

  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrderItem[]>([]);

  const [ticker, setTicker] = useState<TickerState | null>(null);

  const [orderType, setOrderType] = useState<OrderTypeValue>("limit");
  const [marginMode, setMarginMode] = useState<MarginModeValue>("cross");
  const [entryMode, setEntryMode] = useState<EntryModeValue>("open");
  const [leverage, setLeverage] = useState("10");
  const [qty, setQty] = useState("0.001");
  const [qtyPercent, setQtyPercent] = useState(0);
  const [qtyInputMode, setQtyInputMode] = useState<QtyInputModeValue>("quantity");
  const [qtyInputModeDraft, setQtyInputModeDraft] = useState<QtyInputModeValue>("quantity");
  const [isQtyModeModalOpen, setIsQtyModeModalOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [tpSlEnabled, setTpSlEnabled] = useState(false);
  const [takeProfitPrice, setTakeProfitPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [softWarning, setSoftWarning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApplyingLeverage, setIsApplyingLeverage] = useState(false);
  const [activePrefill, setActivePrefill] = useState<TradeDeskPrefillPayload | null>(null);
  const [prefillInfo, setPrefillInfo] = useState<string | null>(null);
  const [prefillContextExpanded, setPrefillContextExpanded] = useState(true);
  const [prefillActionNotice, setPrefillActionNotice] = useState<string | null>(null);

  const marketWsRef = useRef<WebSocket | null>(null);
  const userWsRef = useRef<WebSocket | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((row) => row.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );

  const selectedSymbolMeta = useMemo(
    () => symbols.find((row) => row.symbol === selectedSymbol) ?? null,
    [symbols, selectedSymbol]
  );
  const isSpotShortPrefillBlocked =
    activePrefill?.marketType === "spot" &&
    activePrefill.signal === "down";

  const numericLeverage = useMemo(() => {
    const value = Number(leverage);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [leverage]);

  const refPrice = useMemo(() => {
    const value = ticker?.mark ?? ticker?.last ?? null;
    return value !== null && Number.isFinite(value) && value > 0 ? value : null;
  }, [ticker]);

  const estimatedMaxQty = useMemo(() => {
    const available = summary?.availableMargin ?? null;
    if (available === null || !Number.isFinite(available) || available <= 0) return null;
    if (!numericLeverage || !refPrice) return null;

    const raw = (available * numericLeverage) / refPrice;
    if (!Number.isFinite(raw) || raw <= 0) return null;

    const step = selectedSymbolMeta?.stepSize ?? null;
    if (step !== null && Number.isFinite(step) && step > 0) {
      return Math.floor(raw / step) * step;
    }
    return raw;
  }, [summary, numericLeverage, refPrice, selectedSymbolMeta]);

  const baseAssetUnit = useMemo(() => {
    if (selectedSymbol.endsWith("USDT")) {
      return selectedSymbol.slice(0, -4) || selectedSymbol;
    }
    return selectedSymbol;
  }, [selectedSymbol]);

  const qtyInputModeOption = useMemo(
    () => QTY_INPUT_MODE_OPTIONS.find((item) => item.value === qtyInputMode) ?? QTY_INPUT_MODE_OPTIONS[0],
    [qtyInputMode]
  );

  const qtyDisplayUnit = qtyInputMode === "quantity" ? baseAssetUnit : "USDT";

  const qtyInputValue = useMemo(() => {
    const parsed = Number(qty);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [qty]);

  const orderReferencePrice = useMemo(() => {
    if (orderType === "limit") {
      const parsed = Number(price);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    return refPrice;
  }, [orderType, price, refPrice]);

  const orderQtyValue = useMemo(() => {
    if (qtyInputValue === null) return null;

    if (qtyInputMode === "quantity") {
      return qtyInputValue;
    }

    if (!orderReferencePrice || !Number.isFinite(orderReferencePrice) || orderReferencePrice <= 0) {
      return null;
    }

    if (qtyInputMode === "cost") {
      if (!numericLeverage || !Number.isFinite(numericLeverage) || numericLeverage <= 0) return null;
      return (qtyInputValue * numericLeverage) / orderReferencePrice;
    }

    return qtyInputValue / orderReferencePrice;
  }, [numericLeverage, orderReferencePrice, qtyInputMode, qtyInputValue]);

  const estimatedCost = useMemo(() => {
    if (qtyInputValue === null) return null;
    if (qtyInputMode === "cost") return qtyInputValue;
    if (qtyInputMode === "value") {
      if (!numericLeverage || !Number.isFinite(numericLeverage) || numericLeverage <= 0) return null;
      return qtyInputValue / numericLeverage;
    }

    if (!orderQtyValue || !orderReferencePrice) return null;
    const notional = orderQtyValue * orderReferencePrice;
    if (!Number.isFinite(notional) || notional <= 0) return null;
    if (!numericLeverage || !Number.isFinite(numericLeverage) || numericLeverage <= 0) return notional;
    return notional / numericLeverage;
  }, [numericLeverage, orderQtyValue, orderReferencePrice, qtyInputMode, qtyInputValue]);

  const estimatedMaxInputByMode = useMemo(() => {
    const available = summary?.availableMargin ?? null;
    if (available === null || !Number.isFinite(available) || available <= 0) return null;

    if (qtyInputMode === "quantity") return estimatedMaxQty;
    if (qtyInputMode === "cost") return available;

    if (!numericLeverage || !Number.isFinite(numericLeverage) || numericLeverage <= 0) return null;
    return available * numericLeverage;
  }, [estimatedMaxQty, numericLeverage, qtyInputMode, summary]);

  const estimatedLiquidation = useMemo(() => {
    if (!orderReferencePrice || !numericLeverage) {
      return { long: null as number | null, short: null as number | null };
    }

    // Approximate liquidation estimate for UI guidance only.
    const maintenanceMarginRate = marginMode === "isolated" ? 0.004 : 0.005;
    const longPrice = orderReferencePrice * (1 - 1 / numericLeverage + maintenanceMarginRate);
    const shortPrice = orderReferencePrice * (1 + 1 / numericLeverage - maintenanceMarginRate);

    return {
      long: Number.isFinite(longPrice) && longPrice > 0 ? longPrice : null,
      short: Number.isFinite(shortPrice) && shortPrice > 0 ? shortPrice : null
    };
  }, [marginMode, numericLeverage, orderReferencePrice]);

  function setQtyFromPercent(nextPercent: number) {
    const clamped = Math.max(0, Math.min(100, nextPercent));
    setQtyPercent(clamped);

    if (!estimatedMaxInputByMode || estimatedMaxInputByMode <= 0) return;
    const next = (estimatedMaxInputByMode * clamped) / 100;

    if (qtyInputMode !== "quantity") {
      if (!Number.isFinite(next) || next <= 0) {
        setQty("");
        return;
      }
      setQty(next.toFixed(4).replace(/\.?0+$/, ""));
      return;
    }

    const step = selectedSymbolMeta?.stepSize ?? null;
    const minQty = selectedSymbolMeta?.minQty ?? null;
    let normalized = next;

    if (step !== null && Number.isFinite(step) && step > 0) {
      normalized = Math.floor(next / step) * step;
    }
    if (clamped > 0 && minQty !== null && Number.isFinite(minQty) && minQty > 0) {
      normalized = Math.max(normalized, minQty);
    }

    if (normalized > 0 && Number.isFinite(normalized)) {
      const decimals =
        step !== null && step > 0 && Number.isFinite(step)
          ? Math.min(8, String(step).split(".")[1]?.length ?? 0)
          : 6;
      setQty(normalized.toFixed(decimals).replace(/\.?0+$/, ""));
    }
  }

  function resetTicketDefaults() {
    setOrderType("limit");
    setMarginMode("cross");
    setEntryMode("open");
    setLeverage("10");
    setQtyInputMode("quantity");
    setQtyInputModeDraft("quantity");
    setQty("0.001");
    setQtyPercent(0);
    setPrice("");
    setTpSlEnabled(false);
    setTakeProfitPrice("");
    setStopLossPrice("");
    setPrefillInfo(null);
    setPrefillActionNotice(null);
  }

  function applyPrefillTicket(prefill: TradeDeskPrefillPayload) {
    setActivePrefill(prefill);
    setEntryMode("open");
    if (typeof window !== "undefined") {
      setPrefillContextExpanded(!window.matchMedia("(max-width: 700px)").matches);
    }

    if (prefill.timeframe && TIMEFRAMES.includes(prefill.timeframe as any)) {
      setTimeframe(prefill.timeframe);
    }

    if (prefill.symbol) {
      setSelectedSymbol(prefill.symbol.trim().toUpperCase());
    }

    if (prefill.suggestedEntry?.type === "market" || prefill.suggestedEntry?.type === "limit") {
      setOrderType(prefill.suggestedEntry.type);
    }

    if (prefill.suggestedEntry?.type === "limit" && prefill.suggestedEntry.price) {
      setPrice(String(prefill.suggestedEntry.price));
    }

    if (prefill.leverage && Number.isFinite(prefill.leverage) && prefill.leverage >= 1 && prefill.leverage <= 125) {
      setLeverage(String(prefill.leverage));
    }

    if (prefill.suggestedTakeProfit || prefill.suggestedStopLoss) {
      setTpSlEnabled(true);
      setTakeProfitPrice(prefill.suggestedTakeProfit ? String(prefill.suggestedTakeProfit) : "");
      setStopLossPrice(prefill.suggestedStopLoss ? String(prefill.suggestedStopLoss) : "");
    }

    if (prefill.positionSizeHint) {
      if (prefill.positionSizeHint.mode === "percent_balance") {
        setQtyInputMode("cost");
        setQtyInputModeDraft("cost");
        setQtyFromPercent(prefill.positionSizeHint.value);
      } else {
        setQtyInputMode("cost");
        setQtyInputModeDraft("cost");
        setQty(String(prefill.positionSizeHint.value));
        setQtyPercent(0);
      }
    }

    if (prefill.marketType === "spot" && prefill.signal === "down") {
      setPrefillInfo("Spot short is not supported. Side prefill was skipped.");
      return;
    }

    setPrefillInfo(null);
  }

  async function copyPrefillSummary() {
    if (!activePrefill) return;
    const lines = [
      `Prediction ${activePrefill.predictionId}`,
      `${activePrefill.symbol} ${activePrefill.marketType} ${activePrefill.timeframe}`,
      `Signal: ${activePrefill.signal}`,
      `Side: ${activePrefill.side ?? "manual"}`,
      `Confidence: ${fmtConfidence(activePrefill.confidence)}`,
      typeof activePrefill.expectedMovePct === "number"
        ? `Expected move: ${activePrefill.expectedMovePct.toFixed(2)}%`
        : null,
      activePrefill.tags?.length ? `Tags: ${activePrefill.tags.slice(0, 5).join(", ")}` : null,
      activePrefill.explanation ? `Explanation: ${activePrefill.explanation}` : null,
      activePrefill.keyDrivers?.length
        ? `Key drivers: ${activePrefill.keyDrivers
            .slice(0, 5)
            .map((driver) => `${driver.name}=${String(driver.value)}`)
            .join("; ")}`
        : null
    ].filter(Boolean).join("\n");

    try {
      await navigator.clipboard.writeText(lines);
      setPrefillActionNotice("Prediction summary copied.");
    } catch {
      setPrefillActionNotice("Clipboard access failed.");
    }
  }

  async function persistSettings(next: Partial<TradingSettings>) {
    try {
      await apiPost<TradingSettings>("/api/trading/settings", next);
    } catch {
      // keep UI responsive if settings save fails
    }
  }

  async function loadPrimaryState(
    preferredAccountId?: string | null,
    prefillPayload?: TradeDeskPrefillPayload | null
  ) {
    setLoading(true);
    setError(null);
    try {
      const [accountPayload, settings] = await Promise.all([
        apiGet<{ items: ExchangeAccountItem[] }>("/exchange-accounts"),
        apiGet<TradingSettings>("/api/trading/settings")
      ]);

      const accountRows = accountPayload.items ?? [];
      setAccounts(accountRows);

      const queryAccountId = searchParams.get("exchangeAccountId");
      const chosenAccount =
        preferredAccountId ??
        prefillPayload?.accountId ??
        queryAccountId ??
        settings.exchangeAccountId ??
        accountRows[0]?.id ??
        "";

      setSelectedAccountId(chosenAccount);

      if (
        prefillPayload?.timeframe &&
        TIMEFRAMES.includes(prefillPayload.timeframe as any)
      ) {
        setTimeframe(prefillPayload.timeframe);
      } else if (settings.timeframe && TIMEFRAMES.includes(settings.timeframe as any)) {
        setTimeframe(settings.timeframe);
      }

      if (prefillPayload?.symbol) {
        setSelectedSymbol(prefillPayload.symbol.trim().toUpperCase());
      } else if (settings.symbol) {
        setSelectedSymbol(settings.symbol);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadDeskData(accountId: string, preferredSymbol?: string | null) {
    if (!accountId) return;

    setError(null);
    setSoftWarning(null);
    try {
      const symbolPayload = await apiGet<{
        exchangeAccountId: string;
        items: SymbolItem[];
        defaultSymbol: string | null;
      }>(`/api/symbols?exchangeAccountId=${encodeURIComponent(accountId)}`);

      const rows = symbolPayload.items ?? [];
      setSymbols(rows);

      const normalizedPreferred = (preferredSymbol ?? selectedSymbol).trim().toUpperCase();
      const fallbackSymbol = symbolPayload.defaultSymbol ?? rows[0]?.symbol ?? "BTCUSDT";
      const nextSymbol = rows.some((row) => row.symbol === normalizedPreferred)
        ? normalizedPreferred
        : fallbackSymbol;

      setSelectedSymbol(nextSymbol);

      const [summaryResult, positionsResult, ordersResult] = await Promise.allSettled([
        apiGet<AccountSummary>(`/api/account/summary?exchangeAccountId=${encodeURIComponent(accountId)}`),
        apiGet<{ items: PositionItem[] }>(
          `/api/positions?exchangeAccountId=${encodeURIComponent(accountId)}&symbol=${encodeURIComponent(nextSymbol)}`
        ),
        apiGet<{ items: OpenOrderItem[] }>(
          `/api/orders/open?exchangeAccountId=${encodeURIComponent(accountId)}&symbol=${encodeURIComponent(nextSymbol)}`
        )
      ]);

      const partialFailures: string[] = [];

      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value);
      } else {
        partialFailures.push(`account summary (${errMsg(summaryResult.reason)})`);
      }

      if (positionsResult.status === "fulfilled") {
        setPositions(positionsResult.value.items ?? []);
      } else {
        setPositions([]);
        partialFailures.push(`positions (${errMsg(positionsResult.reason)})`);
      }

      if (ordersResult.status === "fulfilled") {
        setOpenOrders(ordersResult.value.items ?? []);
      } else {
        setOpenOrders([]);
        partialFailures.push(`open orders (${errMsg(ordersResult.reason)})`);
      }

      if (partialFailures.length > 0) {
        setSoftWarning(`Partial data unavailable: ${partialFailures.join(", ")}`);
      } else {
        setSoftWarning(null);
      }

      await persistSettings({
        exchangeAccountId: accountId,
        symbol: nextSymbol,
        timeframe
      });
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function reloadLiveTables(accountId: string, symbol: string) {
    const [positionsResult, ordersResult, summaryResult] = await Promise.allSettled([
      apiGet<{ items: PositionItem[] }>(
        `/api/positions?exchangeAccountId=${encodeURIComponent(accountId)}&symbol=${encodeURIComponent(symbol)}`
      ),
      apiGet<{ items: OpenOrderItem[] }>(
        `/api/orders/open?exchangeAccountId=${encodeURIComponent(accountId)}&symbol=${encodeURIComponent(symbol)}`
      ),
      apiGet<AccountSummary>(`/api/account/summary?exchangeAccountId=${encodeURIComponent(accountId)}`)
    ]);

    if (positionsResult.status === "fulfilled") {
      setPositions(positionsResult.value.items ?? []);
    }
    if (ordersResult.status === "fulfilled") {
      setOpenOrders(ordersResult.value.items ?? []);
    }
    if (summaryResult.status === "fulfilled") {
      setSummary(summaryResult.value);
    }
  }

  useEffect(() => {
    let parsedPrefill: TradeDeskPrefillPayload | null = null;
    const prefillParam = searchParams.get("prefill");

    if (prefillParam) {
      if (prefillParam === "1") {
        const raw = sessionStorage.getItem(TRADE_DESK_PREFILL_SESSION_KEY);
        sessionStorage.removeItem(TRADE_DESK_PREFILL_SESSION_KEY);
        if (raw) {
          try {
            parsedPrefill = parseTradeDeskPrefill(JSON.parse(raw));
          } catch {
            parsedPrefill = null;
          }
        }
      } else {
        parsedPrefill = parseTradeDeskPrefill(decodeBase64UrlJson(prefillParam));
      }

      if (!parsedPrefill) {
        setSoftWarning("Invalid prefill payload.");
      }
    }

    if (parsedPrefill) {
      applyPrefillTicket(parsedPrefill);
    }

    void loadPrimaryState(parsedPrefill?.accountId ?? null, parsedPrefill);
    return () => {
      if (marketWsRef.current) marketWsRef.current.close();
      if (userWsRef.current) userWsRef.current.close();
      if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;
    void loadDeskData(selectedAccountId, activePrefill?.symbol ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, activePrefill?.symbol]);

  useEffect(() => {
    if (!activePrefill?.positionSizeHint) return;
    if (activePrefill.positionSizeHint.mode !== "percent_balance") return;
    if (!estimatedMaxInputByMode || estimatedMaxInputByMode <= 0) return;
    setQtyFromPercent(activePrefill.positionSizeHint.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePrefill?.predictionId, estimatedMaxInputByMode]);

  useEffect(() => {
    if (!selectedAccountId || !selectedSymbol) return;

    if (marketWsRef.current) {
      marketWsRef.current.close();
      marketWsRef.current = null;
    }

    const marketWs = new WebSocket(
      `${wsBase}/ws/market?exchangeAccountId=${encodeURIComponent(selectedAccountId)}&symbol=${encodeURIComponent(selectedSymbol)}`
    );
    marketWsRef.current = marketWs;

    marketWs.onmessage = (event) => {
      let payload: WsEnvelope | null = null;
      try {
        payload = JSON.parse(event.data) as WsEnvelope;
      } catch {
        return;
      }
      if (!payload) return;

      if (payload.type.includes("ticker") && payload.data) {
        setTicker(payload.data as TickerState);
      }

      if (payload.type === "error") {
        setError(payload.message ?? "Market websocket error");
      }
    };

    marketWs.onerror = () => {
      setError("Market stream disconnected.");
    };

    return () => {
      marketWs.close();
      if (marketWsRef.current === marketWs) {
        marketWsRef.current = null;
      }
    };
  }, [selectedAccountId, selectedSymbol, wsBase]);

  useEffect(() => {
    if (!selectedAccountId) return;

    if (userWsRef.current) {
      userWsRef.current.close();
      userWsRef.current = null;
    }

    const userWs = new WebSocket(
      `${wsBase}/ws/user?exchangeAccountId=${encodeURIComponent(selectedAccountId)}`
    );
    userWsRef.current = userWs;

    userWs.onmessage = (event) => {
      let payload: WsEnvelope | null = null;
      try {
        payload = JSON.parse(event.data) as WsEnvelope;
      } catch {
        return;
      }
      if (!payload) return;

      if (payload.type === "account" && payload.data) {
        const data = payload.data as {
          equity: number | null;
          availableMargin: number | null;
          positions?: PositionItem[];
          openOrders?: OpenOrderItem[];
        };

        setSummary((prev) =>
          prev
            ? {
                ...prev,
                equity: data.equity,
                availableMargin: data.availableMargin,
                updatedAt: new Date().toISOString()
              }
            : prev
        );

        if (Array.isArray(data.positions)) {
          setPositions(data.positions);
        }
        if (Array.isArray(data.openOrders)) {
          setOpenOrders(data.openOrders);
        }
      }

      if (payload.type === "order" || payload.type === "position" || payload.type === "fill") {
        void reloadLiveTables(selectedAccountId, selectedSymbol).catch(() => {
          // ignore transient refresh errors
        });
      }
    };

    userWs.onerror = () => {
      setError("User stream disconnected.");
    };

    return () => {
      userWs.close();
      if (userWsRef.current === userWs) {
        userWsRef.current = null;
      }
    };
  }, [selectedAccountId, selectedSymbol, wsBase]);

  useEffect(() => {
    if (!selectedAccountId || !selectedSymbol) return;

    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    refreshTimerRef.current = window.setInterval(() => {
      void reloadLiveTables(selectedAccountId, selectedSymbol).catch(() => {
        // background refresh should not interrupt user
      });
    }, 8000);

    return () => {
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [selectedAccountId, selectedSymbol]);

  async function applyLeverage() {
    if (!selectedAccountId) return;

    const parsedLeverage = Number(leverage);
    if (!Number.isFinite(parsedLeverage) || parsedLeverage < 1 || parsedLeverage > 125) {
      setActionError("Leverage must be between 1 and 125.");
      return;
    }

    setActionError(null);
    setIsApplyingLeverage(true);
    try {
      await apiPost("/api/account/leverage", {
        exchangeAccountId: selectedAccountId,
        symbol: selectedSymbol,
        leverage: Math.trunc(parsedLeverage),
        marginMode
      });
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setIsApplyingLeverage(false);
    }
  }

  async function submitOrder(direction: TradeDirection) {
    if (!selectedAccountId) return;

    const parsedQtyInput = Number(qty);
    const parsedPrice = Number(price);
    const parsedLeverage = Number(leverage);
    const parsedTakeProfit = Number(takeProfitPrice);
    const parsedStopLoss = Number(stopLossPrice);

    if (!Number.isFinite(parsedQtyInput) || parsedQtyInput <= 0) {
      setActionError("Quantity must be greater than 0.");
      return;
    }

    if (!orderQtyValue || !Number.isFinite(orderQtyValue) || orderQtyValue <= 0) {
      setActionError("Unable to derive order quantity for selected unit.");
      return;
    }

    const step = selectedSymbolMeta?.stepSize ?? null;
    const minQty = selectedSymbolMeta?.minQty ?? null;
    const maxQty = selectedSymbolMeta?.maxQty ?? null;

    let parsedQty = orderQtyValue;
    if (step !== null && Number.isFinite(step) && step > 0) {
      parsedQty = Math.floor(parsedQty / step) * step;
    }

    if (minQty !== null && Number.isFinite(minQty) && minQty > 0 && parsedQty < minQty) {
      setActionError(`Quantity is below minimum (${minQty}).`);
      return;
    }

    if (maxQty !== null && Number.isFinite(maxQty) && maxQty > 0 && parsedQty > maxQty) {
      parsedQty = maxQty;
    }

    if (orderType === "limit" && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      setActionError("Limit orders require a valid price.");
      return;
    }

    if (!Number.isFinite(parsedLeverage) || parsedLeverage < 1 || parsedLeverage > 125) {
      setActionError("Leverage must be between 1 and 125.");
      return;
    }

    if (
      tpSlEnabled &&
      takeProfitPrice.trim().length > 0 &&
      (!Number.isFinite(parsedTakeProfit) || parsedTakeProfit <= 0)
    ) {
      setActionError("Take profit must be greater than 0.");
      return;
    }

    if (
      tpSlEnabled &&
      stopLossPrice.trim().length > 0 &&
      (!Number.isFinite(parsedStopLoss) || parsedStopLoss <= 0)
    ) {
      setActionError("Stop loss must be greater than 0.");
      return;
    }

    setActionError(null);
    setIsSubmitting(true);

    try {
      await apiPost<{ orderId: string }>("/api/orders", {
        exchangeAccountId: selectedAccountId,
        symbol: selectedSymbol,
        type: orderType,
        side: direction,
        qty: parsedQty,
        price: orderType === "limit" ? parsedPrice : undefined,
        takeProfitPrice: tpSlEnabled && takeProfitPrice.trim().length > 0 ? parsedTakeProfit : undefined,
        stopLossPrice: tpSlEnabled && stopLossPrice.trim().length > 0 ? parsedStopLoss : undefined,
        leverage: Math.trunc(parsedLeverage),
        marginMode,
        reduceOnly: entryMode === "close"
      });

      await reloadLiveTables(selectedAccountId, selectedSymbol);
      if (orderType === "limit") {
        setPrice("");
      }
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function closePosition(side: "long" | "short") {
    if (!selectedAccountId) return;
    setActionError(null);

    try {
      await apiPost("/api/positions/close", {
        exchangeAccountId: selectedAccountId,
        symbol: selectedSymbol,
        side
      });
      await reloadLiveTables(selectedAccountId, selectedSymbol);
    } catch (e) {
      setActionError(errMsg(e));
    }
  }

  async function cancelOrder(orderId: string) {
    if (!selectedAccountId) return;
    setActionError(null);

    try {
      await apiPost("/api/orders/cancel", {
        exchangeAccountId: selectedAccountId,
        orderId,
        symbol: selectedSymbol
      });
      await reloadLiveTables(selectedAccountId, selectedSymbol);
    } catch (e) {
      setActionError(errMsg(e));
    }
  }

  async function cancelAll() {
    if (!selectedAccountId) return;
    setActionError(null);

    try {
      await apiPost(
        `/api/orders/cancel-all?exchangeAccountId=${encodeURIComponent(selectedAccountId)}&symbol=${encodeURIComponent(selectedSymbol)}`,
        {}
      );
      await reloadLiveTables(selectedAccountId, selectedSymbol);
    } catch (e) {
      setActionError(errMsg(e));
    }
  }

  function clearPrefill() {
    setActivePrefill(null);
    resetTicketDefaults();

    const params = new URLSearchParams(searchParams.toString());
    params.delete("prefill");
    if (!params.get("exchangeAccountId") && selectedAccountId) {
      params.set("exchangeAccountId", selectedAccountId);
    }

    const nextPath = params.toString() ? `/trade?${params.toString()}` : "/trade";
    router.replace(nextPath);
  }

  return (
    <div>
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>Manual Trading Desk</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            TradingView + futures order controls.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/dashboard" className="btn">Dashboard</Link>
          <Link href={selectedAccountId ? `/bots?exchangeAccountId=${encodeURIComponent(selectedAccountId)}` : "/bots"} className="btn">
            Bots
          </Link>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          <strong>Error:</strong> {error}
          <div style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => {
                if (!selectedAccountId) return;
                void loadDeskData(selectedAccountId, selectedSymbol);
              }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          <strong>Action failed:</strong> {actionError}
        </div>
      ) : null}

      {softWarning ? (
        <div className="card" style={{ padding: 12, borderColor: "#f59e0b", marginBottom: 12 }}>
          <strong>Warning:</strong> {softWarning}
        </div>
      ) : null}

      {activePrefill ? (
        <div className="card" style={{ padding: 12, borderColor: "#3b82f6", marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <strong>Prediction Context</strong>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {activePrefill.symbol} · {activePrefill.marketType} · {activePrefill.timeframe} · {fmtConfidence(activePrefill.confidence)} ·{" "}
                {new Date(activePrefill.tsCreated).toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Signal: {activePrefill.signal} · Side: {activePrefill.side ?? "manual"}
                {typeof activePrefill.expectedMovePct === "number"
                  ? ` · Move: ${activePrefill.expectedMovePct.toFixed(2)}%`
                  : ""}
              </div>
              {activePrefill.leverage ? (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Prefill leverage: {activePrefill.leverage}x
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                onClick={() => setPrefillContextExpanded((prev) => !prev)}
              >
                {prefillContextExpanded ? "Hide context" : "Show context"}
              </button>
              <button className="btn" onClick={() => void copyPrefillSummary()} type="button">Copy Summary</button>
              <Link href="/predictions" className="btn">Back to Prediction</Link>
              <button className="btn" onClick={clearPrefill} type="button">Clear Prefill</button>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
            Prediction ID: {activePrefill.predictionId}
          </div>
          {prefillActionNotice ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              {prefillActionNotice}
            </div>
          ) : null}
          {prefillInfo ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "#f59e0b" }}>{prefillInfo}</div>
          ) : null}
          {prefillContextExpanded ? (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {activePrefill.tags?.length ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {activePrefill.tags.map((tag) => (
                    <span key={tag} className="badge">{tag}</span>
                  ))}
                </div>
              ) : null}

              {activePrefill.explanation ? (
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 12 }}>AI explanation</summary>
                  <div style={{ marginTop: 6, fontSize: 12 }}>{activePrefill.explanation}</div>
                </details>
              ) : null}

              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>RSI (14)</div>
                  <div style={{ fontWeight: 700 }}>{fmtIndicator(activePrefill.indicators?.rsi_14, 1)}</div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>MACD hist</div>
                  <div style={{ fontWeight: 700 }}>{fmtIndicator(activePrefill.indicators?.macd?.hist, 4)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    line {fmtIndicator(activePrefill.indicators?.macd?.line, 4)} / signal {fmtIndicator(activePrefill.indicators?.macd?.signal, 4)}
                  </div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>BB width% / pos</div>
                  <div style={{ fontWeight: 700 }}>
                    {fmtIndicator(activePrefill.indicators?.bb?.width_pct, 2)} / {fmtIndicator(activePrefill.indicators?.bb?.pos, 3)}
                  </div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>VWAP dist%</div>
                  <div style={{ fontWeight: 700 }}>{fmtIndicator(activePrefill.indicators?.vwap?.dist_pct, 2)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    mode {activePrefill.indicators?.vwap?.mode ?? "n/a"}
                  </div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>ADX / +DI / -DI</div>
                  <div style={{ fontWeight: 700 }}>
                    {fmtIndicator(activePrefill.indicators?.adx?.adx_14, 1)} / {fmtIndicator(activePrefill.indicators?.adx?.plus_di_14, 1)} / {fmtIndicator(activePrefill.indicators?.adx?.minus_di_14, 1)}
                  </div>
                </div>
              </div>

              <div className="card" style={{ margin: 0, padding: 8 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Key drivers</div>
                {activePrefill.keyDrivers?.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                    {activePrefill.keyDrivers.slice(0, 5).map((driver) => (
                      <li key={driver.name}>
                        <strong>{driver.name}</strong>: {String(driver.value)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>n/a</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="card" style={{ padding: 16 }}>Loading trading desk…</div>
      ) : accounts.length === 0 ? (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>No exchange accounts available</div>
          <div style={{ color: "var(--muted)", marginBottom: 12 }}>
            Add a Bitget account first to use manual trading.
          </div>
          <Link href="/settings" className="btn btnPrimary">Add Exchange Account</Link>
        </div>
      ) : (
        <>
          <section className="card" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Exchange account</div>
                <select
                  className="input"
                  value={selectedAccountId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSelectedAccountId(next);
                    void persistSettings({ exchangeAccountId: next });
                  }}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.exchange.toUpperCase()} - {account.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Symbol</div>
                <select
                  className="input"
                  value={selectedSymbol}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSelectedSymbol(next);
                    void reloadLiveTables(selectedAccountId, next);
                    void persistSettings({ symbol: next });
                  }}
                >
                  {symbols.map((symbol) => (
                    <option key={symbol.symbol} value={symbol.symbol}>
                      {symbol.symbol} {symbol.tradable ? "" : "(restricted)"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Timeframe</div>
                <select
                  className="input"
                  value={timeframe}
                  onChange={(event) => {
                    const next = event.target.value;
                    setTimeframe(next);
                    void persistSettings({ timeframe: next });
                  }}
                >
                  {TIMEFRAMES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Account</div>
                <div className="card" style={{ padding: 10, minHeight: 44 }}>
                  Eq: {fmt(summary?.equity)} | Avail: {fmt(summary?.availableMargin)}
                </div>
              </div>
            </div>
          </section>

          <section
            className="tradeDeskGrid"
          >
            <article className="card" style={{ padding: 10, minHeight: 620 }}>
              <div style={{ marginBottom: 8, fontWeight: 700 }}>
                {selectedSymbol} {selectedSymbolMeta?.status ? `- ${selectedSymbolMeta.status}` : ""}
              </div>
              <LightweightChart
                exchangeAccountId={selectedAccountId}
                symbol={selectedSymbol}
                timeframe={timeframe}
                prefill={activePrefill}
              />
            </article>

            <article className="card" style={{ padding: 10, minHeight: 620 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Order Entry</div>

              <div className="tradeOrderPanel">
                <div className="tradeOrderTopRow">
                  <div className="tradeOrderModeSwitch">
                    <button
                      className={`tradeOrderModeBtn ${marginMode === "isolated" ? "tradeOrderModeBtnActive" : ""}`}
                      onClick={() => setMarginMode("isolated")}
                      type="button"
                    >
                      Isolated
                    </button>
                    <button
                      className={`tradeOrderModeBtn ${marginMode === "cross" ? "tradeOrderModeBtnActive" : ""}`}
                      onClick={() => setMarginMode("cross")}
                      type="button"
                    >
                      Cross
                    </button>
                  </div>
                  <div className="tradeOrderLeverageGroup">
                    <input
                      className="tradeOrderLeverageInput"
                      type="number"
                      min={1}
                      max={125}
                      step={1}
                      value={leverage}
                      onChange={(event) => setLeverage(event.target.value)}
                    />
                    <button
                      className="tradeOrderApplyBtn"
                      disabled={isApplyingLeverage}
                      onClick={() => void applyLeverage()}
                      type="button"
                    >
                      {isApplyingLeverage ? "..." : "Apply"}
                    </button>
                  </div>
                </div>

                <div className="tradeOrderEntryMode">
                  <button
                    className={`tradeOrderEntryModeBtn ${entryMode === "open" ? "tradeOrderEntryModeBtnActive" : ""}`}
                    onClick={() => setEntryMode("open")}
                    type="button"
                  >
                    Open
                  </button>
                  <button
                    className={`tradeOrderEntryModeBtn ${entryMode === "close" ? "tradeOrderEntryModeBtnActive" : ""}`}
                    onClick={() => setEntryMode("close")}
                    type="button"
                  >
                    Close
                  </button>
                </div>

                <div className="tradeOrderTypeTabs">
                  <button
                    className={`tradeOrderTypeTab ${orderType === "limit" ? "tradeOrderTypeTabActive" : ""}`}
                    onClick={() => setOrderType("limit")}
                    type="button"
                  >
                    Limit
                  </button>
                  <button
                    className={`tradeOrderTypeTab ${orderType === "market" ? "tradeOrderTypeTabActive" : ""}`}
                    onClick={() => setOrderType("market")}
                    type="button"
                  >
                    Market
                  </button>
                  <button className="tradeOrderTypeTab tradeOrderTypeTabMuted" type="button" disabled>
                    Post only
                  </button>
                </div>

                <div className="tradeOrderMetaRow">
                  <span>Available</span>
                  <strong>{fmt(summary?.availableMargin, 3)} USDT</strong>
                </div>

                {orderType === "limit" ? (
                  <label className="tradeOrderField">
                    <span>Price</span>
                    <div className="tradeOrderInputRow">
                      <input
                        className="tradeOrderInput"
                        value={price}
                        onChange={(event) => setPrice(event.target.value)}
                        placeholder={ticker?.last ? String(ticker.last) : "0.0"}
                      />
                      <button
                        className="tradeOrderMiniBtn"
                        type="button"
                        onClick={() => {
                          const nextPrice = ticker?.last ?? ticker?.mark;
                          if (nextPrice && Number.isFinite(nextPrice)) {
                            setPrice(String(nextPrice));
                          }
                        }}
                      >
                        BBO
                      </button>
                    </div>
                  </label>
                ) : null}

                <label className="tradeOrderField">
                  <span>{qtyInputModeOption.title}</span>
                  <div className="tradeOrderInputRow">
                    <input
                      className="tradeOrderInput"
                      value={qty}
                      onChange={(event) => setQty(event.target.value)}
                      placeholder={qtyInputMode === "quantity" ? "0.001" : "10"}
                    />
                    <button
                      type="button"
                      className="tradeOrderUnitBadge"
                      onClick={() => {
                        setQtyInputModeDraft(qtyInputMode);
                        setIsQtyModeModalOpen(true);
                      }}
                    >
                      {qtyDisplayUnit}
                    </button>
                  </div>
                </label>

                <input
                  className="tradeOrderSlider"
                  type="range"
                  min={0}
                  max={100}
                  step={25}
                  value={qtyPercent}
                  onChange={(event) => setQtyFromPercent(Number(event.target.value))}
                />

                <div className="tradeOrderDualStats">
                  <div className="tradeOrderDualRow">
                    <span>Position size</span>
                    <strong>
                      <span className="tradeOrderValueLong">{fmt(orderQtyValue, 4)}</span>
                      <span className="tradeOrderValueSlash"> / </span>
                      <span className="tradeOrderValueShort">{fmt(orderQtyValue, 4)}</span>
                      <span className="tradeOrderValueUnit"> {baseAssetUnit}</span>
                    </strong>
                  </div>
                  <div className="tradeOrderDualRow">
                    <span>Cost</span>
                    <strong>
                      <span className="tradeOrderValueLong">{fmt(estimatedCost, 4)}</span>
                      <span className="tradeOrderValueSlash"> / </span>
                      <span className="tradeOrderValueShort">{fmt(estimatedCost, 4)}</span>
                      <span className="tradeOrderValueUnit"> USDT</span>
                    </strong>
                  </div>
                  <div className="tradeOrderDualRow">
                    <span>Est. liq. price</span>
                    <strong>
                      <span className="tradeOrderValueLong">{fmt(estimatedLiquidation.long, 1)}</span>
                      <span className="tradeOrderValueSlash"> / </span>
                      <span className="tradeOrderValueShort">{fmt(estimatedLiquidation.short, 1)}</span>
                    </strong>
                  </div>
                </div>

                <label className="tradeOrderCheckRow">
                  <input
                    type="checkbox"
                    checked={tpSlEnabled}
                    onChange={(event) => setTpSlEnabled(event.target.checked)}
                  />
                  <span>TP/SL</span>
                </label>

                {tpSlEnabled ? (
                  <div className="tradeOrderTpSlGrid">
                    <label className="tradeOrderField">
                      <span>Take Profit</span>
                      <input
                        className="tradeOrderInput"
                        value={takeProfitPrice}
                        onChange={(event) => setTakeProfitPrice(event.target.value)}
                        placeholder="optional"
                      />
                    </label>
                    <label className="tradeOrderField">
                      <span>Stop Loss</span>
                      <input
                        className="tradeOrderInput"
                        value={stopLossPrice}
                        onChange={(event) => setStopLossPrice(event.target.value)}
                        placeholder="optional"
                      />
                    </label>
                  </div>
                ) : null}

                <div className="tradeOrderMetaRow">
                  <span>Time in force</span>
                  <strong>{orderType === "limit" ? "GTC" : "IOC"}</strong>
                </div>

                {activePrefill ? (
                  <div className="tradeOrderMetaRow">
                    <span>Prefilled side</span>
                    <strong>{activePrefill.side ? activePrefill.side.toUpperCase() : "Manual selection required"}</strong>
                  </div>
                ) : null}

                <div className="tradeOrderActionGrid">
                  <button
                    className="btn btnStart"
                    style={activePrefill?.side === "long" ? { boxShadow: "0 0 0 2px rgba(16,185,129,.45) inset" } : undefined}
                    disabled={isSubmitting}
                    onClick={() => void submitOrder("long")}
                    type="button"
                  >
                    {entryMode === "open" ? "Open Long" : "Close Short"}
                    {activePrefill?.side === "long" ? " (Suggested)" : ""}
                  </button>
                  <button
                    className="btn btnStop"
                    style={activePrefill?.side === "short" ? { boxShadow: "0 0 0 2px rgba(239,68,68,.45) inset" } : undefined}
                    disabled={isSubmitting || isSpotShortPrefillBlocked}
                    onClick={() => void submitOrder("short")}
                    type="button"
                  >
                    {entryMode === "open" ? "Open Short" : "Close Long"}
                    {activePrefill?.side === "short" ? " (Suggested)" : ""}
                  </button>
                </div>

                <div className="tradeOrderMetaRow">
                  <span>Max</span>
                  <strong>{estimatedMaxInputByMode ? `${fmt(estimatedMaxInputByMode, 4)} ${qtyDisplayUnit}` : "-"}</strong>
                </div>

                <button className="btn" onClick={() => void cancelAll()} type="button">Cancel All ({selectedSymbol})</button>

                <div className="tradeOrderDivider" />

                <div className="tradeOrderInfoTitle">Account</div>
                <div className="tradeOrderInfoGrid">
                  <div className="tradeOrderInfoRow"><span>Margin</span><strong>{fmt(summary?.availableMargin, 3)}</strong></div>
                  <div className="tradeOrderInfoRow"><span>Equity</span><strong>{fmt(summary?.equity, 3)}</strong></div>
                  <div className="tradeOrderInfoRow"><span>Last</span><strong>{fmt(ticker?.last, 4)}</strong></div>
                  <div className="tradeOrderInfoRow"><span>Mark</span><strong>{fmt(ticker?.mark, 4)}</strong></div>
                  <div className="tradeOrderInfoRow"><span>Bid / Ask</span><strong>{fmt(ticker?.bid, 4)} / {fmt(ticker?.ask, 4)}</strong></div>
                </div>

                <div className="tradeOrderSelectedAccount">
                  {selectedAccount ? `${selectedAccount.exchange.toUpperCase()} - ${selectedAccount.label}` : "-"}
                </div>
              </div>
            </article>
          </section>

          <section className="card" style={{ padding: 12, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Positions</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Symbol filter: {selectedSymbol}</div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: "8px 6px" }}>Side</th>
                    <th style={{ padding: "8px 6px" }}>Size</th>
                    <th style={{ padding: "8px 6px" }}>Entry</th>
                    <th style={{ padding: "8px 6px" }}>Mark</th>
                    <th style={{ padding: "8px 6px" }}>PnL</th>
                    <th style={{ padding: "8px 6px" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 10, color: "var(--muted)" }}>No open positions.</td>
                    </tr>
                  ) : (
                    positions.map((position, index) => (
                      <tr key={`${position.side}_${index}`} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                        <td style={{ padding: "8px 6px", color: position.side === "long" ? "#34d399" : "#f87171" }}>{position.side.toUpperCase()}</td>
                        <td style={{ padding: "8px 6px" }}>{fmt(position.size, 6)}</td>
                        <td style={{ padding: "8px 6px" }}>{fmt(position.entryPrice, 4)}</td>
                        <td style={{ padding: "8px 6px" }}>{fmt(position.markPrice, 4)}</td>
                        <td style={{ padding: "8px 6px", color: (position.unrealizedPnl ?? 0) >= 0 ? "#34d399" : "#f87171" }}>
                          {fmt(position.unrealizedPnl, 2)}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          <button className="btn" onClick={() => void closePosition(position.side)}>Close</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" style={{ padding: 12, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Open Orders</div>
              <button className="btn" onClick={() => void cancelAll()}>Cancel All</button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: "8px 6px" }}>Order ID</th>
                    <th style={{ padding: "8px 6px" }}>Side</th>
                    <th style={{ padding: "8px 6px" }}>Type</th>
                    <th style={{ padding: "8px 6px" }}>Price</th>
                    <th style={{ padding: "8px 6px" }}>Qty</th>
                    <th style={{ padding: "8px 6px" }}>Status</th>
                    <th style={{ padding: "8px 6px" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 10, color: "var(--muted)" }}>No open orders.</td>
                    </tr>
                  ) : (
                    openOrders.map((order) => (
                      <tr key={order.orderId} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                        <td style={{ padding: "8px 6px" }}>{order.orderId.slice(0, 12)}...</td>
                        <td style={{ padding: "8px 6px" }}>{order.side ?? "-"}</td>
                        <td style={{ padding: "8px 6px" }}>{order.type ?? "-"}</td>
                        <td style={{ padding: "8px 6px" }}>{fmt(order.price, 4)}</td>
                        <td style={{ padding: "8px 6px" }}>{fmt(order.qty, 6)}</td>
                        <td style={{ padding: "8px 6px" }}>{order.status ?? "-"}</td>
                        <td style={{ padding: "8px 6px" }}>
                          <button className="btn" onClick={() => void cancelOrder(order.orderId)}>Cancel</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {isQtyModeModalOpen ? (
        <div className="tradeModalBackdrop" onClick={() => setIsQtyModeModalOpen(false)}>
          <div className="tradeModalCard" onClick={(event) => event.stopPropagation()}>
            <div className="tradeModalHeader">
              <h3>Futures unit setting</h3>
              <button
                type="button"
                className="tradeModalCloseBtn"
                onClick={() => setIsQtyModeModalOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="tradeModalOptions">
              {QTY_INPUT_MODE_OPTIONS.map((option) => {
                const unit = option.unit === "BASE" ? baseAssetUnit : option.unit;
                const isSelected = qtyInputModeDraft === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`tradeModalOption ${isSelected ? "tradeModalOptionActive" : ""}`}
                    onClick={() => setQtyInputModeDraft(option.value)}
                  >
                    <div className="tradeModalOptionTitle">
                      {option.title}-{unit}
                    </div>
                    <div className="tradeModalOptionDescription">{option.description}</div>
                  </button>
                );
              })}
            </div>

            <div className="tradeModalActions">
              <button
                type="button"
                className="tradeModalSecondaryBtn"
                onClick={() => setIsQtyModeModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="tradeModalPrimaryBtn"
                onClick={() => {
                  setQtyInputMode(qtyInputModeDraft);
                  setQtyPercent(0);
                  setQty("");
                  setIsQtyModeModalOpen(false);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={<div>Loading trade page…</div>}>
      <TradePageContent />
    </Suspense>
  );
}
