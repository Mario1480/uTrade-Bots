"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiDel, apiGet, apiPost, apiPut } from "../../../../lib/api";
import { ConfigForm } from "../config-form";
import { LiveView } from "../live-view";
import { NotificationsForm } from "../notifications-form";
import { useSystemSettings } from "../../../components/SystemBanner";

type AiSuggestion = {
  severity: "info" | "warning" | "critical";
  category: string;
  title: string;
  message: string;
  recommendation: string;
  confidence?: "low" | "medium" | "high";
  evidence?: Record<string, any>;
  suggestedConfig?: {
    mm?: Record<string, any>;
    vol?: Record<string, any>;
    risk?: Record<string, any>;
  };
  impactEstimate?: {
    expectedSpreadChangePct?: number;
    expectedInventoryDriftReduction?: "low" | "medium" | "high";
    expectedVolumeProgress?: "low" | "medium" | "high";
  };
};

type AiSuggestionsResponse = {
  range: "24h" | "7d";
  generatedAt: string;
  healthScore: number;
  aiEnabled: boolean;
  suggestions: AiSuggestion[];
  warning?: string;
};

const ADVANCED_MM_DEFAULTS = {
  mmRepriceMs: 15000,
  mmRepricePct: 0.01,
  mmPriceEpsPct: 0.005,
  mmQtyEpsPct: 0.02,
  mmInvAlpha: 0.1
};

const ADVANCED_VOL_DEFAULTS = {
  volCooldownMs: 60000,
  volActiveTtlMs: 20000,
  volMmSafetyMult: 1.5,
  volLastBandPct: 0.0001,
  volInsideSpreadPct: 0.00005,
  volLastMinBumpAbs: 0.00000001,
  volLastMinBumpPct: 0,
  volBuyTicks: 2,
  volSellTicks: 2
};

export default function BotPage() {
  const params = useParams();
  const id = params.id as string; // ✅ korrekt für Next 15

  const [bot, setBot] = useState<any>(null);
  const [rt, setRt] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [saving, setSaving] = useState("");
  const [toggling, setToggling] = useState("");

  const [mm, setMm] = useState<any>(null);
  const [vol, setVol] = useState<any>(null);
  const [risk, setRisk] = useState<any>(null);
  const [notify, setNotify] = useState<any>(null);
  const [priceSupport, setPriceSupport] = useState<any>(null);
  const [priceFollow, setPriceFollow] = useState<any>(null);
  const [dexPriceFeed, setDexPriceFeed] = useState<any>(null);
  const [dexDeviation, setDexDeviation] = useState<any>(null);
  const [priceSourceMode, setPriceSourceMode] = useState<string>("CEX");
  const [preview, setPreview] = useState<{
    mid: number;
    bids: any[];
    asks: any[];
    inventoryRatio?: number;
    skewPct?: number;
    skewedMid?: number;
  } | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMidOverride, setPreviewMidOverride] = useState("");
  const [includeJitter, setIncludeJitter] = useState(false);
  const [previewSeed, setPreviewSeed] = useState("");
  const [aiRange, setAiRange] = useState<"24h" | "7d">("24h");
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestionsResponse | null>(null);
  const [aiSuggestionsError, setAiSuggestionsError] = useState<string | null>(null);
  const [aiSuggestionsLoading, setAiSuggestionsLoading] = useState(false);
  const [aiExpanded, setAiExpanded] = useState<number | null>(null);
  const [aiPreview, setAiPreview] = useState<Record<string, { before?: any; after?: any; loading?: boolean; error?: string }>>({});
  const [fieldErrors, setFieldErrors] = useState<{
    budgetQuoteUsdt?: string;
    budgetBaseToken?: string;
    dexTokenAddress?: string;
    dexMaxDeviationBps?: string;
    priceSourceMode?: string;
  } | null>(null);

  const [toast, setToast] = useState<{ type: "error" | "success"; msg: string } | null>(null);
  const [baseline, setBaseline] = useState<{
    mm: any;
    vol: any;
    risk: any;
    notify: any;
    priceFollow: any;
    dexPriceFeed: any;
    dexDeviation: any;
    priceSourceMode: string;
  } | null>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");
  const [presetBindSymbol, setPresetBindSymbol] = useState(true);
  const [presetFilterMatch, setPresetFilterMatch] = useState(true);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetsError, setPresetsError] = useState("");
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [importName, setImportName] = useState("");
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const systemSettings = useSystemSettings();
  const isReadOnly = systemSettings.readOnlyMode;

  function showToast(type: "error" | "success", msg: string) {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 3000);
  }

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  async function loadAll() {
    try {
      const [b, meRes] = await Promise.all([
        apiGet<any>(`/bots/${id}`),
        apiGet<any>("/auth/me")
      ]);
      setBot(b);
      setMm(b.mmConfig);
      setVol(b.volConfig);
      setRisk(b.riskConfig);
      setNotify(b.notificationConfig ?? { fundsWarnEnabled: true, fundsWarnPct: 0.1 });
      setPriceSupport(b.priceSupportConfig ?? null);
      const follow = {
        enabled: Boolean(b.priceFollowEnabled),
        priceSourceExchange: b.priceSourceExchange ?? b.exchange ?? "",
        priceSourceSymbol: b.priceSourceSymbol ?? b.symbol ?? "",
        priceSourceType: b.priceSourceType ?? "TICKER"
      };
      const dexFeed = {
        enabled: Boolean(b.dexPriceFeedEnabled),
        chain: b.dexChain ?? "ethereum",
        tokenAddress: b.dexTokenAddress ?? "",
        cacheTtlMs: b.dexCacheTtlMs ?? 3000,
        staleAfterMs: b.dexStaleAfterMs ?? 15000
      };
      const dexDev = {
        enabled: Boolean(b.dexDeviationEnabled),
        maxDeviationBps: b.dexMaxDeviationBps ?? 0,
        policy: b.dexDeviationPolicy ?? "alertOnly",
        notifyCooldownSec: b.dexNotifyCooldownSec ?? 300
      };
      const priceSourceModeValue = b.priceSourceMode ?? "CEX";
      setPriceFollow(follow);
      setDexPriceFeed(dexFeed);
      setDexDeviation(dexDev);
      setPriceSourceMode(priceSourceModeValue);
      setMe(meRes);
      setBaseline({
        mm: b.mmConfig,
        vol: b.volConfig,
        risk: b.riskConfig,
        notify: b.notificationConfig ?? { fundsWarnEnabled: true, fundsWarnPct: 0.1 },
        priceFollow: follow,
        dexPriceFeed: dexFeed,
        dexDeviation: dexDev,
        priceSourceMode: priceSourceModeValue
      });
      await loadPresets(meRes, b, presetFilterMatch);
    } catch (e) {
      showToast("error", errMsg(e));
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

  useEffect(() => {
    if (!id) return;
    loadAll();
    loadRuntime();
    const t = setInterval(loadRuntime, 1200);
    return () => clearInterval(t);
  }, [id]);

  const ready = useMemo(
    () => !!(mm && vol && risk && notify && priceFollow && dexPriceFeed && dexDeviation && priceSourceMode && baseline),
    [mm, vol, risk, notify, priceFollow, dexPriceFeed, dexDeviation, priceSourceMode, baseline]
  );
  const dirty = useMemo(() => {
    if (!baseline || !mm || !vol || !risk || !notify || !priceFollow || !dexPriceFeed || !dexDeviation || !priceSourceMode) {
      return false;
    }
    // simple deep compare via stable JSON stringify
    const a = JSON.stringify({ mm, vol, risk, notify, priceFollow, dexPriceFeed, dexDeviation, priceSourceMode });
    const b = JSON.stringify(baseline);
    return a !== b;
  }, [baseline, mm, vol, risk, notify, priceFollow, dexPriceFeed, dexDeviation, priceSourceMode]);
  const dirtyMm = useMemo(() => {
    if (!baseline || !mm) return false;
    return JSON.stringify(mm) !== JSON.stringify(baseline.mm);
  }, [baseline, mm]);
  const dirtyVol = useMemo(() => {
    if (!baseline || !vol) return false;
    return JSON.stringify(vol) !== JSON.stringify(baseline.vol);
  }, [baseline, vol]);
  const dirtyRisk = useMemo(() => {
    if (!baseline || !risk) return false;
    return JSON.stringify(risk) !== JSON.stringify(baseline.risk);
  }, [baseline, risk]);
  const dirtyPriceFollow = useMemo(() => {
    if (!baseline || !priceFollow) return false;
    return JSON.stringify(priceFollow) !== JSON.stringify(baseline.priceFollow);
  }, [baseline, priceFollow]);
  const dirtyDex = useMemo(() => {
    if (!baseline || !dexPriceFeed || !dexDeviation || !priceSourceMode) return false;
    const current = JSON.stringify({ dexPriceFeed, dexDeviation, priceSourceMode });
    const base = JSON.stringify({
      dexPriceFeed: baseline.dexPriceFeed,
      dexDeviation: baseline.dexDeviation,
      priceSourceMode: baseline.priceSourceMode
    });
    return current !== base;
  }, [baseline, dexPriceFeed, dexDeviation, priceSourceMode]);
  const dirtyNotify = useMemo(() => {
    if (!baseline || !notify) return false;
    return JSON.stringify(notify) !== JSON.stringify(baseline.notify);
  }, [baseline, notify]);

  const canSave = ready && dirty && saving !== "saving..." && !isReadOnly;
  const mmSaveLabel = saving === "saving..." ? "Saving..." : dirtyMm ? "Save Config" : "Saved";
  const volSaveLabel = saving === "saving..." ? "Saving..." : dirtyVol ? "Save Config" : "Saved";
  const riskSaveLabel = saving === "saving..." ? "Saving..." : dirtyRisk ? "Save Config" : "Saved";
  const priceFollowSaveLabel = saving === "saving..." ? "Saving..." : dirtyPriceFollow ? "Save Config" : "Saved";
  const dexSaveLabel = saving === "saving..." ? "Saving..." : dirtyDex ? "Save Config" : "Saved";
  const notifySaveLabel = saving === "saving..." ? "Saving..." : dirtyNotify ? "Save Config" : "Saved";
  const canViewPresets = Boolean(me?.permissions?.["presets.view"] || me?.isSuperadmin);
  const canCreatePresets = Boolean(me?.permissions?.["presets.create"] || me?.isSuperadmin) && !isReadOnly;
  const canApplyPresets = Boolean(me?.permissions?.["presets.apply"] || me?.isSuperadmin) && !isReadOnly;
  const canDeletePresets = Boolean(me?.permissions?.["presets.delete"] || me?.isSuperadmin) && !isReadOnly;
  const canEditConfig = Boolean(me?.permissions?.["bots.edit_config"] || me?.isSuperadmin) && !isReadOnly;
  const canEditAdvanced = Boolean(me?.isSuperadmin) && !isReadOnly;
  const canSavePriceFollow = ready && dirtyPriceFollow && saving !== "saving..." && !isReadOnly;
  const canSaveDex = ready && dirtyDex && saving !== "saving..." && !isReadOnly;
  const canSaveNotify = ready && dirtyNotify && saving !== "saving..." && !isReadOnly;
  const dexFeatureEnabled = Boolean(me?.features?.dexPriceFeed);
  const dexControlsDisabled = !dexFeatureEnabled || !canEditConfig;
  const aiFeatureEnabled = Boolean(me?.features?.aiRecommendations);
  const exchangeOptions = useMemo(() => {
    const list = [bot?.exchange, priceFollow?.priceSourceExchange, "bitmart", "coinstore", "pionex", "p2b"]
      .filter(Boolean)
      .map((v) => String(v));
    return Array.from(new Set(list));
  }, [bot?.exchange, priceFollow?.priceSourceExchange]);

  async function save() {
    if (!canSave) return;
    try {
      setSaving("saving...");
      setFieldErrors(null);
      await apiPut(`/bots/${id}/config`, { mm, vol, risk, notify, priceFollow, dexPriceFeed, dexDeviation, priceSourceMode });
      setBaseline({ mm, vol, risk, notify, priceFollow, dexPriceFeed, dexDeviation, priceSourceMode });
      setSaving("saved");
      showToast("success", "Config saved");
      setTimeout(() => setSaving(""), 1200);
    } catch (e) {
      setSaving("");
      if (e instanceof ApiError && e.payload?.details?.errors) {
        setFieldErrors(e.payload?.details?.errors ?? null);
      }
      showToast("error", errMsg(e));
    }
  }

  async function start() {
    try {
      await apiPost(`/bots/${id}/start`);
      showToast("success", "Bot started");
      await loadAll();
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }
  async function pause() {
    try {
      await apiPost(`/bots/${id}/pause`);
      showToast("success", "Bot paused");
      await loadAll();
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }
  async function stop() {
    try {
      await apiPost(`/bots/${id}/stop`);
      showToast("success", "Bot stopped");
      await loadAll();
    } catch (e) {
      showToast("error", errMsg(e));
    }
  }

  async function startMm() {
    try {
      setToggling("mm");
      await apiPost(`/bots/${id}/mm/start`);
      await loadAll();
    } catch (e) {
      showToast("error", errMsg(e));
    } finally {
      setToggling("");
    }
  }

  async function stopMm() {
    try {
      setToggling("mm");
      await apiPost(`/bots/${id}/mm/stop`);
      await loadAll();
    } catch (e) {
      showToast("error", errMsg(e));
    } finally {
      setToggling("");
    }
  }

  async function startVol() {
    try {
      setToggling("vol");
      await apiPost(`/bots/${id}/vol/start`);
      await loadAll();
    } catch (e) {
      showToast("error", errMsg(e));
    } finally {
      setToggling("");
    }
  }

  async function stopVol() {
    try {
      setToggling("vol");
      await apiPost(`/bots/${id}/vol/stop`);
      await loadAll();
    } catch (e) {
      showToast("error", errMsg(e));
    } finally {
      setToggling("");
    }
  }

  function toPresetPriceSupport(ps: any) {
    if (!ps) return undefined;
    return {
      enabled: Boolean(ps.enabled),
      floorPrice: ps.floorPrice ?? null,
      budgetUsdt: Number(ps.budgetUsdt ?? 0),
      maxOrderUsdt: Number(ps.maxOrderUsdt ?? 0),
      cooldownMs: Number(ps.cooldownMs ?? 0),
      mode: ps.mode ?? "PASSIVE"
    };
  }

  async function loadPresets(meRes?: any, botRes?: any, onlyMatch?: boolean) {
    const meLocal = meRes ?? me;
    const botLocal = botRes ?? bot;
    if (!meLocal || !botLocal) return;
    const allowed = Boolean(meLocal?.permissions?.["presets.view"] || meLocal?.isSuperadmin);
    if (!allowed) return;

    setPresetsLoading(true);
    setPresetsError("");
    try {
      const params = new URLSearchParams();
      const match = onlyMatch ?? presetFilterMatch;
      if (match) {
        params.set("exchange", botLocal.exchange);
        params.set("symbol", botLocal.symbol);
      }
      const list = await apiGet<any[]>(`/presets${params.toString() ? `?${params.toString()}` : ""}`);
      setPresets(list);
    } catch (e) {
      setPresetsError(errMsg(e));
    } finally {
      setPresetsLoading(false);
    }
  }

  async function savePreset() {
    if (!canCreatePresets || !presetName.trim()) return;
    setPresetsError("");
    try {
      const payload: any = {
        mm,
        vol,
        risk
      };
      const ps = toPresetPriceSupport(priceSupport);
      if (ps) payload.priceSupport = ps;
      const bind = presetBindSymbol;
      await apiPost("/presets", {
        name: presetName.trim(),
        description: presetDescription.trim() || undefined,
        exchange: bind ? bot.exchange : undefined,
        symbol: bind ? bot.symbol : undefined,
        payload
      });
      setPresetName("");
      setPresetDescription("");
      await loadPresets();
      showToast("success", "Preset saved");
    } catch (e) {
      setPresetsError(errMsg(e));
    }
  }

  async function applyPreset(presetId: string, name: string) {
    if (!canApplyPresets) return;
    if (!confirm(`Apply preset "${name}" to this bot? This will overwrite current configs.`)) return;
    setPresetsError("");
    try {
      await apiPost(`/bots/${id}/presets/${presetId}/apply`, {});
      await loadAll();
      showToast("success", "Preset applied");
    } catch (e) {
      setPresetsError(errMsg(e));
    }
  }

  async function deletePreset(presetId: string, name: string) {
    if (!canDeletePresets) return;
    if (!confirm(`Delete preset "${name}"?`)) return;
    setPresetsError("");
    try {
      await apiDel(`/presets/${presetId}`);
      await loadPresets();
      showToast("success", "Preset deleted");
    } catch (e) {
      setPresetsError(errMsg(e));
    }
  }

  function downloadJsonFile(name: string, payload: any) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportPreset(presetId: string, name: string) {
    try {
      const data = await apiGet<any>(`/presets/${presetId}/export`);
      downloadJsonFile(name || "preset", data);
    } catch (e) {
      setPresetsError(errMsg(e));
    }
  }

  async function exportCurrentConfig() {
    try {
      const data = await apiGet<any>(`/bots/${id}/config/export`);
      downloadJsonFile(data?.name ?? bot?.name ?? "bot-config", data);
    } catch (e) {
      setPresetsError(errMsg(e));
    }
  }

  function handleImportFile(file: File) {
    if (!file) return;
    setImportError("");
    if (file.size > 200 * 1024) {
      setImportError("File too large (max 200KB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        if (!parsed || parsed.kind !== "BotConfigPreset" || parsed.version !== 1) {
          setImportError("Invalid preset file.");
          setImportPreview(null);
          return;
        }
        setImportPreview(parsed);
        setImportName(parsed.name ?? "");
        setImportOverwrite(false);
      } catch (e) {
        setImportError("Invalid JSON file.");
        setImportPreview(null);
      }
    };
    reader.readAsText(file);
  }

  async function importPreset() {
    if (!importPreview || !canCreatePresets) return;
    setImportError("");
    setImportBusy(true);
    try {
      await apiPost("/presets/import", {
        file: importPreview,
        overrideName: importName?.trim() || undefined,
        overwrite: importOverwrite
      });
      setImportPreview(null);
      setImportName("");
      setImportOverwrite(false);
      await loadPresets();
      showToast("success", "Preset imported");
    } catch (e) {
      if (e instanceof ApiError && e.payload?.error === "PRESET_NAME_EXISTS") {
        setImportError("Preset name already exists. Enable overwrite to replace it.");
      } else {
        setImportError(errMsg(e));
      }
    } finally {
      setImportBusy(false);
    }
  }

  function resolveMid(): number | null {
    const raw = previewMidOverride.trim();
    if (raw) {
      const n = Number(raw.replace(",", "."));
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return rt?.mid ?? null;
  }

  async function loadAiSuggestions() {
    if (!aiFeatureEnabled) return;
    setAiSuggestionsLoading(true);
    setAiSuggestionsError(null);
    try {
      const res = await apiGet<AiSuggestionsResponse>(`/bots/${id}/ai/suggestions?range=${aiRange}`);
      setAiSuggestions(res);
    } catch (e) {
      setAiSuggestionsError(errMsg(e));
    } finally {
      setAiSuggestionsLoading(false);
    }
  }

  function applySuggestedConfig(suggested?: AiSuggestion["suggestedConfig"]) {
    if (!suggested || !canEditConfig) return;
    if (!confirm("Apply AI suggested changes to draft? This will not save until you click Save Config.")) return;
    if (suggested.mm) setMm((prev: any) => ({ ...prev, ...suggested.mm }));
    if (suggested.vol) setVol((prev: any) => ({ ...prev, ...suggested.vol }));
    if (suggested.risk) setRisk((prev: any) => ({ ...prev, ...suggested.risk }));
    showToast("success", "AI changes applied to draft (not saved).");
  }

  async function loadAiPreview(idx: number, suggestedMm?: Record<string, any>) {
    if (!suggestedMm || !mm) return;
    const mid = resolveMid();
    const key = String(idx);
    if (!mid) {
      setAiPreview((prev) => ({ ...prev, [key]: { error: "Mid price missing for preview." } }));
      return;
    }
    setAiPreview((prev) => ({ ...prev, [key]: { ...prev[key], loading: true, error: undefined } }));
    try {
      const runtime = { mid, freeUsdt: rt?.freeUsdt ?? 0, freeBase: rt?.freeBase ?? 0 };
      const [before, after] = await Promise.all([
        apiPost<any>(`/bots/${id}/preview/mm`, {
          mm,
          runtime,
          options: { includeJitter: false, seed: 1 }
        }),
        apiPost<any>(`/bots/${id}/preview/mm`, {
          mm: { ...mm, ...suggestedMm },
          runtime,
          options: { includeJitter: false, seed: 1 }
        })
      ]);
      setAiPreview((prev) => ({ ...prev, [key]: { before, after, loading: false } }));
    } catch (e) {
      setAiPreview((prev) => ({ ...prev, [key]: { loading: false, error: errMsg(e) } }));
    }
  }

  async function loadPreview() {
    if (!mm) return;
    const mid = resolveMid();
    if (!mid) {
      setPreview(null);
      setPreviewErr("Mid price missing. Enter a Mid override.");
      return;
    }
    setPreviewLoading(true);
    setPreviewErr(null);
    try {
      const seedRaw = previewSeed.trim();
      const seedNum = seedRaw ? Number(seedRaw) : null;
      const seed = Number.isFinite(seedNum as number) ? (seedNum as number) : undefined;

      const p = await apiPost<any>(`/bots/${id}/preview/mm`, {
        mm,
        runtime: { mid, freeUsdt: rt?.freeUsdt ?? 0, freeBase: rt?.freeBase ?? 0 },
        options: { includeJitter, seed }
      });
      setPreview(p);
    } catch (e) {
      setPreview(null);
      setPreviewErr(errMsg(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (!id || !mm) return;
    const t = setTimeout(() => {
      loadPreview();
    }, 400);
    return () => clearTimeout(t);
  }, [id, mm, previewMidOverride, includeJitter, previewSeed, rt?.mid, rt?.freeUsdt, rt?.freeBase]);

  useEffect(() => {
    if (!id || !aiFeatureEnabled) return;
    loadAiSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, aiRange, aiFeatureEnabled]);

  if (!bot || !mm || !vol || !risk || !notify) return <div>Loading…</div>;
  const showPriceSupport = Boolean(me?.features?.priceSupport);
  const showPriceFollow = Boolean(me?.features?.priceFollow);

  return (
    <div>
      <h2 style={{ margin: 0, textAlign: "center" }}>Settings</h2>
      <div style={{ marginBottom: 10, marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/" className="btn">
          ← Back to dashboard
        </Link>
        <Link href={`/bots/${id}`} className="btn">
          Overview →
        </Link>
        {showPriceSupport ? (
          <Link href={`/bots/${id}/price-support`} className="btn">
            Price Support →
          </Link>
        ) : null}
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
      <div className="adminHeader" style={{ alignItems: "baseline" }}>
        <div>
          <h2 style={{ margin: 0 }}>{bot.name}</h2>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {bot.exchange} · {bot.symbol}
            {dirty ? (
              <span style={{ marginLeft: 8, padding: "2px 6px", border: "1px solid #f0c36d", borderRadius: 999, fontSize: 11 }}>
                Unsaved changes
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          <div>Bot status: <b>{bot.status}</b></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>MM:</span>
            <span className={`badge ${bot.mmEnabled ? "badgeOk" : "badgeWarn"}`}>
              {bot.mmEnabled ? "enabled" : "disabled"}
            </span>
            <span>Volume:</span>
            <span className={`badge ${bot.volEnabled ? "badgeOk" : "badgeWarn"}`}>
              {bot.volEnabled ? "enabled" : "disabled"}
            </span>
            <span style={{ opacity: 0.7 }}></span>
          </div>
          <div>Runtime: <b>{rt?.status ?? "—"}</b>{rt?.reason ? ` — ${rt.reason}` : ""}</div>
        </div>
      </div>

      <div className="gridTwoCol" style={{ margin: "12px 0", alignItems: "stretch" }}>
        <div className="card" style={{ padding: 12, height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Runner controls</div>
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>
          Starts, pauses, or stops the main trading loop for this bot.
        </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
            <button
              onClick={start}
              disabled={saving === "saving..." || isReadOnly}
              className={`btn btnStart ${saving === "saving..." || isReadOnly ? "btnDisabled" : ""}`}
            >
              Start
            </button>
            <button
              onClick={pause}
              disabled={saving === "saving..." || isReadOnly}
              className={`btn btnPause ${saving === "saving..." || isReadOnly ? "btnDisabled" : ""}`}
            >
              Pause
            </button>
            <button
              onClick={stop}
              disabled={saving === "saving..." || isReadOnly}
              className={`btn btnStop ${saving === "saving..." || isReadOnly ? "btnDisabled" : ""}`}
            >
              Stop
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 12, height: "100%", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Strategy controls (MM and Volume run independently)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: "auto" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Market Making</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  onClick={startMm}
                  disabled={toggling === "mm" || bot.mmEnabled === true || isReadOnly}
                  className={`btn btnStart ${toggling === "mm" || bot.mmEnabled || isReadOnly ? "btnDisabled" : ""}`}
                  title="Start market making only (volume stays as is)"
                >
                  Start
                </button>
                <button
                  onClick={stopMm}
                  disabled={toggling === "mm" || bot.mmEnabled === false || isReadOnly}
                  className={`btn btnStop ${toggling === "mm" || !bot.mmEnabled || isReadOnly ? "btnDisabled" : ""}`}
                  title="Stop market making only (volume stays as is)"
                >
                  Stop
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Volume Bot</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  onClick={startVol}
                  disabled={toggling === "vol" || bot.volEnabled === true || isReadOnly}
                  className={`btn btnStart ${toggling === "vol" || bot.volEnabled || isReadOnly ? "btnDisabled" : ""}`}
                  title="Start volume bot only (MM stays as is)"
                >
                  Start
                </button>
                <button
                  onClick={stopVol}
                  disabled={toggling === "vol" || bot.volEnabled === false || isReadOnly}
                  className={`btn btnStop ${toggling === "vol" || !bot.volEnabled || isReadOnly ? "btnDisabled" : ""}`}
                  title="Stop volume bot only (MM stays as is)"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <LiveView
          runtime={rt}
          baseSymbol={bot?.symbol?.split(/[/_-]/)[0]}
          isSuperadmin={Boolean(me?.isSuperadmin)}
          showDex={
            dexFeatureEnabled &&
            (bot?.dexPriceFeedEnabled ||
              bot?.dexDeviationEnabled ||
              (bot?.priceSourceMode ?? "CEX") !== "CEX")
          }
        />
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h3 style={{ marginTop: 0 }}>Order book preview</h3>
          <button className="btn" onClick={loadPreview} disabled={previewLoading}>
            {previewLoading ? "Updating..." : "Update preview"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Mid override</span>
            <input
              className="input"
              placeholder={rt?.mid ? String(rt.mid) : "0.0000"}
              value={previewMidOverride}
              onChange={(e) => setPreviewMidOverride(e.target.value)}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Seed (optional)</span>
            <input
              className="input"
              placeholder="e.g. 42"
              value={previewSeed}
              onChange={(e) => setPreviewSeed(e.target.value)}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={includeJitter}
              onChange={(e) => setIncludeJitter(e.target.checked)}
            />
            Include jitter
          </label>
        </div>

        {previewErr ? (
          <div style={{ fontSize: 12, color: "#fca5a5", marginBottom: 8 }}>{previewErr}</div>
        ) : null}

        <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
          Mid: {formatNum(preview?.mid ?? resolveMid() ?? null, 8)}
          {preview?.skewPct !== undefined ? (
            <span>
              {" "}
              • Inventory skew: {preview.skewPct >= 0 ? "+" : ""}
              {preview.skewPct.toFixed(2)}% (ratio {formatNum(preview.inventoryRatio, 2)})
            </span>
          ) : null}
        </div>
        <div className="gridTwoCol">
          <PreviewTable title="Asks" rows={preview?.asks ?? []} accent="#ef4444" />
          <PreviewTable title="Bids" rows={preview?.bids ?? []} accent="#22c55e" />
        </div>
      </div>

      {canViewPresets ? (
        <AccordionSection title="Presets">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ marginTop: 0 }}>Presets</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={presetFilterMatch}
                  onChange={async (e) => {
                    const next = e.target.checked;
                    setPresetFilterMatch(next);
                    await loadPresets(undefined, undefined, next);
                  }}
                />
                Only this symbol
              </label>
              <button className="btn" onClick={exportCurrentConfig}>
                Export current config
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))"
            }}
          >
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Save current config</div>
              <label style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Name</span>
                <input
                  className="input"
                  placeholder="e.g. Tight Spread"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  disabled={!canCreatePresets}
                />
              </label>
              <label style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Description (optional)</span>
                <input
                  className="input"
                  placeholder="Notes for this preset"
                  value={presetDescription}
                  onChange={(e) => setPresetDescription(e.target.value)}
                  disabled={!canCreatePresets}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={presetBindSymbol}
                  onChange={(e) => setPresetBindSymbol(e.target.checked)}
                  disabled={!canCreatePresets}
                />
                Bind to this symbol
              </label>
              <button
                className={`btn btnPrimary ${!canCreatePresets || !presetName.trim() ? "btnDisabled" : ""}`}
                style={{ marginTop: 10 }}
                onClick={savePreset}
                disabled={!canCreatePresets || !presetName.trim()}
              >
                Save preset
              </button>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Saved presets</div>
              {presetsLoading ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading presets…</div>
              ) : presets.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>No presets yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {presets.map((preset) => (
                    <div
                      key={preset.id}
                      style={{
                        border: "1px solid rgba(255,255,255,.08)",
                        borderRadius: 10,
                        padding: 10,
                        display: "grid",
                        gap: 6
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 700 }}>{preset.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          {formatDate(preset.createdAt)}
                        </div>
                      </div>
                      {preset.description ? (
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{preset.description}</div>
                      ) : null}
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {preset.createdBy?.email ?? "unknown"} · {preset.exchange ?? "any"} · {preset.symbol ?? "any"}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          className={`btn btnPrimary ${!canApplyPresets ? "btnDisabled" : ""}`}
                          onClick={() => applyPreset(preset.id, preset.name)}
                          disabled={!canApplyPresets}
                        >
                          Apply
                        </button>
                        <button className="btn" onClick={() => exportPreset(preset.id, preset.name)}>
                          Export JSON
                        </button>
                        {canDeletePresets ? (
                          <button className="btn btnStop" onClick={() => deletePreset(preset.id, preset.name)}>
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 12, marginTop: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Import preset</div>
            <input
              className="input"
              type="file"
              accept=".json,application/json"
              disabled={!canCreatePresets}
              onChange={(e) => handleImportFile(e.target.files?.[0] as File)}
            />
            {importPreview ? (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Detected: {importPreview.exchange ?? "any"} · {importPreview.symbol ?? "any"}
                </div>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Preset name</span>
                  <input
                    className="input"
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                    disabled={!canCreatePresets}
                  />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={importOverwrite}
                    onChange={(e) => setImportOverwrite(e.target.checked)}
                    disabled={!canDeletePresets}
                  />
                  Overwrite if name exists
                </label>
                <button
                  className={`btn btnPrimary ${!canCreatePresets || importBusy ? "btnDisabled" : ""}`}
                  onClick={importPreset}
                  disabled={!canCreatePresets || importBusy}
                >
                  {importBusy ? "Importing..." : "Import preset"}
                </button>
              </div>
            ) : null}
            {importError ? (
              <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 8 }}>{importError}</div>
            ) : null}
          </div>

          {presetsError ? (
            <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 10 }}>{presetsError}</div>
          ) : null}
        </AccordionSection>
      ) : (
        <AccordionSection title="Presets">
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Presets are disabled for your role.
          </div>
        </AccordionSection>
      )}

      <div>
        <ConfigForm
          mm={mm}
          vol={vol}
          risk={risk}
          onMmChange={(next) => {
            setMm(next);
            if (fieldErrors) setFieldErrors(null);
          }}
          onVolChange={setVol}
          onRiskChange={setRisk}
          baseSymbol={bot?.symbol?.split(/[/_-]/)[0]}
          midPrice={rt?.mid ?? null}
          isSuperadmin={Boolean(me?.isSuperadmin)}
          errors={fieldErrors}
          onSave={save}
          canSaveMm={ready && dirtyMm && saving !== "saving..." && canEditConfig}
          canSaveVol={ready && dirtyVol && saving !== "saving..." && canEditConfig}
          canSaveRisk={ready && dirtyRisk && saving !== "saving..." && canEditConfig}
          saveLabelMm={mmSaveLabel}
          saveLabelVol={volSaveLabel}
          saveLabelRisk={riskSaveLabel}
        />
      </div>

      {aiFeatureEnabled ? (
        <AccordionSection title="AI Suggestions (Read‑Only)">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {(["24h", "7d"] as const).map((r) => (
                <button
                  key={r}
                  className={`btn ${aiRange === r ? "btnPrimary" : ""}`}
                  onClick={() => setAiRange(r)}
                  disabled={aiSuggestionsLoading}
                >
                  {r}
                </button>
              ))}
              <button className="btn" onClick={loadAiSuggestions} disabled={aiSuggestionsLoading}>
                {aiSuggestionsLoading ? "Refreshing..." : "Refresh"}
              </button>
              <span
                className="badge"
                style={{
                  borderColor: aiSuggestions?.aiEnabled ? "#22c55e" : "#9ca3af",
                  color: aiSuggestions?.aiEnabled ? "#22c55e" : "#9ca3af"
                }}
              >
                {aiSuggestions?.aiEnabled ? "AI enabled" : "AI disabled"}
              </span>
            </div>
          </div>

          {aiSuggestionsError ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "#ff6b6b" }}>{aiSuggestionsError}</div>
          ) : null}

          {!aiSuggestionsError && aiSuggestions?.warning ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "#f59e0b" }}>
              AI unavailable. Showing rule‑based insights only.
            </div>
          ) : null}

          {aiSuggestions && !aiSuggestions.aiEnabled ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              AI is disabled. Suggestions are unavailable.
            </div>
          ) : null}

          {!aiSuggestionsLoading && (aiSuggestions?.suggestions?.length ?? 0) === 0 ? (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
              No AI suggestions available for this range.
            </div>
          ) : null}

          {aiSuggestions?.suggestions?.length ? (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {aiSuggestions.suggestions.map((s, idx) => {
                const key = String(idx);
                const expanded = aiExpanded === idx;
                const diffRows = buildDiffRows(s.suggestedConfig, mm, vol, risk);
                const previewState = aiPreview[key];
                return (
                  <div key={`${s.title}-${idx}`} className="card" style={{ padding: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                      <span className="badge" style={{ borderColor: severityColor(s.severity), color: severityColor(s.severity) }}>
                        {s.severity}
                      </span>
                      {s.confidence ? (
                        <span className="badge" style={{ borderColor: "#64748b", color: "#94a3b8" }}>
                          {s.confidence}
                        </span>
                      ) : null}
                      <div style={{ fontWeight: 700 }}>{s.title}</div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{s.message}</div>
                    <div style={{ marginTop: 6, fontSize: 12 }}>
                      <span style={{ color: "var(--muted)" }}>Recommendation: </span>
                      <span style={{ fontWeight: 600 }}>{s.recommendation}</span>
                    </div>
                    {s.impactEstimate ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                        Impact: {JSON.stringify(s.impactEstimate)}
                      </div>
                    ) : null}
                    {s.evidence ? (
                      <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
                        Evidence: {JSON.stringify(s.evidence)}
                      </div>
                    ) : null}

                    {s.suggestedConfig ? (
                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          className="btn"
                          onClick={() => {
                            const next = expanded ? null : idx;
                            setAiExpanded(next);
                            if (!expanded && s.suggestedConfig?.mm) {
                              loadAiPreview(idx, s.suggestedConfig.mm);
                            }
                          }}
                        >
                          {expanded ? "Hide changes" : "View changes"}
                        </button>
                        <button
                          className={`btn btnPrimary ${!canEditConfig ? "btnDisabled" : ""}`}
                          onClick={() => applySuggestedConfig(s.suggestedConfig)}
                          disabled={!canEditConfig}
                        >
                          Apply to Draft
                        </button>
                      </div>
                    ) : null}

                    {expanded ? (
                      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                        <ConfigDiffTable rows={diffRows} />
                        {s.suggestedConfig?.mm ? (
                          <div className="gridTwoCol">
                            <div className="card" style={{ padding: 10 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Before</div>
                              {previewState?.loading ? (
                                <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading preview…</div>
                              ) : previewState?.error ? (
                                <div style={{ fontSize: 12, color: "#ff6b6b" }}>{previewState.error}</div>
                              ) : (
                                <div className="gridTwoCol">
                                  <PreviewTable title="Asks" rows={previewState?.before?.asks ?? []} accent="#ef4444" />
                                  <PreviewTable title="Bids" rows={previewState?.before?.bids ?? []} accent="#22c55e" />
                                </div>
                              )}
                            </div>
                            <div className="card" style={{ padding: 10 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>After</div>
                              {previewState?.loading ? (
                                <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading preview…</div>
                              ) : previewState?.error ? (
                                <div style={{ fontSize: 12, color: "#ff6b6b" }}>{previewState.error}</div>
                              ) : (
                                <div className="gridTwoCol">
                                  <PreviewTable title="Asks" rows={previewState?.after?.asks ?? []} accent="#ef4444" />
                                  <PreviewTable title="Bids" rows={previewState?.after?.bids ?? []} accent="#22c55e" />
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
            AI provides suggestions only. Changes must be applied manually and saved explicitly.
          </div>
        </AccordionSection>
      ) : null}

      {priceFollow && showPriceFollow ? (
        <AccordionSection title="Price Follow">
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Use a master price feed for pricing while executing orders on the bot exchange.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={Boolean(priceFollow.enabled)}
              onChange={(e) => setPriceFollow({ ...priceFollow, enabled: e.target.checked })}
              disabled={!canEditConfig}
            />
            Enable Price Follow
          </label>
          <div className="gridTwoCol">
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Master exchange</span>
              <select
                className="input"
                value={priceFollow.priceSourceExchange ?? ""}
                onChange={(e) => setPriceFollow({ ...priceFollow, priceSourceExchange: e.target.value })}
                disabled={!canEditConfig}
              >
                {exchangeOptions.map((ex) => (
                  <option key={ex} value={ex}>
                    {ex}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Master symbol</span>
              <input
                className="input"
                value={priceFollow.priceSourceSymbol ?? ""}
                onChange={(e) => setPriceFollow({ ...priceFollow, priceSourceSymbol: e.target.value })}
                disabled={!canEditConfig}
              />
            </label>
          </div>
          <div className="gridTwoCol" style={{ marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Price source type</span>
              <select
                className="input"
                value={priceFollow.priceSourceType ?? "TICKER"}
                onChange={(e) => setPriceFollow({ ...priceFollow, priceSourceType: e.target.value })}
                disabled={!canEditConfig}
              >
                <option value="TICKER">Ticker mid</option>
                <option value="ORDERBOOK_MID">Orderbook mid</option>
              </select>
            </label>
            <div />
          </div>
          {priceFollow.enabled && !priceFollow.priceSourceExchange ? (
            <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 8 }}>
              Master exchange is required when Price Follow is enabled.
            </div>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <button
              className={`btn btnPrimary ${!canSavePriceFollow ? "btnDisabled" : ""}`}
              onClick={save}
              disabled={!canSavePriceFollow}
            >
              {priceFollowSaveLabel}
            </button>
          </div>
        </AccordionSection>
      ) : null}

      {dexPriceFeed && dexDeviation && dexFeatureEnabled ? (
        <AccordionSection title="DEX Price Feed">
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Read-only DEX price reference via Dex Screener (no trading).
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={Boolean(dexPriceFeed.enabled)}
              onChange={(e) => setDexPriceFeed({ ...dexPriceFeed, enabled: e.target.checked })}
              disabled={dexControlsDisabled}
            />
            Enable DEX price feed (Dex Screener)
          </label>
          <div className="gridTwoCol">
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Price source mode</span>
              <select
                className="input"
                value={priceSourceMode ?? "CEX"}
                onChange={(e) => setPriceSourceMode(e.target.value)}
                disabled={dexControlsDisabled}
              >
                <option value="DEXTOOLS">DEX Screener</option>
              </select>
            </label>
            <div />
          </div>
          <div className="gridTwoCol" style={{ marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Chain</span>
              <select
                className="input"
                value={dexPriceFeed.chain ?? "ethereum"}
                onChange={(e) => setDexPriceFeed({ ...dexPriceFeed, chain: e.target.value })}
                disabled={dexControlsDisabled}
              >
                <option value="ethereum">ethereum</option>
                <option value="solana">solana</option>
                <option value="base">base</option>
                <option value="bsc">bsc</option>
                <option value="polygon">polygon</option>
                <option value="ton">ton</option>
                <option value="avalanche">avalanche</option>
                <option value="arbitrum">arbitrum</option>
                <option value="sui">sui</option>
                <option value="cronos">cronos</option>
                <option value="sonic">sonic</option>
                <option value="hedera">hedera</option>
                <option value="tron">tron</option>
                <option value="aptos">aptos</option>
                <option value="algorand">algorand</option>
                <option value="cardano">cardano</option>
                <option value="polkadot">polkadot</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Token address</span>
              <input
                className="input"
                value={dexPriceFeed.tokenAddress ?? ""}
                onChange={(e) => setDexPriceFeed({ ...dexPriceFeed, tokenAddress: e.target.value })}
                disabled={dexControlsDisabled}
                placeholder="0x..."
              />
              {fieldErrors?.dexTokenAddress ? (
                <div style={{ fontSize: 12, color: "#ff6b6b" }}>{fieldErrors.dexTokenAddress}</div>
              ) : null}
            </label>
          </div>
          <div className="gridTwoCol" style={{ marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Cache TTL (ms)</span>
              <input
                className="input"
                type="number"
                min={0}
                value={dexPriceFeed.cacheTtlMs ?? 3000}
                onChange={(e) => setDexPriceFeed({ ...dexPriceFeed, cacheTtlMs: Number(e.target.value) })}
                disabled={dexControlsDisabled}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Stale after (ms)</span>
              <input
                className="input"
                type="number"
                min={0}
                value={dexPriceFeed.staleAfterMs ?? 15000}
                onChange={(e) => setDexPriceFeed({ ...dexPriceFeed, staleAfterMs: Number(e.target.value) })}
                disabled={dexControlsDisabled}
              />
            </label>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
            Deviation monitoring between CEX and DEX.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(dexDeviation.enabled)}
              onChange={(e) => setDexDeviation({ ...dexDeviation, enabled: e.target.checked })}
              disabled={dexControlsDisabled}
            />
            Enable deviation alerts / freeze
          </label>
          <div className="gridTwoCol" style={{ marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Max deviation (bps)</span>
              <input
                className="input"
                type="number"
                min={0}
                value={dexDeviation.maxDeviationBps ?? 0}
                onChange={(e) => setDexDeviation({ ...dexDeviation, maxDeviationBps: Number(e.target.value) })}
                disabled={dexControlsDisabled}
              />
              {fieldErrors?.dexMaxDeviationBps ? (
                <div style={{ fontSize: 12, color: "#ff6b6b" }}>{fieldErrors.dexMaxDeviationBps}</div>
              ) : null}
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Policy</span>
              <select
                className="input"
                value={dexDeviation.policy ?? "alertOnly"}
                onChange={(e) => setDexDeviation({ ...dexDeviation, policy: e.target.value })}
                disabled={dexControlsDisabled}
              >
                <option value="alertOnly">Alert only</option>
                <option value="freeze">Freeze quoting</option>
              </select>
            </label>
          </div>
          <div className="gridTwoCol" style={{ marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Notify cooldown (sec)</span>
              <input
                className="input"
                type="number"
                min={0}
                value={dexDeviation.notifyCooldownSec ?? 300}
                onChange={(e) => setDexDeviation({ ...dexDeviation, notifyCooldownSec: Number(e.target.value) })}
                disabled={dexControlsDisabled}
              />
            </label>
            <div />
          </div>
          {fieldErrors?.priceSourceMode ? (
            <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 8 }}>
              {fieldErrors.priceSourceMode}
            </div>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <button
              className={`btn btnPrimary ${!canSaveDex || dexControlsDisabled ? "btnDisabled" : ""}`}
              onClick={save}
              disabled={!canSaveDex || dexControlsDisabled}
            >
              {dexSaveLabel}
            </button>
          </div>
        </AccordionSection>
      ) : null}

      {mm && vol && me?.isSuperadmin ? (
        <AccordionSection title="Advanced Settings">
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Per-bot advanced tuning. Superadmin only.
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Controls repricing thresholds, inventory smoothing, and volume scheduling behavior. Defaults are safe; adjust
            carefully.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <button
              className={`btn btnSecondary ${!canEditAdvanced ? "btnDisabled" : ""}`}
              onClick={() => {
                setMm((prev: any) => ({ ...prev, ...ADVANCED_MM_DEFAULTS }));
                setVol((prev: any) => ({ ...prev, ...ADVANCED_VOL_DEFAULTS }));
              }}
              disabled={!canEditAdvanced}
            >
              Load defaults
            </button>
          </div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Market Making</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Reprice timing/thresholds and inventory smoothing for MM orders.
          </div>
          <div className="gridTwoCol">
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>mmRepriceMs</span>
              <input
                className="input"
                type="number"
                min={0}
                value={mm.mmRepriceMs ?? ADVANCED_MM_DEFAULTS.mmRepriceMs}
                onChange={(e) => setMm({ ...mm, mmRepriceMs: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>mmRepricePct</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.0001"
                value={mm.mmRepricePct ?? ADVANCED_MM_DEFAULTS.mmRepricePct}
                onChange={(e) => setMm({ ...mm, mmRepricePct: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>mmPriceEpsPct</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.0001"
                value={mm.mmPriceEpsPct ?? ADVANCED_MM_DEFAULTS.mmPriceEpsPct}
                onChange={(e) => setMm({ ...mm, mmPriceEpsPct: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>mmQtyEpsPct</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.0001"
                value={mm.mmQtyEpsPct ?? ADVANCED_MM_DEFAULTS.mmQtyEpsPct}
                onChange={(e) => setMm({ ...mm, mmQtyEpsPct: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>mmInvAlpha</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                value={mm.mmInvAlpha ?? ADVANCED_MM_DEFAULTS.mmInvAlpha}
                onChange={(e) => setMm({ ...mm, mmInvAlpha: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <div />
          </div>
          <div style={{ fontWeight: 600, margin: "14px 0 8px" }}>Volume</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Volume trade timing, spread placement, and safety limits.
          </div>
          <div className="gridTwoCol">
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>volCooldownMs</span>
              <input
                className="input"
                type="number"
                min={0}
                value={vol.volCooldownMs ?? ADVANCED_VOL_DEFAULTS.volCooldownMs}
                onChange={(e) => setVol({ ...vol, volCooldownMs: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>volActiveTtlMs</span>
              <input
                className="input"
                type="number"
                min={0}
                value={vol.volActiveTtlMs ?? ADVANCED_VOL_DEFAULTS.volActiveTtlMs}
                onChange={(e) => setVol({ ...vol, volActiveTtlMs: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>volMmSafetyMult</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                value={vol.volMmSafetyMult ?? ADVANCED_VOL_DEFAULTS.volMmSafetyMult}
                onChange={(e) => setVol({ ...vol, volMmSafetyMult: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>volLastBandPct</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.0001"
                value={vol.volLastBandPct ?? ADVANCED_VOL_DEFAULTS.volLastBandPct}
                onChange={(e) => setVol({ ...vol, volLastBandPct: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>volInsideSpreadPct</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.0001"
                value={vol.volInsideSpreadPct ?? ADVANCED_VOL_DEFAULTS.volInsideSpreadPct}
                onChange={(e) => setVol({ ...vol, volInsideSpreadPct: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>volLastMinBumpAbs</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.00000001"
                value={vol.volLastMinBumpAbs ?? ADVANCED_VOL_DEFAULTS.volLastMinBumpAbs}
                onChange={(e) => setVol({ ...vol, volLastMinBumpAbs: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>volLastMinBumpPct</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.0001"
                value={vol.volLastMinBumpPct ?? ADVANCED_VOL_DEFAULTS.volLastMinBumpPct}
                onChange={(e) => setVol({ ...vol, volLastMinBumpPct: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>volBuyTicks</span>
              <input
                className="input"
                type="number"
                min={0}
                step="1"
                value={vol.volBuyTicks ?? ADVANCED_VOL_DEFAULTS.volBuyTicks}
                onChange={(e) => setVol({ ...vol, volBuyTicks: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>volSellTicks</span>
              <input
                className="input"
                type="number"
                min={0}
                step="1"
                value={vol.volSellTicks ?? ADVANCED_VOL_DEFAULTS.volSellTicks}
                onChange={(e) => setVol({ ...vol, volSellTicks: Number(e.target.value) })}
                disabled={!canEditAdvanced}
              />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              className={`btn btnPrimary ${!canEditAdvanced ? "btnDisabled" : ""}`}
              onClick={save}
              disabled={!canEditAdvanced}
            >
              Save advanced settings
            </button>
          </div>
        </AccordionSection>
      ) : null}

      <NotificationsForm
        notify={notify}
        onChange={setNotify}
        onSave={save}
        canSave={canSaveNotify}
        saveLabel={notifySaveLabel}
      />
    </div>
  );
}

function severityColor(sev: AiSuggestion["severity"]) {
  if (sev === "critical") return "#ef4444";
  if (sev === "warning") return "#f59e0b";
  return "#3b82f6";
}

function buildDiffRows(
  suggested: AiSuggestion["suggestedConfig"] | undefined,
  mm: any,
  vol: any,
  risk: any
) {
  if (!suggested) return [];
  const rows: { label: string; current: any; next: any }[] = [];
  const add = (section: string, key: string, currentValue: any, nextValue: any) => {
    rows.push({
      label: `${section}.${key}`,
      current: currentValue,
      next: nextValue
    });
  };

  if (suggested.mm) {
    Object.entries(suggested.mm).forEach(([key, value]) => add("mm", key, mm?.[key], value));
  }
  if (suggested.vol) {
    Object.entries(suggested.vol).forEach(([key, value]) => add("vol", key, vol?.[key], value));
  }
  if (suggested.risk) {
    Object.entries(suggested.risk).forEach(([key, value]) => add("risk", key, risk?.[key], value));
  }
  return rows;
}

function ConfigDiffTable({ rows }: { rows: { label: string; current: any; next: any }[] }) {
  if (!rows.length) {
    return <div style={{ fontSize: 12, color: "var(--muted)" }}>No config changes provided.</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", color: "var(--muted)", fontWeight: 600, paddingBottom: 6 }}>Parameter</th>
            <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 600, paddingBottom: 6 }}>Current</th>
            <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 600, paddingBottom: 6 }}>Suggested</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
              <td style={{ padding: "6px 0", color: "#e8eef7" }}>{r.label}</td>
              <td style={{ padding: "6px 0", textAlign: "right", color: "var(--muted)" }}>{formatValue(r.current)}</td>
              <td style={{ padding: "6px 0", textAlign: "right", color: "#e8eef7" }}>{formatValue(r.next)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewTable({ title, rows, accent }: { title: string; rows: any[]; accent: string }) {
  const maxNotional = Math.max(1, ...rows.map((r) => Number(r?.notional || 0)));
  return (
    <div className="card" style={{ padding: 10, borderColor: accent, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: accent }} />
        <div style={{ fontSize: 12, fontWeight: 700 }}>{title}</div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
          {rows.length} levels
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
                <td colSpan={3} style={{ color: "var(--muted)", paddingTop: 8 }}>—</td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={`${title}-${idx}`} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                  <td style={{ paddingTop: 6, paddingBottom: 6, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {formatNum(r.price, 8)}
                  </td>
                  <td style={{ textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {formatNum(r.qty, 6)}
                  </td>
                  <td style={{ textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <div style={{ position: "relative", padding: "2px 0" }}>
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: `${Math.min(100, (Number(r.notional || 0) / maxNotional) * 100)}%`,
                          background: `${accent}22`,
                          borderRadius: 6
                        }}
                      />
                      <span style={{ position: "relative" }}>{formatNum(r.notional, 3)}</span>
                    </div>
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

function formatValue(v: any) {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return formatNum(v, 6);
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function AccordionSection(props: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="card" style={{ padding: 12, marginBottom: 16 }} open={props.defaultOpen}>
      <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: 10 }}>{props.title}</summary>
      <div>{props.children}</div>
    </details>
  );
}
