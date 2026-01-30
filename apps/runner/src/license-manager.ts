import { enforceLicense } from "@mm/core";
import { alert } from "./alerts.js";
import { log } from "./logger.js";
import { createLicenseManager, type LicenseState } from "./license.js";

type LicenseMeta = {
  botCount: number;
  cexCount: number;
  usePriceSupport: boolean;
  usePriceFollow: boolean;
  useAiRecommendations: boolean;
  useDexPriceFeed: boolean;
};

const manager = createLicenseManager();
let lastCounts: { botCount: number; cexCount: number } = { botCount: 0, cexCount: 0 };
let lastNotifiedStatus: string | null = null;
let lastNotifiedGrace = false;
let lastNotifiedEnforce: string | null = null;
let lastEffectiveOk: boolean | null = null;

function graceRemainingSec(state: LicenseState) {
  if (!state.lastOkAt) return null;
  const graceMs = manager.graceMin * 60_000;
  return Math.max(0, Math.floor((graceMs - (Date.now() - state.lastOkAt)) / 1000));
}

async function emitLicenseAlerts(state: LicenseState) {
  const status = state.lastResponse?.status ?? null;
  if (status && status !== "ACTIVE" && status !== lastNotifiedStatus) {
    lastNotifiedStatus = status;
    await alert("error", "License inactive", `Status: ${status}${state.lastResponse?.validUntil ? `, validUntil=${state.lastResponse.validUntil}` : ""}`);
  }

  if (state.grace && !lastNotifiedGrace) {
    lastNotifiedGrace = true;
    const remaining = graceRemainingSec(state);
    const reason = state.lastError?.code ?? "UNKNOWN";
    await alert("warn", "License verification degraded", `Grace period active (${remaining ?? "?"}s remaining). Reason=${reason}`);
  } else if (!state.grace) {
    lastNotifiedGrace = false;
  }

  const enforceReason = state.enforce?.allowed === false ? state.enforce?.reason ?? "LIMIT" : null;
  if (enforceReason && enforceReason !== lastNotifiedEnforce) {
    lastNotifiedEnforce = enforceReason;
    const limits = state.enforce?.limits;
    const limitsMsg = limits
      ? `bots=${lastCounts.botCount}/${limits.maxBots ?? "∞"}, cex=${lastCounts.cexCount}/${limits.maxCex ?? "∞"}`
      : "limits unavailable";
    await alert("error", "License limit/feature blocked", `Reason: ${enforceReason}. ${limitsMsg}`);
  } else if (!enforceReason) {
    lastNotifiedEnforce = null;
  }

  if (state.ok && lastEffectiveOk === false) {
    await alert("info", "License active", "License verification is OK again.");
  }
  if (!state.ok) {
    lastEffectiveOk = false;
  } else {
    lastEffectiveOk = true;
    if (status === "ACTIVE") {
      lastNotifiedStatus = "ACTIVE";
    }
  }
}

export async function refreshLicense(meta: { botCount: number; cexCount: number }): Promise<LicenseState> {
  lastCounts = { botCount: meta.botCount, cexCount: meta.cexCount };
  const state = await manager.checkOnce({
    botCount: meta.botCount,
    cexCount: meta.cexCount,
    usePriceSupport: false,
    usePriceFollow: false,
    useAiRecommendations: false,
    useDexPriceFeed: false
  });
  await emitLicenseAlerts(state);
  return state;
}

export async function ensureLicense(meta: LicenseMeta): Promise<LicenseState> {
  const now = Date.now();
  const due = now - manager.state.lastCheckAt >= manager.verifyIntervalMs;
  if (due || !manager.state.lastResponse) {
    await refreshLicense({ botCount: meta.botCount, cexCount: meta.cexCount });
  }

  if (manager.state.lastResponse) {
    manager.state.enforce = enforceLicense({
      response: manager.state.lastResponse,
      botCount: meta.botCount,
      cexCount: meta.cexCount,
      usePriceSupport: meta.usePriceSupport,
      usePriceFollow: meta.usePriceFollow,
      useAiRecommendations: meta.useAiRecommendations,
      useDexPriceFeed: meta.useDexPriceFeed
    });
    if (!manager.state.enforce.allowed) {
      manager.state.ok = false;
    }
  } else if (!manager.state.ok) {
    log.warn("license not verified yet");
  }

  await emitLicenseAlerts(manager.state);
  return manager.state;
}

export function getLicenseState(): LicenseState {
  return manager.state;
}
