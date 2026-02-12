export type EconomicImpact = "low" | "medium" | "high";
export type EconomicCalendarProvider = "fmp";

export type EconomicEventNormalized = {
  sourceId: string;
  ts: Date;
  country: string;
  currency: string;
  title: string;
  impact: EconomicImpact;
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  source: EconomicCalendarProvider;
};

export type EconomicCalendarConfigSnapshot = {
  key: string;
  enabled: boolean;
  impactMin: EconomicImpact;
  currencies: string | null;
  preMinutes: number;
  postMinutes: number;
  provider: EconomicCalendarProvider;
  createdAt: Date;
  updatedAt: Date;
};

export type EconomicCalendarConfigUpdate = Partial<
  Pick<
    EconomicCalendarConfigSnapshot,
    "enabled" | "impactMin" | "currencies" | "preMinutes" | "postMinutes" | "provider"
  >
>;

export type EconomicEventView = {
  id: string;
  sourceId: string;
  ts: string;
  country: string;
  currency: string;
  title: string;
  impact: EconomicImpact;
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  source: EconomicCalendarProvider;
};

export type EconomicBlackoutWindow = {
  from: string;
  to: string;
  event: EconomicEventView;
};

export type EconomicBlackoutResult = {
  newsRisk: boolean;
  currency: string;
  nextEvent: EconomicEventView | null;
  activeWindow: EconomicBlackoutWindow | null;
};

export type EconomicNextSummary = {
  currency: string;
  impactMin: EconomicImpact;
  blackoutActive: boolean;
  activeWindow: EconomicBlackoutWindow | null;
  nextEvent: EconomicEventView | null;
  asOf: string;
};
