export type AccessSectionVisibility = {
  tradingDesk: boolean;
  bots: boolean;
  predictionsDashboard: boolean;
  economicCalendar: boolean;
  news: boolean;
  strategy: boolean;
};

export type AccessSectionLimits = {
  bots: number | null;
  predictionsLocal: number | null;
  predictionsAi: number | null;
  predictionsComposite: number | null;
};

export type AccessSectionUsage = {
  bots: number;
  predictionsLocal: number;
  predictionsAi: number;
  predictionsComposite: number;
};

export type AccessSectionSettingsResponse = {
  bypass: boolean;
  visibility: AccessSectionVisibility;
  limits: AccessSectionLimits;
  usage: AccessSectionUsage;
  remaining: {
    bots: number | null;
    predictionsLocal: number | null;
    predictionsAi: number | null;
    predictionsComposite: number | null;
  };
};

export type AccessSectionAdminResponse = {
  visibility: AccessSectionVisibility;
  limits: AccessSectionLimits;
  updatedAt: string | null;
  source: "db" | "default";
  defaults: {
    visibility: AccessSectionVisibility;
    limits: AccessSectionLimits;
  };
};

export const DEFAULT_ACCESS_SECTION_VISIBILITY: AccessSectionVisibility = {
  tradingDesk: true,
  bots: true,
  predictionsDashboard: true,
  economicCalendar: true,
  news: true,
  strategy: true
};

export const DEFAULT_ACCESS_SECTION_LIMITS: AccessSectionLimits = {
  bots: null,
  predictionsLocal: null,
  predictionsAi: null,
  predictionsComposite: null
};

export function emptyAccessSectionUsage(): AccessSectionUsage {
  return {
    bots: 0,
    predictionsLocal: 0,
    predictionsAi: 0,
    predictionsComposite: 0
  };
}

export type StrategyLimitBucket = "predictionsLocal" | "predictionsAi" | "predictionsComposite";

export function strategyBucketFromKind(kind: "ai" | "local" | "composite" | null): StrategyLimitBucket {
  if (kind === "local") return "predictionsLocal";
  if (kind === "composite") return "predictionsComposite";
  return "predictionsAi";
}
