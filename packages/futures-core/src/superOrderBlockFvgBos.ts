export type SuperOrderBlockFvgBosCandle = {
  ts: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type SuperOrderBlockFvgBosBorderStyle = "solid" | "dashed" | "dotted";

export type SuperOrderBlockFvgBosLabelSize =
  | "huge"
  | "large"
  | "small"
  | "tiny"
  | "auto"
  | "normal";

export type SuperOrderBlockFvgBosSettings = {
  plotOB: boolean;
  obBullColor: string;
  obBearColor: string;
  obBoxBorderStyle: SuperOrderBlockFvgBosBorderStyle;
  obBorderTransparency: number;
  obMaxBoxSet: number;
  filterMitOB: boolean;
  mitOBColor: string;

  plotFVG: boolean;
  plotStructureBreakingFVG: boolean;
  fvgBullColor: string;
  fvgBearColor: string;
  fvgStructBreakingColor: string;
  fvgBoxBorderStyle: SuperOrderBlockFvgBosBorderStyle;
  fvgBorderTransparency: number;
  fvgMaxBoxSet: number;
  filterMitFVG: boolean;
  mitFVGColor: string;

  plotRJB: boolean;
  rjbBullColor: string;
  rjbBearColor: string;
  rjbBoxBorderStyle: SuperOrderBlockFvgBosBorderStyle;
  rjbBorderTransparency: number;
  rjbMaxBoxSet: number;
  filterMitRJB: boolean;
  mitRJBColor: string;

  plotPVT: boolean;
  pivotLookup: number;
  pvtTopColor: string;
  pvtBottomColor: string;

  plotBOS: boolean;
  useHighLowForBullishBoS: boolean;
  useHighLowForBearishBoS: boolean;
  bosBoxFlag: boolean;
  bosBoxLength: number;
  bosBullColor: string;
  bosBearColor: string;
  bosBoxBorderStyle: SuperOrderBlockFvgBosBorderStyle;
  bosBorderTransparency: number;
  bosMaxBoxSet: number;

  plotHVB: boolean;
  hvbBullColor: string;
  hvbBearColor: string;
  hvbEMAPeriod: number;
  hvbMultiplier: number;

  plotPPDD: boolean;
  ppddBullColor: string;
  ppddBearColor: string;

  plotOBFVG: boolean;
  obfvgBullColor: string;
  obfvgBearColor: string;

  plotLabelOB: boolean;
  obLabelColor: string;
  obLabelSize: SuperOrderBlockFvgBosLabelSize;
  plotLabelFVG: boolean;
  fvgLabelColor: string;
  fvgLabelSize: SuperOrderBlockFvgBosLabelSize;
  plotLabelRJB: boolean;
  rjbLabelColor: string;
  rjbLabelSize: SuperOrderBlockFvgBosLabelSize;
  plotLabelBOS: boolean;
  bosLabelColor: string;
  bosLabelSize: SuperOrderBlockFvgBosLabelSize;
};

export type SuperOrderBlockFvgBosEventKey =
  | "obBull"
  | "obBear"
  | "fvgBull"
  | "fvgBear"
  | "fvgBullStructureBreak"
  | "fvgBearStructureBreak"
  | "rjbBull"
  | "rjbBear"
  | "bosBull"
  | "bosBear"
  | "pivotTop"
  | "pivotBottom"
  | "ppddBull"
  | "ppddBear"
  | "ppddBullWeak"
  | "ppddBearWeak"
  | "stackedObFvgBull"
  | "stackedObFvgBear"
  | "hvbBull"
  | "hvbBear";

export type SuperOrderBlockFvgBosEventFlags = Record<SuperOrderBlockFvgBosEventKey, boolean>;

export type SuperOrderBlockFvgBosZoneType = "ob" | "fvg" | "rjb" | "bos";

export type SuperOrderBlockFvgBosZoneSide = "bull" | "bear";

export type SuperOrderBlockFvgBosZone = {
  id: string;
  type: SuperOrderBlockFvgBosZoneType;
  side: SuperOrderBlockFvgBosZoneSide;
  leftIndex: number;
  rightIndex: number;
  leftTs: number | null;
  rightTs: number | null;
  top: number;
  bottom: number;
  mitigated: boolean;
  structureBreaking: boolean;
  label: string;
  labelColor: string;
  labelSize: SuperOrderBlockFvgBosLabelSize;
  fillColor: string;
  borderColor: string;
  borderStyle: SuperOrderBlockFvgBosBorderStyle;
};

export type SuperOrderBlockFvgBosMarker = {
  index: number;
  ts: number | null;
  type: "ppdd" | "ppdd_weak" | "stacked_ob_fvg";
  side: "bull" | "bear";
  shape: "triangle_up" | "triangle_down" | "xcross" | "diamond";
  color: string;
  price: number;
};

export type SuperOrderBlockFvgBosOverlay = {
  dataGap: boolean;
  settings: SuperOrderBlockFvgBosSettings;
  pivotTop: Array<number | null>;
  pivotBottom: Array<number | null>;
  rectangles: SuperOrderBlockFvgBosZone[];
  markers: SuperOrderBlockFvgBosMarker[];
  hvbColors: Array<string | null>;
  eventsByBar: SuperOrderBlockFvgBosEventFlags[];
  eventCounts: Record<SuperOrderBlockFvgBosEventKey, number>;
  latestTop: number | null;
  latestBottom: number | null;
};

export type SuperOrderBlockFvgBosSnapshot = {
  dataGap: boolean;
  top: number | null;
  bottom: number | null;
  activeZones: {
    obBull: SuperOrderBlockFvgBosZone[];
    obBear: SuperOrderBlockFvgBosZone[];
    fvgBull: SuperOrderBlockFvgBosZone[];
    fvgBear: SuperOrderBlockFvgBosZone[];
    rjbBull: SuperOrderBlockFvgBosZone[];
    rjbBear: SuperOrderBlockFvgBosZone[];
    bosBull: SuperOrderBlockFvgBosZone[];
    bosBear: SuperOrderBlockFvgBosZone[];
  };
  events: SuperOrderBlockFvgBosEventFlags;
  eventCounts: Record<SuperOrderBlockFvgBosEventKey, number>;
  markerCounts: {
    ppddBull: number;
    ppddBear: number;
    ppddBullWeak: number;
    ppddBearWeak: number;
    stackedObFvgBull: number;
    stackedObFvgBear: number;
  };
  hvb: {
    isHighVolume: boolean;
    bullish: boolean;
    bearish: boolean;
    ema: number | null;
  };
};

type NormalizedCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type MutableZone = {
  id: string;
  type: SuperOrderBlockFvgBosZoneType;
  side: SuperOrderBlockFvgBosZoneSide;
  leftIndex: number;
  rightIndex: number;
  top: number;
  bottom: number;
  mitigated: boolean;
  structureBreaking: boolean;
  label: string;
  labelColor: string;
  labelSize: SuperOrderBlockFvgBosLabelSize;
  fillColor: string;
  borderColor: string;
  borderStyle: SuperOrderBlockFvgBosBorderStyle;
};

const EVENT_KEYS: SuperOrderBlockFvgBosEventKey[] = [
  "obBull",
  "obBear",
  "fvgBull",
  "fvgBear",
  "fvgBullStructureBreak",
  "fvgBearStructureBreak",
  "rjbBull",
  "rjbBear",
  "bosBull",
  "bosBear",
  "pivotTop",
  "pivotBottom",
  "ppddBull",
  "ppddBear",
  "ppddBullWeak",
  "ppddBearWeak",
  "stackedObFvgBull",
  "stackedObFvgBear",
  "hvbBull",
  "hvbBear"
];

const LABEL_SIZES: SuperOrderBlockFvgBosLabelSize[] = [
  "huge",
  "large",
  "small",
  "tiny",
  "auto",
  "normal"
];

const BORDER_STYLES: SuperOrderBlockFvgBosBorderStyle[] = ["solid", "dashed", "dotted"];

const NAMED_COLORS: Record<string, [number, number, number]> = {
  green: [0, 128, 0],
  red: [255, 0, 0],
  black: [0, 0, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192]
};

const DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS: SuperOrderBlockFvgBosSettings = {
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
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function clampNum(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asColor(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : fallback;
}

function normalizeBorderStyle(
  value: unknown,
  fallback: SuperOrderBlockFvgBosBorderStyle
): SuperOrderBlockFvgBosBorderStyle {
  const raw = String(value ?? "").trim().toLowerCase();
  const cleaned = raw.replace("line.style_", "");
  if ((BORDER_STYLES as string[]).includes(cleaned)) {
    return cleaned as SuperOrderBlockFvgBosBorderStyle;
  }
  return fallback;
}

function normalizeLabelSize(
  value: unknown,
  fallback: SuperOrderBlockFvgBosLabelSize
): SuperOrderBlockFvgBosLabelSize {
  const raw = String(value ?? "").trim().toLowerCase();
  const cleaned = raw.replace("size.", "");
  if ((LABEL_SIZES as string[]).includes(cleaned)) {
    return cleaned as SuperOrderBlockFvgBosLabelSize;
  }
  return fallback;
}

type Rgba = { r: number; g: number; b: number; a: number };

function rgbaToString(value: Rgba): string {
  const a = Math.max(0, Math.min(1, value.a));
  return `rgba(${Math.round(value.r)},${Math.round(value.g)},${Math.round(value.b)},${a.toFixed(4)})`;
}

function parseColorToRgba(input: string): Rgba | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(hex[0] + hex[0], 16);
      const g = Number.parseInt(hex[1] + hex[1], 16);
      const b = Number.parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? Number.parseInt(hex[3] + hex[3], 16) / 255 : 1;
      if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a };
      return null;
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a };
      return null;
    }
    return null;
  }

  const rgb = value.match(/^rgba?\((.+)\)$/);
  if (rgb) {
    const parts = rgb[1]?.split(",").map((part) => part.trim()) ?? [];
    if (parts.length < 3) return null;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    const a = parts.length >= 4 ? Number(parts[3]) : 1;
    if ([r, g, b, a].every(Number.isFinite)) {
      return {
        r: Math.max(0, Math.min(255, r)),
        g: Math.max(0, Math.min(255, g)),
        b: Math.max(0, Math.min(255, b)),
        a: Math.max(0, Math.min(1, a))
      };
    }
    return null;
  }

  if (NAMED_COLORS[value]) {
    const [r, g, b] = NAMED_COLORS[value];
    return { r, g, b, a: 1 };
  }

  return null;
}

function colorWithTransparency(color: string, transparency: number): string {
  const rgba = parseColorToRgba(color);
  const alpha = Math.max(0, Math.min(1, 1 - (transparency / 100)));
  if (!rgba) return color;
  return rgbaToString({
    ...rgba,
    a: alpha
  });
}

function normalizeCandles(candles: SuperOrderBlockFvgBosCandle[]): NormalizedCandle[] {
  const out: NormalizedCandle[] = [];
  let prevTs: number | null = null;
  const fallbackStep = 60_000;

  for (const row of candles) {
    if (!Number.isFinite(row.open) || !Number.isFinite(row.high) || !Number.isFinite(row.low) || !Number.isFinite(row.close)) {
      continue;
    }
    const rawTs = Number(row.ts);
    const ts: number = Number.isFinite(rawTs)
      ? rawTs
      : (prevTs === null ? 0 : prevTs + fallbackStep);
    const volume = Number(row.volume);
    out.push({
      ts,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: Number.isFinite(volume) ? Math.max(0, volume) : 0
    });
    prevTs = ts;
  }

  return out;
}

function emptyEventFlags(): SuperOrderBlockFvgBosEventFlags {
  return {
    obBull: false,
    obBear: false,
    fvgBull: false,
    fvgBear: false,
    fvgBullStructureBreak: false,
    fvgBearStructureBreak: false,
    rjbBull: false,
    rjbBear: false,
    bosBull: false,
    bosBear: false,
    pivotTop: false,
    pivotBottom: false,
    ppddBull: false,
    ppddBear: false,
    ppddBullWeak: false,
    ppddBearWeak: false,
    stackedObFvgBull: false,
    stackedObFvgBear: false,
    hvbBull: false,
    hvbBear: false
  };
}

function emptyEventCounts(): Record<SuperOrderBlockFvgBosEventKey, number> {
  const out = {} as Record<SuperOrderBlockFvgBosEventKey, number>;
  for (const key of EVENT_KEYS) {
    out[key] = 0;
  }
  return out;
}

function emitEvent(
  flags: SuperOrderBlockFvgBosEventFlags,
  counts: Record<SuperOrderBlockFvgBosEventKey, number>,
  key: SuperOrderBlockFvgBosEventKey
): void {
  flags[key] = true;
  counts[key] += 1;
}

function isUp(candles: NormalizedCandle[], index: number): boolean {
  if (index < 0 || index >= candles.length) return false;
  return candles[index].close > candles[index].open;
}

function isDown(candles: NormalizedCandle[], index: number): boolean {
  if (index < 0 || index >= candles.length) return false;
  return candles[index].close < candles[index].open;
}

function isObUp(candles: NormalizedCandle[], i: number): boolean {
  const signal = i - 1;
  const trapped = i - 2;
  if (signal < 0 || trapped < 0) return false;
  return isDown(candles, trapped) && isUp(candles, signal) && candles[signal].close > candles[trapped].high;
}

function isObDown(candles: NormalizedCandle[], i: number): boolean {
  const signal = i - 1;
  const trapped = i - 2;
  if (signal < 0 || trapped < 0) return false;
  return isUp(candles, trapped) && isDown(candles, signal) && candles[signal].close < candles[trapped].low;
}

function isFvgUp(candles: NormalizedCandle[], i: number): boolean {
  const prev2 = i - 2;
  if (prev2 < 0) return false;
  return candles[i].low > candles[prev2].high;
}

function isFvgDown(candles: NormalizedCandle[], i: number): boolean {
  const prev2 = i - 2;
  if (prev2 < 0) return false;
  return candles[i].high < candles[prev2].low;
}

function isPivotHigh(candles: NormalizedCandle[], center: number, lookup: number): boolean {
  if (center - lookup < 0 || center + lookup >= candles.length) return false;
  const level = candles[center].high;
  for (let i = center - lookup; i <= center + lookup; i += 1) {
    if (i === center) continue;
    if (candles[i].high >= level) return false;
  }
  return true;
}

function isPivotLow(candles: NormalizedCandle[], center: number, lookup: number): boolean {
  if (center - lookup < 0 || center + lookup >= candles.length) return false;
  const level = candles[center].low;
  for (let i = center - lookup; i <= center + lookup; i += 1) {
    if (i === center) continue;
    if (candles[i].low <= level) return false;
  }
  return true;
}

function crossedZoneBoundary(box: MutableZone, high: number, low: number): boolean {
  return (
    (high > box.bottom && low < box.bottom)
    || (high > box.top && low < box.top)
  );
}

function calculateStepMs(candles: NormalizedCandle[]): number {
  if (candles.length < 2) return 60_000;
  let sum = 0;
  let count = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const diff = candles[i].ts - candles[i - 1].ts;
    if (!Number.isFinite(diff) || diff <= 0) continue;
    sum += diff;
    count += 1;
  }
  if (count === 0) return 60_000;
  return Math.max(1, Math.round(sum / count));
}

function indexToTs(candles: NormalizedCandle[], index: number, stepMs: number): number | null {
  if (candles.length === 0) return null;
  if (index >= 0 && index < candles.length) return candles[index].ts;
  if (index < 0) {
    return candles[0].ts + (index * stepMs);
  }
  const lastIndex = candles.length - 1;
  const extra = index - lastIndex;
  return candles[lastIndex].ts + (extra * stepMs);
}

function clampBoxes(collection: MutableZone[], max: number): void {
  while (collection.length > max) {
    collection.shift();
  }
}

function cloneZone(
  zone: MutableZone,
  candles: NormalizedCandle[],
  stepMs: number
): SuperOrderBlockFvgBosZone {
  return {
    id: zone.id,
    type: zone.type,
    side: zone.side,
    leftIndex: zone.leftIndex,
    rightIndex: zone.rightIndex,
    leftTs: indexToTs(candles, zone.leftIndex, stepMs),
    rightTs: indexToTs(candles, zone.rightIndex, stepMs),
    top: zone.top,
    bottom: zone.bottom,
    mitigated: zone.mitigated,
    structureBreaking: zone.structureBreaking,
    label: zone.label,
    labelColor: zone.labelColor,
    labelSize: zone.labelSize,
    fillColor: zone.fillColor,
    borderColor: zone.borderColor,
    borderStyle: zone.borderStyle
  };
}

function zoneCollectionsToRectangles(
  collections: {
    obBull: MutableZone[];
    obBear: MutableZone[];
    fvgBull: MutableZone[];
    fvgBear: MutableZone[];
    rjbBull: MutableZone[];
    rjbBear: MutableZone[];
    bosBull: MutableZone[];
    bosBear: MutableZone[];
  },
  candles: NormalizedCandle[],
  stepMs: number
): SuperOrderBlockFvgBosZone[] {
  const out: SuperOrderBlockFvgBosZone[] = [];
  for (const collection of Object.values(collections)) {
    for (const zone of collection) {
      out.push(cloneZone(zone, candles, stepMs));
    }
  }
  out.sort((a, b) => a.leftIndex - b.leftIndex || a.rightIndex - b.rightIndex);
  return out;
}

function normalizeSettings(
  input?: Partial<SuperOrderBlockFvgBosSettings> | null
): SuperOrderBlockFvgBosSettings {
  const source = input ?? {};
  return {
    plotOB: asBool(source.plotOB, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotOB),
    obBullColor: asColor(source.obBullColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.obBullColor),
    obBearColor: asColor(source.obBearColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.obBearColor),
    obBoxBorderStyle: normalizeBorderStyle(source.obBoxBorderStyle, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.obBoxBorderStyle),
    obBorderTransparency: clampInt(source.obBorderTransparency, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.obBorderTransparency, 0, 100),
    obMaxBoxSet: clampInt(source.obMaxBoxSet, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.obMaxBoxSet, 1, 100),
    filterMitOB: asBool(source.filterMitOB, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.filterMitOB),
    mitOBColor: asColor(source.mitOBColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.mitOBColor),

    plotFVG: asBool(source.plotFVG, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotFVG),
    plotStructureBreakingFVG: asBool(source.plotStructureBreakingFVG, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotStructureBreakingFVG),
    fvgBullColor: asColor(source.fvgBullColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.fvgBullColor),
    fvgBearColor: asColor(source.fvgBearColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.fvgBearColor),
    fvgStructBreakingColor: asColor(source.fvgStructBreakingColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.fvgStructBreakingColor),
    fvgBoxBorderStyle: normalizeBorderStyle(source.fvgBoxBorderStyle, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.fvgBoxBorderStyle),
    fvgBorderTransparency: clampInt(source.fvgBorderTransparency, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.fvgBorderTransparency, 0, 100),
    fvgMaxBoxSet: clampInt(source.fvgMaxBoxSet, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.fvgMaxBoxSet, 1, 100),
    filterMitFVG: asBool(source.filterMitFVG, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.filterMitFVG),
    mitFVGColor: asColor(source.mitFVGColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.mitFVGColor),

    plotRJB: asBool(source.plotRJB, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotRJB),
    rjbBullColor: asColor(source.rjbBullColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.rjbBullColor),
    rjbBearColor: asColor(source.rjbBearColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.rjbBearColor),
    rjbBoxBorderStyle: normalizeBorderStyle(source.rjbBoxBorderStyle, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.rjbBoxBorderStyle),
    rjbBorderTransparency: clampInt(source.rjbBorderTransparency, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.rjbBorderTransparency, 0, 100),
    rjbMaxBoxSet: clampInt(source.rjbMaxBoxSet, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.rjbMaxBoxSet, 1, 100),
    filterMitRJB: asBool(source.filterMitRJB, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.filterMitRJB),
    mitRJBColor: asColor(source.mitRJBColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.mitRJBColor),

    plotPVT: asBool(source.plotPVT, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotPVT),
    pivotLookup: clampInt(source.pivotLookup, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.pivotLookup, 1, 5),
    pvtTopColor: asColor(source.pvtTopColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.pvtTopColor),
    pvtBottomColor: asColor(source.pvtBottomColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.pvtBottomColor),

    plotBOS: asBool(source.plotBOS, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotBOS),
    useHighLowForBullishBoS: asBool(source.useHighLowForBullishBoS, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.useHighLowForBullishBoS),
    useHighLowForBearishBoS: asBool(source.useHighLowForBearishBoS, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.useHighLowForBearishBoS),
    bosBoxFlag: asBool(source.bosBoxFlag, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.bosBoxFlag),
    bosBoxLength: clampInt(source.bosBoxLength, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.bosBoxLength, 1, 5),
    bosBullColor: asColor(source.bosBullColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.bosBullColor),
    bosBearColor: asColor(source.bosBearColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.bosBearColor),
    bosBoxBorderStyle: normalizeBorderStyle(source.bosBoxBorderStyle, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.bosBoxBorderStyle),
    bosBorderTransparency: clampInt(source.bosBorderTransparency, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.bosBorderTransparency, 0, 100),
    bosMaxBoxSet: clampInt(source.bosMaxBoxSet, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.bosMaxBoxSet, 1, 100),

    plotHVB: asBool(source.plotHVB, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotHVB),
    hvbBullColor: asColor(source.hvbBullColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.hvbBullColor),
    hvbBearColor: asColor(source.hvbBearColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.hvbBearColor),
    hvbEMAPeriod: clampInt(source.hvbEMAPeriod, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.hvbEMAPeriod, 1, 500),
    hvbMultiplier: clampNum(source.hvbMultiplier, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.hvbMultiplier, 1, 100),

    plotPPDD: asBool(source.plotPPDD, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotPPDD),
    ppddBullColor: asColor(source.ppddBullColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.ppddBullColor),
    ppddBearColor: asColor(source.ppddBearColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.ppddBearColor),

    plotOBFVG: asBool(source.plotOBFVG, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotOBFVG),
    obfvgBullColor: asColor(source.obfvgBullColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.obfvgBullColor),
    obfvgBearColor: asColor(source.obfvgBearColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.obfvgBearColor),

    plotLabelOB: asBool(source.plotLabelOB, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotLabelOB),
    obLabelColor: asColor(source.obLabelColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.obLabelColor),
    obLabelSize: normalizeLabelSize(source.obLabelSize, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.obLabelSize),
    plotLabelFVG: asBool(source.plotLabelFVG, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotLabelFVG),
    fvgLabelColor: asColor(source.fvgLabelColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.fvgLabelColor),
    fvgLabelSize: normalizeLabelSize(source.fvgLabelSize, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.fvgLabelSize),
    plotLabelRJB: asBool(source.plotLabelRJB, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotLabelRJB),
    rjbLabelColor: asColor(source.rjbLabelColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.rjbLabelColor),
    rjbLabelSize: normalizeLabelSize(source.rjbLabelSize, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.rjbLabelSize),
    plotLabelBOS: asBool(source.plotLabelBOS, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.plotLabelBOS),
    bosLabelColor: asColor(source.bosLabelColor, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.bosLabelColor),
    bosLabelSize: normalizeLabelSize(source.bosLabelSize, DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS.bosLabelSize)
  };
}

function createZone(
  params: {
    id: string;
    type: SuperOrderBlockFvgBosZoneType;
    side: SuperOrderBlockFvgBosZoneSide;
    leftIndex: number;
    rightIndex: number;
    top: number;
    bottom: number;
    structureBreaking?: boolean;
    label: string;
    labelColor: string;
    labelSize: SuperOrderBlockFvgBosLabelSize;
    fillColor: string;
    borderColor: string;
    borderStyle: SuperOrderBlockFvgBosBorderStyle;
  }
): MutableZone {
  return {
    id: params.id,
    type: params.type,
    side: params.side,
    leftIndex: params.leftIndex,
    rightIndex: params.rightIndex,
    top: params.top,
    bottom: params.bottom,
    mitigated: false,
    structureBreaking: params.structureBreaking === true,
    label: params.label,
    labelColor: params.labelColor,
    labelSize: params.labelSize,
    fillColor: params.fillColor,
    borderColor: params.borderColor,
    borderStyle: params.borderStyle
  };
}

export function normalizeSuperOrderBlockFvgBosSettings(
  input?: Partial<SuperOrderBlockFvgBosSettings> | null
): SuperOrderBlockFvgBosSettings {
  return normalizeSettings(input);
}

export function defaultSuperOrderBlockFvgBosSettings(): SuperOrderBlockFvgBosSettings {
  return { ...DEFAULT_SUPER_ORDERBLOCK_FVG_BOS_SETTINGS };
}

export function superOrderBlockFvgBosEventKeys(): SuperOrderBlockFvgBosEventKey[] {
  return [...EVENT_KEYS];
}

export function superOrderBlockFvgBosRequiredBars(
  settingsInput?: Partial<SuperOrderBlockFvgBosSettings> | null
): number {
  const settings = normalizeSettings(settingsInput);
  return Math.max(30, (settings.pivotLookup * 8) + 10, (settings.hvbEMAPeriod * 4) + 10);
}

export function computeSuperOrderBlockFvgBosOverlay(
  candlesInput: SuperOrderBlockFvgBosCandle[],
  settingsInput?: Partial<SuperOrderBlockFvgBosSettings> | null
): SuperOrderBlockFvgBosOverlay {
  const settings = normalizeSettings(settingsInput);
  const candles = normalizeCandles(candlesInput);
  const size = candles.length;
  const requiredBars = superOrderBlockFvgBosRequiredBars(settings);
  const dataGap = size < requiredBars;

  const pivotTop = Array.from({ length: size }, () => null as number | null);
  const pivotBottom = Array.from({ length: size }, () => null as number | null);
  const topRaw = Array.from({ length: size }, () => null as number | null);
  const bottomRaw = Array.from({ length: size }, () => null as number | null);
  const hvbColors = Array.from({ length: size }, () => null as string | null);
  const eventsByBar = Array.from({ length: size }, () => emptyEventFlags());
  const eventCounts = emptyEventCounts();
  const markers: SuperOrderBlockFvgBosMarker[] = [];

  const collections = {
    obBull: [] as MutableZone[],
    obBear: [] as MutableZone[],
    fvgBull: [] as MutableZone[],
    fvgBear: [] as MutableZone[],
    rjbBull: [] as MutableZone[],
    rjbBear: [] as MutableZone[],
    bosBull: [] as MutableZone[],
    bosBear: [] as MutableZone[]
  };

  let zoneSeq = 0;
  let top: number | null = null;
  let bottom: number | null = null;
  let volEma: number | null = null;
  const volAlpha = 2 / (settings.hvbEMAPeriod + 1);

  const obBullBorder = colorWithTransparency(settings.obBullColor, settings.obBorderTransparency);
  const obBearBorder = colorWithTransparency(settings.obBearColor, settings.obBorderTransparency);
  const fvgBullBorder = colorWithTransparency(settings.fvgBullColor, settings.fvgBorderTransparency);
  const fvgBearBorder = colorWithTransparency(settings.fvgBearColor, settings.fvgBorderTransparency);
  const fvgStructBorder = colorWithTransparency(settings.fvgStructBreakingColor, settings.fvgBorderTransparency);
  const rjbBullBorder = colorWithTransparency(settings.rjbBullColor, settings.rjbBorderTransparency);
  const rjbBearBorder = colorWithTransparency(settings.rjbBearColor, settings.rjbBorderTransparency);
  const bosBullBorder = colorWithTransparency(settings.bosBullColor, settings.bosBorderTransparency);
  const bosBearBorder = colorWithTransparency(settings.bosBearColor, settings.bosBorderTransparency);

  for (let i = 0; i < size; i += 1) {
    const flags = eventsByBar[i];
    const row = candles[i];

    volEma = volEma === null ? row.volume : (row.volume * volAlpha) + (volEma * (1 - volAlpha));
    const isHighVolume = volEma !== null && row.volume > (settings.hvbMultiplier * volEma);
    if (settings.plotHVB && isHighVolume) {
      if (row.close > row.open) {
        hvbColors[i] = settings.hvbBullColor;
        emitEvent(flags, eventCounts, "hvbBull");
      } else if (row.close < row.open) {
        hvbColors[i] = settings.hvbBearColor;
        emitEvent(flags, eventCounts, "hvbBear");
      }
    }

    const center = i - settings.pivotLookup;
    if (center >= settings.pivotLookup) {
      if (isPivotHigh(candles, center, settings.pivotLookup)) {
        top = candles[center].high;
        emitEvent(flags, eventCounts, "pivotTop");
      }
      if (isPivotLow(candles, center, settings.pivotLookup)) {
        bottom = candles[center].low;
        emitEvent(flags, eventCounts, "pivotBottom");
      }
    }

    topRaw[i] = top;
    bottomRaw[i] = bottom;
    pivotTop[i] = settings.plotPVT ? top : null;
    pivotBottom[i] = settings.plotPVT ? bottom : null;

    const topPrev = i > 0 ? topRaw[i - 1] : null;
    const bottomPrev = i > 0 ? bottomRaw[i - 1] : null;

    if (settings.plotOB && isObUp(candles, i)) {
      const trapped = i - 2;
      const signal = i - 1;
      const zone = createZone({
        id: `ob_bull_${zoneSeq++}`,
        type: "ob",
        side: "bull",
        leftIndex: trapped,
        rightIndex: i,
        top: candles[trapped].high,
        bottom: Math.min(candles[trapped].low, candles[signal].low),
        label: settings.plotLabelOB ? "OB+" : "",
        labelColor: settings.obLabelColor,
        labelSize: settings.obLabelSize,
        fillColor: settings.obBullColor,
        borderColor: obBullBorder,
        borderStyle: settings.obBoxBorderStyle
      });
      clampBoxes(collections.obBull, settings.obMaxBoxSet);
      collections.obBull.push(zone);
      emitEvent(flags, eventCounts, "obBull");
    }

    if (settings.plotOB && isObDown(candles, i)) {
      const trapped = i - 2;
      const signal = i - 1;
      const zone = createZone({
        id: `ob_bear_${zoneSeq++}`,
        type: "ob",
        side: "bear",
        leftIndex: trapped,
        rightIndex: i,
        top: Math.max(candles[trapped].high, candles[signal].high),
        bottom: candles[trapped].low,
        label: settings.plotLabelOB ? "OB-" : "",
        labelColor: settings.obLabelColor,
        labelSize: settings.obLabelSize,
        fillColor: settings.obBearColor,
        borderColor: obBearBorder,
        borderStyle: settings.obBoxBorderStyle
      });
      clampBoxes(collections.obBear, settings.obMaxBoxSet);
      collections.obBear.push(zone);
      emitEvent(flags, eventCounts, "obBear");
    }

    if (isFvgUp(candles, i)) {
      let zoneColor = settings.fvgBullColor;
      let borderColor = fvgBullBorder;
      let structureBreaking = false;
      let emittedKey: SuperOrderBlockFvgBosEventKey = "fvgBull";

      if (
        settings.plotStructureBreakingFVG
        && top !== null
        && i >= 2
        && candles[i - 1].close > top
        && candles[i - 1].low < top
        && candles[i - 2].high < top
        && candles[i].low > top
      ) {
        zoneColor = settings.fvgStructBreakingColor;
        borderColor = fvgStructBorder;
        structureBreaking = true;
        emittedKey = "fvgBullStructureBreak";
      }

      if (settings.plotFVG || structureBreaking) {
        const zone = createZone({
          id: `fvg_bull_${zoneSeq++}`,
          type: "fvg",
          side: "bull",
          leftIndex: i - 2,
          rightIndex: i,
          top: candles[i].low,
          bottom: candles[i - 2].high,
          structureBreaking,
          label: settings.plotLabelFVG ? "FVG+" : "",
          labelColor: settings.fvgLabelColor,
          labelSize: settings.fvgLabelSize,
          fillColor: zoneColor,
          borderColor,
          borderStyle: settings.fvgBoxBorderStyle
        });
        clampBoxes(collections.fvgBull, settings.fvgMaxBoxSet);
        collections.fvgBull.push(zone);
        emitEvent(flags, eventCounts, emittedKey);
      }
    }

    if (isFvgDown(candles, i)) {
      let zoneColor = settings.fvgBearColor;
      let borderColor = fvgBearBorder;
      let structureBreaking = false;
      let emittedKey: SuperOrderBlockFvgBosEventKey = "fvgBear";

      if (
        settings.plotStructureBreakingFVG
        && bottom !== null
        && i >= 2
        && candles[i - 1].close < bottom
        && candles[i - 1].high > bottom
        && candles[i - 2].low > bottom
        && candles[i].high < bottom
      ) {
        zoneColor = settings.fvgStructBreakingColor;
        borderColor = fvgStructBorder;
        structureBreaking = true;
        emittedKey = "fvgBearStructureBreak";
      }

      if (settings.plotFVG || structureBreaking) {
        const zone = createZone({
          id: `fvg_bear_${zoneSeq++}`,
          type: "fvg",
          side: "bear",
          leftIndex: i - 2,
          rightIndex: i,
          top: candles[i - 2].low,
          bottom: candles[i].high,
          structureBreaking,
          label: settings.plotLabelFVG ? "FVG-" : "",
          labelColor: settings.fvgLabelColor,
          labelSize: settings.fvgLabelSize,
          fillColor: zoneColor,
          borderColor,
          borderStyle: settings.fvgBoxBorderStyle
        });
        clampBoxes(collections.fvgBear, settings.fvgMaxBoxSet);
        collections.fvgBear.push(zone);
        emitEvent(flags, eventCounts, emittedKey);
      }
    }

    if (settings.plotRJB && isObDown(candles, i)) {
      const trapped = i - 2;
      const signal = i - 1;
      const isDownRjb1 = candles[signal].high < (candles[trapped].close + (0.2 * (candles[trapped].high - candles[trapped].close)));
      const isDownRjb2 = candles[signal].high > candles[trapped].high;

      if (isDownRjb1) {
        const zone = createZone({
          id: `rjb_bear_${zoneSeq++}`,
          type: "rjb",
          side: "bear",
          leftIndex: trapped,
          rightIndex: i,
          top: candles[trapped].high,
          bottom: candles[trapped].close,
          label: settings.plotLabelRJB ? "RJB-" : "",
          labelColor: settings.rjbLabelColor,
          labelSize: settings.rjbLabelSize,
          fillColor: settings.rjbBearColor,
          borderColor: rjbBearBorder,
          borderStyle: settings.rjbBoxBorderStyle
        });
        clampBoxes(collections.rjbBear, settings.rjbMaxBoxSet);
        collections.rjbBear.push(zone);
        emitEvent(flags, eventCounts, "rjbBear");
      }

      if (isDownRjb2) {
        const zone = createZone({
          id: `rjb_bear_${zoneSeq++}`,
          type: "rjb",
          side: "bear",
          leftIndex: signal,
          rightIndex: i,
          top: candles[signal].high,
          bottom: candles[signal].open,
          label: settings.plotLabelRJB ? "RJB-" : "",
          labelColor: settings.rjbLabelColor,
          labelSize: settings.rjbLabelSize,
          fillColor: settings.rjbBearColor,
          borderColor: rjbBearBorder,
          borderStyle: settings.rjbBoxBorderStyle
        });
        clampBoxes(collections.rjbBear, settings.rjbMaxBoxSet);
        collections.rjbBear.push(zone);
        emitEvent(flags, eventCounts, "rjbBear");
      }
    }

    if (settings.plotRJB && isObUp(candles, i)) {
      const trapped = i - 2;
      const signal = i - 1;
      const isUpRjb1 = candles[signal].low > (candles[trapped].close - (0.2 * (candles[trapped].close - candles[trapped].low)));
      const isUpRjb2 = candles[signal].low < candles[trapped].low;

      if (isUpRjb1) {
        const zone = createZone({
          id: `rjb_bull_${zoneSeq++}`,
          type: "rjb",
          side: "bull",
          leftIndex: trapped,
          rightIndex: i,
          top: candles[trapped].close,
          bottom: candles[trapped].low,
          label: settings.plotLabelRJB ? "RJB+" : "",
          labelColor: settings.rjbLabelColor,
          labelSize: settings.rjbLabelSize,
          fillColor: settings.rjbBullColor,
          borderColor: rjbBullBorder,
          borderStyle: settings.rjbBoxBorderStyle
        });
        clampBoxes(collections.rjbBull, settings.rjbMaxBoxSet);
        collections.rjbBull.push(zone);
        emitEvent(flags, eventCounts, "rjbBull");
      }

      if (isUpRjb2) {
        const zone = createZone({
          id: `rjb_bull_${zoneSeq++}`,
          type: "rjb",
          side: "bull",
          leftIndex: signal,
          rightIndex: i,
          top: candles[signal].open,
          bottom: candles[signal].low,
          label: settings.plotLabelRJB ? "RJB+" : "",
          labelColor: settings.rjbLabelColor,
          labelSize: settings.rjbLabelSize,
          fillColor: settings.rjbBullColor,
          borderColor: rjbBullBorder,
          borderStyle: settings.rjbBoxBorderStyle
        });
        clampBoxes(collections.rjbBull, settings.rjbMaxBoxSet);
        collections.rjbBull.push(zone);
        emitEvent(flags, eventCounts, "rjbBull");
      }
    }

    if (settings.plotBOS && top !== null && bottom !== null && i > 0) {
      const bullSource = settings.useHighLowForBullishBoS ? row.high : row.close;
      const bullPrevSource = settings.useHighLowForBullishBoS ? candles[i - 1].high : candles[i - 1].close;
      const prevTop = topPrev;
      if (prevTop !== null && bullSource > top && bullPrevSource <= prevTop) {
        const zone = createZone({
          id: `bos_bull_${zoneSeq++}`,
          type: "bos",
          side: "bull",
          leftIndex: i,
          rightIndex: settings.bosBoxFlag ? i + settings.bosBoxLength : i + 1,
          top,
          bottom,
          label: settings.plotLabelBOS ? "BoS+" : "",
          labelColor: settings.bosLabelColor,
          labelSize: settings.bosLabelSize,
          fillColor: settings.bosBullColor,
          borderColor: bosBullBorder,
          borderStyle: settings.bosBoxBorderStyle
        });
        clampBoxes(collections.bosBull, settings.bosMaxBoxSet);
        collections.bosBull.push(zone);
        emitEvent(flags, eventCounts, "bosBull");
      }

      const bearSource = settings.useHighLowForBearishBoS ? row.low : row.close;
      const bearPrevSource = settings.useHighLowForBearishBoS ? candles[i - 1].low : candles[i - 1].close;
      const prevBottom = bottomPrev;
      if (prevBottom !== null && bearSource < bottom && bearPrevSource >= prevBottom) {
        const zone = createZone({
          id: `bos_bear_${zoneSeq++}`,
          type: "bos",
          side: "bear",
          leftIndex: i,
          rightIndex: settings.bosBoxFlag ? i + settings.bosBoxLength : i + 1,
          top,
          bottom,
          label: settings.plotLabelBOS ? "BoS-" : "",
          labelColor: settings.bosLabelColor,
          labelSize: settings.bosLabelSize,
          fillColor: settings.bosBearColor,
          borderColor: bosBearBorder,
          borderStyle: settings.bosBoxBorderStyle
        });
        clampBoxes(collections.bosBear, settings.bosMaxBoxSet);
        collections.bosBear.push(zone);
        emitEvent(flags, eventCounts, "bosBear");
      }
    }

    const premiumPremium =
      settings.plotPPDD
      && isObDown(candles, i)
      && top !== null
      && ((Math.max(row.high, i > 0 ? candles[i - 1].high : row.high) > top && row.close < top)
        || (topPrev !== null && Math.max(row.high, i > 0 ? candles[i - 1].high : row.high) > topPrev && row.close < topPrev));

    const discountDiscount =
      settings.plotPPDD
      && isObUp(candles, i)
      && bottom !== null
      && ((Math.min(row.low, i > 0 ? candles[i - 1].low : row.low) < bottom && row.close > bottom)
        || (bottomPrev !== null && Math.min(row.low, i > 0 ? candles[i - 1].low : row.low) < bottomPrev && row.close > bottomPrev));

    if (premiumPremium) {
      markers.push({
        index: i,
        ts: row.ts,
        type: "ppdd",
        side: "bear",
        shape: "triangle_down",
        color: settings.ppddBearColor,
        price: row.high
      });
      emitEvent(flags, eventCounts, "ppddBear");
    }

    if (discountDiscount) {
      markers.push({
        index: i,
        ts: row.ts,
        type: "ppdd",
        side: "bull",
        shape: "triangle_up",
        color: settings.ppddBullColor,
        price: row.low
      });
      emitEvent(flags, eventCounts, "ppddBull");
    }

    const premiumPremiumWeak =
      settings.plotPPDD
      && i > 0
      && isUp(candles, i - 1)
      && isDown(candles, i)
      && row.close < candles[i - 1].open
      && !premiumPremium
      && top !== null
      && ((Math.max(row.high, candles[i - 1].high) > top && row.close < top)
        || (topPrev !== null && Math.max(row.high, candles[i - 1].high) > topPrev && row.close < topPrev));

    const discountDiscountWeak =
      settings.plotPPDD
      && i > 0
      && isDown(candles, i - 1)
      && isUp(candles, i)
      && row.close > candles[i - 1].open
      && !discountDiscount
      && bottom !== null
      && ((Math.min(row.low, candles[i - 1].low) < bottom && row.close > bottom)
        || (bottomPrev !== null && Math.min(row.low, candles[i - 1].low) < bottomPrev && row.close > bottomPrev));

    if (premiumPremiumWeak) {
      markers.push({
        index: i,
        ts: row.ts,
        type: "ppdd_weak",
        side: "bear",
        shape: "xcross",
        color: settings.ppddBearColor,
        price: row.high
      });
      emitEvent(flags, eventCounts, "ppddBearWeak");
    }

    if (discountDiscountWeak) {
      markers.push({
        index: i,
        ts: row.ts,
        type: "ppdd_weak",
        side: "bull",
        shape: "xcross",
        color: settings.ppddBullColor,
        price: row.low
      });
      emitEvent(flags, eventCounts, "ppddBullWeak");
    }

    const stackedBear = settings.plotOBFVG && isFvgDown(candles, i) && isObDown(candles, i);
    if (stackedBear) {
      markers.push({
        index: i,
        ts: row.ts,
        type: "stacked_ob_fvg",
        side: "bear",
        shape: "diamond",
        color: settings.obfvgBearColor,
        price: row.high
      });
      emitEvent(flags, eventCounts, "stackedObFvgBear");
    }

    const stackedBull = settings.plotOBFVG && isFvgUp(candles, i) && isObUp(candles, i);
    if (stackedBull) {
      markers.push({
        index: i,
        ts: row.ts,
        type: "stacked_ob_fvg",
        side: "bull",
        shape: "diamond",
        color: settings.obfvgBullColor,
        price: row.low
      });
      emitEvent(flags, eventCounts, "stackedObFvgBull");
    }

    const controls: Array<[MutableZone[], SuperOrderBlockFvgBosZoneType]> = [];
    if (settings.plotOB) {
      controls.push([collections.obBull, "ob"], [collections.obBear, "ob"]);
    }
    if (settings.plotFVG || settings.plotStructureBreakingFVG) {
      controls.push([collections.fvgBull, "fvg"], [collections.fvgBear, "fvg"]);
    }
    if (settings.plotRJB) {
      controls.push([collections.rjbBull, "rjb"], [collections.rjbBear, "rjb"]);
    }
    if (settings.plotBOS) {
      controls.push([collections.bosBull, "bos"], [collections.bosBear, "bos"]);
    }

    for (const [list, type] of controls) {
      for (const box of list) {
        const touched = crossedZoneBoundary(box, row.high, row.low);
        const isMitFilter =
          (type === "ob" && settings.filterMitOB)
          || (type === "fvg" && settings.filterMitFVG)
          || (type === "rjb" && settings.filterMitRJB);

        if (type === "bos" && settings.bosBoxFlag) {
          if (touched) box.mitigated = true;
          continue;
        }

        if (i === box.rightIndex && !touched) {
          box.rightIndex = i + 1;
        } else {
          if (touched) box.mitigated = true;
          if (isMitFilter) {
            const mitColor =
              type === "ob"
                ? settings.mitOBColor
                : type === "fvg"
                  ? settings.mitFVGColor
                  : settings.mitRJBColor;
            box.mitigated = true;
            box.fillColor = mitColor;
            box.borderColor = mitColor;
          }
        }
      }
    }
  }

  const stepMs = calculateStepMs(candles);
  const rectangles = zoneCollectionsToRectangles(collections, candles, stepMs);

  return {
    dataGap,
    settings,
    pivotTop,
    pivotBottom,
    rectangles,
    markers,
    hvbColors,
    eventsByBar,
    eventCounts,
    latestTop: top,
    latestBottom: bottom
  };
}

function countMarkers(markers: SuperOrderBlockFvgBosMarker[]): SuperOrderBlockFvgBosSnapshot["markerCounts"] {
  const out: SuperOrderBlockFvgBosSnapshot["markerCounts"] = {
    ppddBull: 0,
    ppddBear: 0,
    ppddBullWeak: 0,
    ppddBearWeak: 0,
    stackedObFvgBull: 0,
    stackedObFvgBear: 0
  };

  for (const marker of markers) {
    if (marker.type === "ppdd") {
      if (marker.side === "bull") out.ppddBull += 1;
      else out.ppddBear += 1;
      continue;
    }
    if (marker.type === "ppdd_weak") {
      if (marker.side === "bull") out.ppddBullWeak += 1;
      else out.ppddBearWeak += 1;
      continue;
    }
    if (marker.type === "stacked_ob_fvg") {
      if (marker.side === "bull") out.stackedObFvgBull += 1;
      else out.stackedObFvgBear += 1;
    }
  }

  return out;
}

function splitActiveZones(rectangles: SuperOrderBlockFvgBosZone[]): SuperOrderBlockFvgBosSnapshot["activeZones"] {
  const active = rectangles.filter((zone) => !zone.mitigated);
  return {
    obBull: active.filter((zone) => zone.type === "ob" && zone.side === "bull"),
    obBear: active.filter((zone) => zone.type === "ob" && zone.side === "bear"),
    fvgBull: active.filter((zone) => zone.type === "fvg" && zone.side === "bull"),
    fvgBear: active.filter((zone) => zone.type === "fvg" && zone.side === "bear"),
    rjbBull: active.filter((zone) => zone.type === "rjb" && zone.side === "bull"),
    rjbBear: active.filter((zone) => zone.type === "rjb" && zone.side === "bear"),
    bosBull: active.filter((zone) => zone.type === "bos" && zone.side === "bull"),
    bosBear: active.filter((zone) => zone.type === "bos" && zone.side === "bear")
  };
}

export function computeSuperOrderBlockFvgBosSnapshot(
  candlesInput: SuperOrderBlockFvgBosCandle[],
  settingsInput?: Partial<SuperOrderBlockFvgBosSettings> | null
): SuperOrderBlockFvgBosSnapshot {
  const overlay = computeSuperOrderBlockFvgBosOverlay(candlesInput, settingsInput);
  const lastEvents = overlay.eventsByBar[overlay.eventsByBar.length - 1] ?? emptyEventFlags();
  const lastHvb = overlay.hvbColors[overlay.hvbColors.length - 1] ?? null;

  return {
    dataGap: overlay.dataGap,
    top: overlay.latestTop,
    bottom: overlay.latestBottom,
    activeZones: splitActiveZones(overlay.rectangles),
    events: lastEvents,
    eventCounts: overlay.eventCounts,
    markerCounts: countMarkers(overlay.markers),
    hvb: {
      isHighVolume: lastHvb !== null,
      bullish: lastHvb === overlay.settings.hvbBullColor,
      bearish: lastHvb === overlay.settings.hvbBearColor,
      ema: null
    }
  };
}
