import { z } from "zod";

export const indicatorScopeTypeSchema = z.enum(["global", "account", "symbol", "symbol_tf"]);

const positiveInt = (min: number, max: number) => z.number().int().min(min).max(max);

const stochrsiSchema = z.object({
  rsiLen: positiveInt(2, 200).default(14),
  stochLen: positiveInt(2, 200).default(14),
  smoothK: positiveInt(1, 50).default(3),
  smoothD: positiveInt(1, 50).default(3)
});

const volumeSchema = z.object({
  lookback: positiveInt(10, 2000).default(100),
  emaFast: positiveInt(2, 200).default(10),
  emaSlow: positiveInt(2, 400).default(30)
}).refine((value) => value.emaFast < value.emaSlow, {
  message: "emaFast must be smaller than emaSlow",
  path: ["emaFast"]
});

const fvgSchema = z.object({
  lookback: positiveInt(20, 5000).default(300),
  fillRule: z.enum(["overlap", "mid_touch"]).default("overlap")
});

const vumanchuSchema = z.object({
  wtChannelLen: positiveInt(2, 100).default(9),
  wtAverageLen: positiveInt(2, 200).default(12),
  wtMaLen: positiveInt(1, 50).default(3),
  obLevel: positiveInt(1, 150).default(53),
  osLevel: z.number().int().min(-150).max(-1).default(-53),
  osLevel3: z.number().int().min(-200).max(-1).default(-75),
  wtDivObLevel: positiveInt(1, 150).default(45),
  wtDivOsLevel: z.number().int().min(-200).max(-1).default(-65),
  wtDivObLevelAdd: positiveInt(1, 150).default(15),
  wtDivOsLevelAdd: z.number().int().min(-200).max(-1).default(-40),
  rsiLen: positiveInt(2, 200).default(14),
  rsiMfiPeriod: positiveInt(2, 500).default(60),
  rsiMfiMultiplier: z.number().min(1).max(500).default(150),
  rsiMfiPosY: z.number().min(-20).max(20).default(2.5),
  stochLen: positiveInt(2, 200).default(14),
  stochRsiLen: positiveInt(2, 200).default(14),
  stochKSmooth: positiveInt(1, 50).default(3),
  stochDSmooth: positiveInt(1, 50).default(3),
  useHiddenDiv: z.boolean().default(false),
  useHiddenDivNoLimits: z.boolean().default(true),
  goldRsiThreshold: positiveInt(1, 100).default(30),
  goldWtDiffMin: z.number().min(1).max(30).default(5)
});

const breakerBlocksSchema = z.object({
  len: positiveInt(1, 10).default(5),
  breakerCandleOnlyBody: z.boolean().default(false),
  breakerCandle2Last: z.boolean().default(false),
  tillFirstBreak: z.boolean().default(true),
  onlyWhenInPDarray: z.boolean().default(false),
  showPDarray: z.boolean().default(false),
  showBreaks: z.boolean().default(false),
  showSPD: z.boolean().default(true),
  pdTextColor: z.string().trim().min(1).max(64).default("#c0c0c0"),
  pdSwingLineColor: z.string().trim().min(1).max(64).default("#c0c0c0"),
  enableTp: z.boolean().default(false),
  tpColor: z.string().trim().min(1).max(64).default("#2157f3"),
  rrTp1: z.number().min(0.2).max(100).default(2),
  rrTp2: z.number().min(0.2).max(100).default(3),
  rrTp3: z.number().min(0.2).max(100).default(4),
  bbPlusColorA: z.string().trim().min(1).max(64).default("rgba(12,181,26,0.365)"),
  bbPlusColorB: z.string().trim().min(1).max(64).default("rgba(12,181,26,0.333)"),
  swingBullColor: z.string().trim().min(1).max(64).default("rgba(255,82,82,0.333)"),
  bbMinusColorA: z.string().trim().min(1).max(64).default("rgba(255,17,0,0.373)"),
  bbMinusColorB: z.string().trim().min(1).max(64).default("rgba(255,17,0,0.333)"),
  swingBearColor: z.string().trim().min(1).max(64).default("rgba(0,137,123,0.333)")
});

const boxBorderStyleSchema = z.enum(["solid", "dashed", "dotted"]);
const labelSizeSchema = z.enum(["huge", "large", "small", "tiny", "auto", "normal"]);

const superOrderBlockFvgBosSchema = z.object({
  plotOB: z.boolean().default(true),
  obBullColor: z.string().trim().min(1).max(64).default("rgba(0,128,0,0.1)"),
  obBearColor: z.string().trim().min(1).max(64).default("rgba(255,0,0,0.1)"),
  obBoxBorderStyle: boxBorderStyleSchema.default("solid"),
  obBorderTransparency: positiveInt(0, 100).default(80),
  obMaxBoxSet: positiveInt(1, 100).default(10),
  filterMitOB: z.boolean().default(false),
  mitOBColor: z.string().trim().min(1).max(64).default("rgba(128,128,128,0.1)"),

  plotFVG: z.boolean().default(true),
  plotStructureBreakingFVG: z.boolean().default(true),
  fvgBullColor: z.string().trim().min(1).max(64).default("rgba(0,0,0,0.1)"),
  fvgBearColor: z.string().trim().min(1).max(64).default("rgba(0,0,0,0.1)"),
  fvgStructBreakingColor: z.string().trim().min(1).max(64).default("rgba(0,0,255,0.1)"),
  fvgBoxBorderStyle: boxBorderStyleSchema.default("solid"),
  fvgBorderTransparency: positiveInt(0, 100).default(80),
  fvgMaxBoxSet: positiveInt(1, 100).default(10),
  filterMitFVG: z.boolean().default(false),
  mitFVGColor: z.string().trim().min(1).max(64).default("rgba(128,128,128,0.1)"),

  plotRJB: z.boolean().default(false),
  rjbBullColor: z.string().trim().min(1).max(64).default("rgba(0,128,0,0.1)"),
  rjbBearColor: z.string().trim().min(1).max(64).default("rgba(255,0,0,0.1)"),
  rjbBoxBorderStyle: boxBorderStyleSchema.default("solid"),
  rjbBorderTransparency: positiveInt(0, 100).default(80),
  rjbMaxBoxSet: positiveInt(1, 100).default(10),
  filterMitRJB: z.boolean().default(false),
  mitRJBColor: z.string().trim().min(1).max(64).default("rgba(128,128,128,0.1)"),

  plotPVT: z.boolean().default(true),
  pivotLookup: positiveInt(1, 5).default(1),
  pvtTopColor: z.string().trim().min(1).max(64).default("rgba(192,192,192,1)"),
  pvtBottomColor: z.string().trim().min(1).max(64).default("rgba(192,192,192,1)"),

  plotBOS: z.boolean().default(false),
  useHighLowForBullishBoS: z.boolean().default(false),
  useHighLowForBearishBoS: z.boolean().default(false),
  bosBoxFlag: z.boolean().default(false),
  bosBoxLength: positiveInt(1, 5).default(3),
  bosBullColor: z.string().trim().min(1).max(64).default("rgba(0,128,0,0.1)"),
  bosBearColor: z.string().trim().min(1).max(64).default("rgba(255,0,0,0.1)"),
  bosBoxBorderStyle: boxBorderStyleSchema.default("solid"),
  bosBorderTransparency: positiveInt(0, 100).default(80),
  bosMaxBoxSet: positiveInt(1, 100).default(10),

  plotHVB: z.boolean().default(true),
  hvbBullColor: z.string().trim().min(1).max(64).default("rgba(0,128,0,1)"),
  hvbBearColor: z.string().trim().min(1).max(64).default("rgba(255,0,0,1)"),
  hvbEMAPeriod: positiveInt(1, 500).default(12),
  hvbMultiplier: z.number().min(1).max(100).default(1.5),

  plotPPDD: z.boolean().default(true),
  ppddBullColor: z.string().trim().min(1).max(64).default("rgba(0,128,0,1)"),
  ppddBearColor: z.string().trim().min(1).max(64).default("rgba(255,0,0,1)"),

  plotOBFVG: z.boolean().default(true),
  obfvgBullColor: z.string().trim().min(1).max(64).default("rgba(0,128,0,1)"),
  obfvgBearColor: z.string().trim().min(1).max(64).default("rgba(255,0,0,1)"),

  plotLabelOB: z.boolean().default(true),
  obLabelColor: z.string().trim().min(1).max(64).default("rgba(128,128,128,1)"),
  obLabelSize: labelSizeSchema.default("tiny"),
  plotLabelFVG: z.boolean().default(true),
  fvgLabelColor: z.string().trim().min(1).max(64).default("rgba(128,128,128,1)"),
  fvgLabelSize: labelSizeSchema.default("tiny"),
  plotLabelRJB: z.boolean().default(true),
  rjbLabelColor: z.string().trim().min(1).max(64).default("rgba(128,128,128,1)"),
  rjbLabelSize: labelSizeSchema.default("tiny"),
  plotLabelBOS: z.boolean().default(true),
  bosLabelColor: z.string().trim().min(1).max(64).default("rgba(128,128,128,1)"),
  bosLabelSize: labelSizeSchema.default("tiny")
});

const advancedIndicatorsSchema = z.object({
  adrLen: positiveInt(1, 365).default(14),
  awrLen: positiveInt(1, 52).default(4),
  amrLen: positiveInt(1, 24).default(6),
  rdLen: positiveInt(1, 365).default(15),
  rwLen: positiveInt(1, 104).default(13),
  openingRangeMin: positiveInt(1, 180).default(30),
  sessionsUseDST: z.boolean().default(true),
  smcInternalLength: positiveInt(2, 50).default(5),
  smcSwingLength: positiveInt(10, 250).default(50),
  smcEqualLength: positiveInt(1, 50).default(3),
  smcEqualThreshold: z.number().min(0).max(0.5).default(0.1),
  smcMaxOrderBlocks: positiveInt(1, 50).default(20),
  smcFvgAutoThreshold: z.boolean().default(true)
});

const liquiditySweepsSchema = z.object({
  len: positiveInt(1, 200).default(5),
  mode: z.enum(["wicks", "outbreak_retest", "both"]).default("both"),
  extend: z.boolean().default(true),
  maxBars: positiveInt(20, 5000).default(300),
  maxRecentEvents: positiveInt(1, 200).default(20),
  maxActiveZones: positiveInt(1, 200).default(20)
});

const aiGatingSchema = z.object({
  enabled: z.boolean().default(true),
  minConfidenceForExplain: z.number().min(0).max(100).default(70),
  minConfidenceForNeutralExplain: z.number().min(0).max(100).default(60),
  confidenceJumpThreshold: z.number().min(0).max(100).default(10),
  keyLevelNearPct: z.number().min(0.05).max(5).default(0.5),
  recentEventBars: z.object({
    "5m": positiveInt(1, 100).default(6),
    "15m": positiveInt(1, 100).default(4),
    "1h": positiveInt(1, 100).default(2),
    "4h": positiveInt(1, 100).default(2),
    "1d": positiveInt(1, 100).default(2)
  }),
  highImportanceMin: positiveInt(1, 5).default(4),
  aiCooldownSec: z.object({
    "5m": positiveInt(0, 86_400).default(120),
    "15m": positiveInt(0, 86_400).default(240),
    "1h": positiveInt(0, 86_400).default(900),
    "4h": positiveInt(0, 86_400).default(1800),
    "1d": positiveInt(0, 86_400).default(3600)
  }),
  refreshIntervalSec: z.object({
    "5m": positiveInt(60, 86_400).default(180),
    "15m": positiveInt(120, 86_400).default(300),
    "1h": positiveInt(180, 86_400).default(600),
    "4h": positiveInt(300, 86_400).default(1800),
    "1d": positiveInt(600, 86_400).default(10800)
  }),
  maxHighPriorityPerHour: positiveInt(1, 200).default(12)
});

export const indicatorSettingsConfigSchema = z.object({
  enabledPacks: z.object({
    indicatorsV1: z.boolean().default(true),
    indicatorsV2: z.boolean().default(true),
    advancedIndicators: z.boolean().default(true),
    liquiditySweeps: z.boolean().default(true)
  }),
  indicatorsV2: z.object({
    stochrsi: stochrsiSchema,
    volume: volumeSchema,
    fvg: fvgSchema,
    vumanchu: vumanchuSchema,
    breakerBlocks: breakerBlocksSchema,
    superOrderBlockFvgBos: superOrderBlockFvgBosSchema
  }),
  advancedIndicators: advancedIndicatorsSchema,
  liquiditySweeps: liquiditySweepsSchema,
  aiGating: aiGatingSchema
});

export const indicatorSettingsPatchSchema = indicatorSettingsConfigSchema.deepPartial();

const scopedString = z
  .string()
  .trim()
  .max(64)
  .optional()
  .transform((value) => {
    if (!value) return undefined;
    return value;
  });

export const indicatorSettingsUpsertSchema = z
  .object({
    scopeType: indicatorScopeTypeSchema,
    exchange: scopedString,
    accountId: scopedString,
    symbol: scopedString,
    timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
    config: indicatorSettingsPatchSchema
  })
  .superRefine((value, ctx) => {
    if (!value.config || Object.keys(value.config).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "config must include at least one setting",
        path: ["config"]
      });
    }
    if (
      value.scopeType !== "global"
      && value.config?.aiGating?.refreshIntervalSec !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "aiGating.refreshIntervalSec is global-only",
        path: ["config", "aiGating", "refreshIntervalSec"]
      });
    }
    if (value.scopeType === "global") return;
    if (value.scopeType === "account" && !value.accountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "accountId is required for account scope",
        path: ["accountId"]
      });
    }
    if (value.scopeType === "symbol" && !value.symbol) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "symbol is required for symbol scope",
        path: ["symbol"]
      });
    }
    if (value.scopeType === "symbol_tf") {
      if (!value.symbol) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "symbol is required for symbol_tf scope",
          path: ["symbol"]
        });
      }
      if (!value.timeframe) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "timeframe is required for symbol_tf scope",
          path: ["timeframe"]
        });
      }
    }
  });

export type IndicatorScopeType = z.infer<typeof indicatorScopeTypeSchema>;
export type IndicatorSettingsConfig = z.infer<typeof indicatorSettingsConfigSchema>;
export type IndicatorSettingsPatch = z.infer<typeof indicatorSettingsPatchSchema>;

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettingsConfig = {
  enabledPacks: {
    indicatorsV1: true,
    indicatorsV2: true,
    advancedIndicators: true,
    liquiditySweeps: true
  },
  indicatorsV2: {
    stochrsi: {
      rsiLen: 14,
      stochLen: 14,
      smoothK: 3,
      smoothD: 3
    },
    volume: {
      lookback: 100,
      emaFast: 10,
      emaSlow: 30
    },
    fvg: {
      lookback: 300,
      fillRule: "overlap"
    },
    vumanchu: {
      wtChannelLen: 9,
      wtAverageLen: 12,
      wtMaLen: 3,
      obLevel: 53,
      osLevel: -53,
      osLevel3: -75,
      wtDivObLevel: 45,
      wtDivOsLevel: -65,
      wtDivObLevelAdd: 15,
      wtDivOsLevelAdd: -40,
      rsiLen: 14,
      rsiMfiPeriod: 60,
      rsiMfiMultiplier: 150,
      rsiMfiPosY: 2.5,
      stochLen: 14,
      stochRsiLen: 14,
      stochKSmooth: 3,
      stochDSmooth: 3,
      useHiddenDiv: false,
      useHiddenDivNoLimits: true,
      goldRsiThreshold: 30,
      goldWtDiffMin: 5
    },
    breakerBlocks: {
      len: 5,
      breakerCandleOnlyBody: false,
      breakerCandle2Last: false,
      tillFirstBreak: true,
      onlyWhenInPDarray: false,
      showPDarray: false,
      showBreaks: false,
      showSPD: true,
      pdTextColor: "#c0c0c0",
      pdSwingLineColor: "#c0c0c0",
      enableTp: false,
      tpColor: "#2157f3",
      rrTp1: 2,
      rrTp2: 3,
      rrTp3: 4,
      bbPlusColorA: "rgba(12,181,26,0.365)",
      bbPlusColorB: "rgba(12,181,26,0.333)",
      swingBullColor: "rgba(255,82,82,0.333)",
      bbMinusColorA: "rgba(255,17,0,0.373)",
      bbMinusColorB: "rgba(255,17,0,0.333)",
      swingBearColor: "rgba(0,137,123,0.333)"
    },
    superOrderBlockFvgBos: {
      plotOB: true,
      obBullColor: "rgba(0,128,0,0.1)",
      obBearColor: "rgba(255,0,0,0.1)",
      obBoxBorderStyle: "solid",
      obBorderTransparency: 80,
      obMaxBoxSet: 10,
      filterMitOB: false,
      mitOBColor: "rgba(128,128,128,0.1)",
      plotFVG: true,
      plotStructureBreakingFVG: true,
      fvgBullColor: "rgba(0,0,0,0.1)",
      fvgBearColor: "rgba(0,0,0,0.1)",
      fvgStructBreakingColor: "rgba(0,0,255,0.1)",
      fvgBoxBorderStyle: "solid",
      fvgBorderTransparency: 80,
      fvgMaxBoxSet: 10,
      filterMitFVG: false,
      mitFVGColor: "rgba(128,128,128,0.1)",
      plotRJB: false,
      rjbBullColor: "rgba(0,128,0,0.1)",
      rjbBearColor: "rgba(255,0,0,0.1)",
      rjbBoxBorderStyle: "solid",
      rjbBorderTransparency: 80,
      rjbMaxBoxSet: 10,
      filterMitRJB: false,
      mitRJBColor: "rgba(128,128,128,0.1)",
      plotPVT: true,
      pivotLookup: 1,
      pvtTopColor: "rgba(192,192,192,1)",
      pvtBottomColor: "rgba(192,192,192,1)",
      plotBOS: false,
      useHighLowForBullishBoS: false,
      useHighLowForBearishBoS: false,
      bosBoxFlag: false,
      bosBoxLength: 3,
      bosBullColor: "rgba(0,128,0,0.1)",
      bosBearColor: "rgba(255,0,0,0.1)",
      bosBoxBorderStyle: "solid",
      bosBorderTransparency: 80,
      bosMaxBoxSet: 10,
      plotHVB: true,
      hvbBullColor: "rgba(0,128,0,1)",
      hvbBearColor: "rgba(255,0,0,1)",
      hvbEMAPeriod: 12,
      hvbMultiplier: 1.5,
      plotPPDD: true,
      ppddBullColor: "rgba(0,128,0,1)",
      ppddBearColor: "rgba(255,0,0,1)",
      plotOBFVG: true,
      obfvgBullColor: "rgba(0,128,0,1)",
      obfvgBearColor: "rgba(255,0,0,1)",
      plotLabelOB: true,
      obLabelColor: "rgba(128,128,128,1)",
      obLabelSize: "tiny",
      plotLabelFVG: true,
      fvgLabelColor: "rgba(128,128,128,1)",
      fvgLabelSize: "tiny",
      plotLabelRJB: true,
      rjbLabelColor: "rgba(128,128,128,1)",
      rjbLabelSize: "tiny",
      plotLabelBOS: true,
      bosLabelColor: "rgba(128,128,128,1)",
      bosLabelSize: "tiny"
    }
  },
  advancedIndicators: {
    adrLen: 14,
    awrLen: 4,
    amrLen: 6,
    rdLen: 15,
    rwLen: 13,
    openingRangeMin: 30,
    sessionsUseDST: true,
    smcInternalLength: 5,
    smcSwingLength: 50,
    smcEqualLength: 3,
    smcEqualThreshold: 0.1,
    smcMaxOrderBlocks: 20,
    smcFvgAutoThreshold: true
  },
  liquiditySweeps: {
    len: 5,
    mode: "both",
    extend: true,
    maxBars: 300,
    maxRecentEvents: 20,
    maxActiveZones: 20
  },
  aiGating: {
    enabled: true,
    minConfidenceForExplain: 70,
    minConfidenceForNeutralExplain: 60,
    confidenceJumpThreshold: 10,
    keyLevelNearPct: 0.5,
    recentEventBars: {
      "5m": 6,
      "15m": 4,
      "1h": 2,
      "4h": 2,
      "1d": 2
    },
    highImportanceMin: 4,
    aiCooldownSec: {
      "5m": 120,
      "15m": 240,
      "1h": 900,
      "4h": 1800,
      "1d": 3600
    },
    refreshIntervalSec: {
      "5m": 180,
      "15m": 300,
      "1h": 600,
      "4h": 1800,
      "1d": 10800
    },
    maxHighPriorityPerHour: 12
  }
};

function normalizeLegacyAdvancedIndicatorsKey(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };

  if (record.advancedIndicators === undefined && record.tradersReality !== undefined) {
    record.advancedIndicators = record.tradersReality;
  }

  if (
    record.enabledPacks &&
    typeof record.enabledPacks === "object" &&
    !Array.isArray(record.enabledPacks)
  ) {
    const enabledPacks = { ...(record.enabledPacks as Record<string, unknown>) };
    if (enabledPacks.advancedIndicators === undefined && enabledPacks.tradersReality !== undefined) {
      enabledPacks.advancedIndicators = enabledPacks.tradersReality;
    }
    record.enabledPacks = enabledPacks;
  }

  if (record.aiGating && typeof record.aiGating === "object" && !Array.isArray(record.aiGating)) {
    const aiGating = { ...(record.aiGating as Record<string, unknown>) };
    if (aiGating.enabled === undefined) aiGating.enabled = true;
    if (aiGating.minConfidenceForNeutralExplain === undefined) {
      aiGating.minConfidenceForNeutralExplain = 60;
    }
    if (aiGating.confidenceJumpThreshold === undefined) {
      aiGating.confidenceJumpThreshold = 10;
    }
    if (aiGating.keyLevelNearPct === undefined) {
      aiGating.keyLevelNearPct = 0.5;
    }
    if (!aiGating.recentEventBars || typeof aiGating.recentEventBars !== "object") {
      aiGating.recentEventBars = {
        "5m": 6,
        "15m": 4,
        "1h": 2,
        "4h": 2,
        "1d": 2
      };
    }
    if (aiGating.highImportanceMin === undefined) {
      aiGating.highImportanceMin = 4;
    }
    if (!aiGating.aiCooldownSec || typeof aiGating.aiCooldownSec !== "object") {
      aiGating.aiCooldownSec = {
        "5m": 120,
        "15m": 240,
        "1h": 900,
        "4h": 1800,
        "1d": 3600
      };
    }
    if (!aiGating.refreshIntervalSec || typeof aiGating.refreshIntervalSec !== "object") {
      aiGating.refreshIntervalSec = {
        "5m": 180,
        "15m": 300,
        "1h": 600,
        "4h": 1800,
        "1d": 10800
      };
    }
    if (aiGating.maxHighPriorityPerHour === undefined) {
      aiGating.maxHighPriorityPerHour = 12;
    }
    record.aiGating = aiGating;
  }

  return record;
}

export function normalizeIndicatorSettingsPatch(value: unknown): IndicatorSettingsPatch {
  const parsed = indicatorSettingsPatchSchema.safeParse(
    normalizeLegacyAdvancedIndicatorsKey(value ?? {})
  );
  return parsed.success ? parsed.data : {};
}

export function mergeIndicatorSettings(
  base: IndicatorSettingsConfig,
  patch: IndicatorSettingsPatch
): IndicatorSettingsConfig {
  const merged: IndicatorSettingsConfig = {
    enabledPacks: {
      indicatorsV1: patch.enabledPacks?.indicatorsV1 ?? base.enabledPacks.indicatorsV1,
      indicatorsV2: patch.enabledPacks?.indicatorsV2 ?? base.enabledPacks.indicatorsV2,
      advancedIndicators: patch.enabledPacks?.advancedIndicators ?? base.enabledPacks.advancedIndicators,
      liquiditySweeps: patch.enabledPacks?.liquiditySweeps ?? base.enabledPacks.liquiditySweeps
    },
    indicatorsV2: {
      stochrsi: {
        rsiLen: patch.indicatorsV2?.stochrsi?.rsiLen ?? base.indicatorsV2.stochrsi.rsiLen,
        stochLen: patch.indicatorsV2?.stochrsi?.stochLen ?? base.indicatorsV2.stochrsi.stochLen,
        smoothK: patch.indicatorsV2?.stochrsi?.smoothK ?? base.indicatorsV2.stochrsi.smoothK,
        smoothD: patch.indicatorsV2?.stochrsi?.smoothD ?? base.indicatorsV2.stochrsi.smoothD
      },
      volume: {
        lookback: patch.indicatorsV2?.volume?.lookback ?? base.indicatorsV2.volume.lookback,
        emaFast: patch.indicatorsV2?.volume?.emaFast ?? base.indicatorsV2.volume.emaFast,
        emaSlow: patch.indicatorsV2?.volume?.emaSlow ?? base.indicatorsV2.volume.emaSlow
      },
      fvg: {
        lookback: patch.indicatorsV2?.fvg?.lookback ?? base.indicatorsV2.fvg.lookback,
        fillRule: patch.indicatorsV2?.fvg?.fillRule ?? base.indicatorsV2.fvg.fillRule
      },
      vumanchu: {
        wtChannelLen:
          patch.indicatorsV2?.vumanchu?.wtChannelLen
          ?? base.indicatorsV2.vumanchu.wtChannelLen,
        wtAverageLen:
          patch.indicatorsV2?.vumanchu?.wtAverageLen
          ?? base.indicatorsV2.vumanchu.wtAverageLen,
        wtMaLen:
          patch.indicatorsV2?.vumanchu?.wtMaLen
          ?? base.indicatorsV2.vumanchu.wtMaLen,
        obLevel:
          patch.indicatorsV2?.vumanchu?.obLevel
          ?? base.indicatorsV2.vumanchu.obLevel,
        osLevel:
          patch.indicatorsV2?.vumanchu?.osLevel
          ?? base.indicatorsV2.vumanchu.osLevel,
        osLevel3:
          patch.indicatorsV2?.vumanchu?.osLevel3
          ?? base.indicatorsV2.vumanchu.osLevel3,
        wtDivObLevel:
          patch.indicatorsV2?.vumanchu?.wtDivObLevel
          ?? base.indicatorsV2.vumanchu.wtDivObLevel,
        wtDivOsLevel:
          patch.indicatorsV2?.vumanchu?.wtDivOsLevel
          ?? base.indicatorsV2.vumanchu.wtDivOsLevel,
        wtDivObLevelAdd:
          patch.indicatorsV2?.vumanchu?.wtDivObLevelAdd
          ?? base.indicatorsV2.vumanchu.wtDivObLevelAdd,
        wtDivOsLevelAdd:
          patch.indicatorsV2?.vumanchu?.wtDivOsLevelAdd
          ?? base.indicatorsV2.vumanchu.wtDivOsLevelAdd,
        rsiLen:
          patch.indicatorsV2?.vumanchu?.rsiLen
          ?? base.indicatorsV2.vumanchu.rsiLen,
        rsiMfiPeriod:
          patch.indicatorsV2?.vumanchu?.rsiMfiPeriod
          ?? base.indicatorsV2.vumanchu.rsiMfiPeriod,
        rsiMfiMultiplier:
          patch.indicatorsV2?.vumanchu?.rsiMfiMultiplier
          ?? base.indicatorsV2.vumanchu.rsiMfiMultiplier,
        rsiMfiPosY:
          patch.indicatorsV2?.vumanchu?.rsiMfiPosY
          ?? base.indicatorsV2.vumanchu.rsiMfiPosY,
        stochLen:
          patch.indicatorsV2?.vumanchu?.stochLen
          ?? base.indicatorsV2.vumanchu.stochLen,
        stochRsiLen:
          patch.indicatorsV2?.vumanchu?.stochRsiLen
          ?? base.indicatorsV2.vumanchu.stochRsiLen,
        stochKSmooth:
          patch.indicatorsV2?.vumanchu?.stochKSmooth
          ?? base.indicatorsV2.vumanchu.stochKSmooth,
        stochDSmooth:
          patch.indicatorsV2?.vumanchu?.stochDSmooth
          ?? base.indicatorsV2.vumanchu.stochDSmooth,
        useHiddenDiv:
          patch.indicatorsV2?.vumanchu?.useHiddenDiv
          ?? base.indicatorsV2.vumanchu.useHiddenDiv,
        useHiddenDivNoLimits:
          patch.indicatorsV2?.vumanchu?.useHiddenDivNoLimits
          ?? base.indicatorsV2.vumanchu.useHiddenDivNoLimits,
        goldRsiThreshold:
          patch.indicatorsV2?.vumanchu?.goldRsiThreshold
          ?? base.indicatorsV2.vumanchu.goldRsiThreshold,
        goldWtDiffMin:
          patch.indicatorsV2?.vumanchu?.goldWtDiffMin
          ?? base.indicatorsV2.vumanchu.goldWtDiffMin
      },
      breakerBlocks: {
        len:
          patch.indicatorsV2?.breakerBlocks?.len
          ?? base.indicatorsV2.breakerBlocks.len,
        breakerCandleOnlyBody:
          patch.indicatorsV2?.breakerBlocks?.breakerCandleOnlyBody
          ?? base.indicatorsV2.breakerBlocks.breakerCandleOnlyBody,
        breakerCandle2Last:
          patch.indicatorsV2?.breakerBlocks?.breakerCandle2Last
          ?? base.indicatorsV2.breakerBlocks.breakerCandle2Last,
        tillFirstBreak:
          patch.indicatorsV2?.breakerBlocks?.tillFirstBreak
          ?? base.indicatorsV2.breakerBlocks.tillFirstBreak,
        onlyWhenInPDarray:
          patch.indicatorsV2?.breakerBlocks?.onlyWhenInPDarray
          ?? base.indicatorsV2.breakerBlocks.onlyWhenInPDarray,
        showPDarray:
          patch.indicatorsV2?.breakerBlocks?.showPDarray
          ?? base.indicatorsV2.breakerBlocks.showPDarray,
        showBreaks:
          patch.indicatorsV2?.breakerBlocks?.showBreaks
          ?? base.indicatorsV2.breakerBlocks.showBreaks,
        showSPD:
          patch.indicatorsV2?.breakerBlocks?.showSPD
          ?? base.indicatorsV2.breakerBlocks.showSPD,
        pdTextColor:
          patch.indicatorsV2?.breakerBlocks?.pdTextColor
          ?? base.indicatorsV2.breakerBlocks.pdTextColor,
        pdSwingLineColor:
          patch.indicatorsV2?.breakerBlocks?.pdSwingLineColor
          ?? base.indicatorsV2.breakerBlocks.pdSwingLineColor,
        enableTp:
          patch.indicatorsV2?.breakerBlocks?.enableTp
          ?? base.indicatorsV2.breakerBlocks.enableTp,
        tpColor:
          patch.indicatorsV2?.breakerBlocks?.tpColor
          ?? base.indicatorsV2.breakerBlocks.tpColor,
        rrTp1:
          patch.indicatorsV2?.breakerBlocks?.rrTp1
          ?? base.indicatorsV2.breakerBlocks.rrTp1,
        rrTp2:
          patch.indicatorsV2?.breakerBlocks?.rrTp2
          ?? base.indicatorsV2.breakerBlocks.rrTp2,
        rrTp3:
          patch.indicatorsV2?.breakerBlocks?.rrTp3
          ?? base.indicatorsV2.breakerBlocks.rrTp3,
        bbPlusColorA:
          patch.indicatorsV2?.breakerBlocks?.bbPlusColorA
          ?? base.indicatorsV2.breakerBlocks.bbPlusColorA,
        bbPlusColorB:
          patch.indicatorsV2?.breakerBlocks?.bbPlusColorB
          ?? base.indicatorsV2.breakerBlocks.bbPlusColorB,
        swingBullColor:
          patch.indicatorsV2?.breakerBlocks?.swingBullColor
          ?? base.indicatorsV2.breakerBlocks.swingBullColor,
        bbMinusColorA:
          patch.indicatorsV2?.breakerBlocks?.bbMinusColorA
          ?? base.indicatorsV2.breakerBlocks.bbMinusColorA,
        bbMinusColorB:
          patch.indicatorsV2?.breakerBlocks?.bbMinusColorB
          ?? base.indicatorsV2.breakerBlocks.bbMinusColorB,
        swingBearColor:
          patch.indicatorsV2?.breakerBlocks?.swingBearColor
          ?? base.indicatorsV2.breakerBlocks.swingBearColor
      },
      superOrderBlockFvgBos: superOrderBlockFvgBosSchema.parse({
        ...base.indicatorsV2.superOrderBlockFvgBos,
        ...(patch.indicatorsV2?.superOrderBlockFvgBos ?? {})
      })
    },
    advancedIndicators: {
      adrLen: patch.advancedIndicators?.adrLen ?? base.advancedIndicators.adrLen,
      awrLen: patch.advancedIndicators?.awrLen ?? base.advancedIndicators.awrLen,
      amrLen: patch.advancedIndicators?.amrLen ?? base.advancedIndicators.amrLen,
      rdLen: patch.advancedIndicators?.rdLen ?? base.advancedIndicators.rdLen,
      rwLen: patch.advancedIndicators?.rwLen ?? base.advancedIndicators.rwLen,
      openingRangeMin:
        patch.advancedIndicators?.openingRangeMin ?? base.advancedIndicators.openingRangeMin,
      sessionsUseDST: patch.advancedIndicators?.sessionsUseDST ?? base.advancedIndicators.sessionsUseDST,
      smcInternalLength:
        patch.advancedIndicators?.smcInternalLength ?? base.advancedIndicators.smcInternalLength,
      smcSwingLength:
        patch.advancedIndicators?.smcSwingLength ?? base.advancedIndicators.smcSwingLength,
      smcEqualLength:
        patch.advancedIndicators?.smcEqualLength ?? base.advancedIndicators.smcEqualLength,
      smcEqualThreshold:
        patch.advancedIndicators?.smcEqualThreshold ?? base.advancedIndicators.smcEqualThreshold,
      smcMaxOrderBlocks:
        patch.advancedIndicators?.smcMaxOrderBlocks ?? base.advancedIndicators.smcMaxOrderBlocks,
      smcFvgAutoThreshold:
        patch.advancedIndicators?.smcFvgAutoThreshold ?? base.advancedIndicators.smcFvgAutoThreshold
    },
    liquiditySweeps: {
      len: patch.liquiditySweeps?.len ?? base.liquiditySweeps.len,
      mode: patch.liquiditySweeps?.mode ?? base.liquiditySweeps.mode,
      extend: patch.liquiditySweeps?.extend ?? base.liquiditySweeps.extend,
      maxBars: patch.liquiditySweeps?.maxBars ?? base.liquiditySweeps.maxBars,
      maxRecentEvents:
        patch.liquiditySweeps?.maxRecentEvents ?? base.liquiditySweeps.maxRecentEvents,
      maxActiveZones:
        patch.liquiditySweeps?.maxActiveZones ?? base.liquiditySweeps.maxActiveZones
    },
    aiGating: {
      enabled: patch.aiGating?.enabled ?? base.aiGating.enabled,
      minConfidenceForExplain:
        patch.aiGating?.minConfidenceForExplain ?? base.aiGating.minConfidenceForExplain,
      minConfidenceForNeutralExplain:
        patch.aiGating?.minConfidenceForNeutralExplain ?? base.aiGating.minConfidenceForNeutralExplain,
      confidenceJumpThreshold:
        patch.aiGating?.confidenceJumpThreshold ?? base.aiGating.confidenceJumpThreshold,
      keyLevelNearPct:
        patch.aiGating?.keyLevelNearPct ?? base.aiGating.keyLevelNearPct,
      recentEventBars: {
        "5m":
          patch.aiGating?.recentEventBars?.["5m"] ?? base.aiGating.recentEventBars["5m"],
        "15m":
          patch.aiGating?.recentEventBars?.["15m"] ?? base.aiGating.recentEventBars["15m"],
        "1h":
          patch.aiGating?.recentEventBars?.["1h"] ?? base.aiGating.recentEventBars["1h"],
        "4h":
          patch.aiGating?.recentEventBars?.["4h"] ?? base.aiGating.recentEventBars["4h"],
        "1d":
          patch.aiGating?.recentEventBars?.["1d"] ?? base.aiGating.recentEventBars["1d"]
      },
      highImportanceMin:
        patch.aiGating?.highImportanceMin ?? base.aiGating.highImportanceMin,
      aiCooldownSec: {
        "5m":
          patch.aiGating?.aiCooldownSec?.["5m"] ?? base.aiGating.aiCooldownSec["5m"],
        "15m":
          patch.aiGating?.aiCooldownSec?.["15m"] ?? base.aiGating.aiCooldownSec["15m"],
        "1h":
          patch.aiGating?.aiCooldownSec?.["1h"] ?? base.aiGating.aiCooldownSec["1h"],
        "4h":
          patch.aiGating?.aiCooldownSec?.["4h"] ?? base.aiGating.aiCooldownSec["4h"],
        "1d":
          patch.aiGating?.aiCooldownSec?.["1d"] ?? base.aiGating.aiCooldownSec["1d"]
      },
      refreshIntervalSec: {
        "5m":
          patch.aiGating?.refreshIntervalSec?.["5m"] ?? base.aiGating.refreshIntervalSec["5m"],
        "15m":
          patch.aiGating?.refreshIntervalSec?.["15m"] ?? base.aiGating.refreshIntervalSec["15m"],
        "1h":
          patch.aiGating?.refreshIntervalSec?.["1h"] ?? base.aiGating.refreshIntervalSec["1h"],
        "4h":
          patch.aiGating?.refreshIntervalSec?.["4h"] ?? base.aiGating.refreshIntervalSec["4h"],
        "1d":
          patch.aiGating?.refreshIntervalSec?.["1d"] ?? base.aiGating.refreshIntervalSec["1d"]
      },
      maxHighPriorityPerHour:
        patch.aiGating?.maxHighPriorityPerHour ?? base.aiGating.maxHighPriorityPerHour
    }
  };

  return indicatorSettingsConfigSchema.parse(merged);
}

export function normalizeIndicatorSettingsConfig(value: unknown): IndicatorSettingsConfig {
  return mergeIndicatorSettings(DEFAULT_INDICATOR_SETTINGS, normalizeIndicatorSettingsPatch(value));
}
