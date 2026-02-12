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

const tradersRealitySchema = z.object({
  adrLen: positiveInt(1, 365).default(14),
  awrLen: positiveInt(1, 52).default(4),
  amrLen: positiveInt(1, 24).default(6),
  rdLen: positiveInt(1, 365).default(15),
  rwLen: positiveInt(1, 104).default(13),
  openingRangeMin: positiveInt(1, 180).default(30),
  sessionsUseDST: z.boolean().default(true)
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
  minConfidenceForExplain: z.number().min(0).max(100).default(55),
  minChangeScore: z.number().min(0).max(1).default(0.2)
});

export const indicatorSettingsConfigSchema = z.object({
  enabledPacks: z.object({
    indicatorsV1: z.boolean().default(true),
    indicatorsV2: z.boolean().default(true),
    tradersReality: z.boolean().default(true),
    liquiditySweeps: z.boolean().default(true)
  }),
  indicatorsV2: z.object({
    stochrsi: stochrsiSchema,
    volume: volumeSchema,
    fvg: fvgSchema
  }),
  tradersReality: tradersRealitySchema,
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
    tradersReality: true,
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
    }
  },
  tradersReality: {
    adrLen: 14,
    awrLen: 4,
    amrLen: 6,
    rdLen: 15,
    rwLen: 13,
    openingRangeMin: 30,
    sessionsUseDST: true
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
    minConfidenceForExplain: 55,
    minChangeScore: 0.2
  }
};

export function normalizeIndicatorSettingsPatch(value: unknown): IndicatorSettingsPatch {
  const parsed = indicatorSettingsPatchSchema.safeParse(value ?? {});
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
      tradersReality: patch.enabledPacks?.tradersReality ?? base.enabledPacks.tradersReality,
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
      }
    },
    tradersReality: {
      adrLen: patch.tradersReality?.adrLen ?? base.tradersReality.adrLen,
      awrLen: patch.tradersReality?.awrLen ?? base.tradersReality.awrLen,
      amrLen: patch.tradersReality?.amrLen ?? base.tradersReality.amrLen,
      rdLen: patch.tradersReality?.rdLen ?? base.tradersReality.rdLen,
      rwLen: patch.tradersReality?.rwLen ?? base.tradersReality.rwLen,
      openingRangeMin:
        patch.tradersReality?.openingRangeMin ?? base.tradersReality.openingRangeMin,
      sessionsUseDST: patch.tradersReality?.sessionsUseDST ?? base.tradersReality.sessionsUseDST
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
      minConfidenceForExplain:
        patch.aiGating?.minConfidenceForExplain ?? base.aiGating.minConfidenceForExplain,
      minChangeScore: patch.aiGating?.minChangeScore ?? base.aiGating.minChangeScore
    }
  };

  return indicatorSettingsConfigSchema.parse(merged);
}

export function normalizeIndicatorSettingsConfig(value: unknown): IndicatorSettingsConfig {
  return mergeIndicatorSettings(DEFAULT_INDICATOR_SETTINGS, normalizeIndicatorSettingsPatch(value));
}
