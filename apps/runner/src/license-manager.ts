import { enforceLicense } from "@mm/core";
import { log } from "./logger.js";
import { createLicenseManager, type LicenseState } from "./license.js";

type LicenseMeta = {
  botCount: number;
  cexCount: number;
  usePriceSupport: boolean;
  usePriceFollow: boolean;
  useAiRecommendations: boolean;
};

const manager = createLicenseManager();
let lastCounts: { botCount: number; cexCount: number } = { botCount: 0, cexCount: 0 };

export async function refreshLicense(meta: { botCount: number; cexCount: number }): Promise<LicenseState> {
  lastCounts = { botCount: meta.botCount, cexCount: meta.cexCount };
  return manager.checkOnce({
    botCount: meta.botCount,
    cexCount: meta.cexCount,
    usePriceSupport: false,
    usePriceFollow: false,
    useAiRecommendations: false
  });
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
      useAiRecommendations: meta.useAiRecommendations
    });
    if (!manager.state.enforce.allowed) {
      manager.state.ok = false;
    }
  } else if (!manager.state.ok) {
    log.warn("license not verified yet");
  }

  return manager.state;
}

export function getLicenseState(): LicenseState {
  return manager.state;
}

