export type BreakerBlocksSignalKey =
  | "BBplus"
  | "signUP"
  | "cnclUP"
  | "LL1break"
  | "LL2break"
  | "SW1breakUP"
  | "SW2breakUP"
  | "tpUP1"
  | "tpUP2"
  | "tpUP3"
  | "BB_endBl"
  | "BB_min"
  | "signDN"
  | "cnclDN"
  | "HH1break"
  | "HH2break"
  | "SW1breakDN"
  | "SW2breakDN"
  | "tpDN1"
  | "tpDN2"
  | "tpDN3"
  | "BB_endBr";

export type BreakerBlocksSignals = Record<BreakerBlocksSignalKey, boolean>;

export type BreakerBlocksCandle = {
  ts: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type BreakerBlocksSettings = {
  len: number;
  breakerCandleOnlyBody: boolean;
  breakerCandle2Last: boolean;
  tillFirstBreak: boolean;
  onlyWhenInPDarray: boolean;
  showPDarray: boolean;
  showBreaks: boolean;
  showSPD: boolean;
  pdTextColor: string;
  pdSwingLineColor: string;
  enableTp: boolean;
  tpColor: string;
  rrTp1: number;
  rrTp2: number;
  rrTp3: number;
  bbPlusColorA: string;
  bbPlusColorB: string;
  swingBullColor: string;
  bbMinusColorA: string;
  bbMinusColorB: string;
  swingBearColor: string;
};

export type BreakerBlocksOverlaySeries = {
  bbTop: Array<number | null>;
  bbBottom: Array<number | null>;
  bbMid: Array<number | null>;
  line1: Array<number | null>;
  line2: Array<number | null>;
  pd1: Array<number | null>;
  pd2: Array<number | null>;
  tp1: Array<number | null>;
  tp2: Array<number | null>;
  tp3: Array<number | null>;
};

export type BreakerBlocksOverlayEvent = {
  index: number;
  ts: number | null;
  key: BreakerBlocksSignalKey;
  label: string;
  direction: "up" | "down" | "neutral";
  price: number;
};

export type BreakerBlocksOverlay = {
  dataGap: boolean;
  settings: BreakerBlocksSettings;
  series: BreakerBlocksOverlaySeries;
  events: BreakerBlocksOverlayEvent[];
  signalsByBar: BreakerBlocksSignals[];
  lastSignalKeys: BreakerBlocksSignalKey[];
  state: {
    dir: -1 | 0 | 1;
    broken: boolean;
    mitigated: boolean;
    scalp: boolean;
    top: number | null;
    bottom: number | null;
    mid: number | null;
    line1: number | null;
    line2: number | null;
    pd1: number | null;
    pd2: number | null;
    tp1: number | null;
    tp2: number | null;
    tp3: number | null;
    tp1Hit: boolean;
    tp2Hit: boolean;
    tp3Hit: boolean;
    broken1: boolean;
    broken2: boolean;
    pdBroken1: boolean;
    pdBroken2: boolean;
  };
  colors: {
    bbPlusA: string;
    bbPlusB: string;
    bbMinusA: string;
    bbMinusB: string;
    swingBull: string;
    swingBear: string;
    pdText: string;
    pdLine: string;
    tp: string;
  };
};

export type BreakerBlocksSnapshot = {
  dataGap: boolean;
  dir: -1 | 0 | 1;
  broken: boolean;
  mitigated: boolean;
  scalp: boolean;
  top: number | null;
  bottom: number | null;
  mid: number | null;
  line1: number | null;
  line2: number | null;
  pd1: number | null;
  pd2: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  broken1: boolean;
  broken2: boolean;
  pdBroken1: boolean;
  pdBroken2: boolean;
  signals: BreakerBlocksSignals;
  lastSignalKeys: BreakerBlocksSignalKey[];
  eventCounts: Record<BreakerBlocksSignalKey, number>;
};

const SIGNAL_KEYS: BreakerBlocksSignalKey[] = [
  "BBplus",
  "signUP",
  "cnclUP",
  "LL1break",
  "LL2break",
  "SW1breakUP",
  "SW2breakUP",
  "tpUP1",
  "tpUP2",
  "tpUP3",
  "BB_endBl",
  "BB_min",
  "signDN",
  "cnclDN",
  "HH1break",
  "HH2break",
  "SW1breakDN",
  "SW2breakDN",
  "tpDN1",
  "tpDN2",
  "tpDN3",
  "BB_endBr"
];

const DEFAULT_BREAKER_BLOCKS_SETTINGS: BreakerBlocksSettings = {
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
};

type Pivot = {
  dir: -1 | 1;
  index: number;
  price: number;
};

type BlockState = {
  dir: -1 | 0 | 1;
  top: number | null;
  bottom: number | null;
  mid: number | null;
  startIndex: number;
  endIndex: number;
  broken: boolean;
  mitigated: boolean;
  scalp: boolean;
  line1: number | null;
  line2: number | null;
  broken1: boolean;
  broken2: boolean;
  pd1: number | null;
  pd2: number | null;
  pdBroken1: boolean;
  pdBroken2: boolean;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
};

function emptySignals(): BreakerBlocksSignals {
  return {
    BBplus: false,
    signUP: false,
    cnclUP: false,
    LL1break: false,
    LL2break: false,
    SW1breakUP: false,
    SW2breakUP: false,
    tpUP1: false,
    tpUP2: false,
    tpUP3: false,
    BB_endBl: false,
    BB_min: false,
    signDN: false,
    cnclDN: false,
    HH1break: false,
    HH2break: false,
    SW1breakDN: false,
    SW2breakDN: false,
    tpDN1: false,
    tpDN2: false,
    tpDN3: false,
    BB_endBr: false
  };
}

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

function asColor(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : fallback;
}

function isBull(candle: BreakerBlocksCandle): boolean {
  return candle.close > candle.open;
}

function isBear(candle: BreakerBlocksCandle): boolean {
  return candle.close < candle.open;
}

function bodyTop(candle: BreakerBlocksCandle): number {
  return Math.max(candle.open, candle.close);
}

function bodyBottom(candle: BreakerBlocksCandle): number {
  return Math.min(candle.open, candle.close);
}

function isPivotHigh(candles: BreakerBlocksCandle[], idx: number, left: number): boolean {
  if (idx - left < 0 || idx + 1 >= candles.length) return false;
  const level = candles[idx].high;
  for (let i = idx - left; i <= idx + 1; i += 1) {
    if (i === idx) continue;
    if (candles[i].high >= level) return false;
  }
  return true;
}

function isPivotLow(candles: BreakerBlocksCandle[], idx: number, left: number): boolean {
  if (idx - left < 0 || idx + 1 >= candles.length) return false;
  const level = candles[idx].low;
  for (let i = idx - left; i <= idx + 1; i += 1) {
    if (i === idx) continue;
    if (candles[i].low <= level) return false;
  }
  return true;
}

function findPriorSwingPivots(
  pivots: Pivot[],
  currentIndex: number,
  direction: "up" | "down"
): [number | null, number | null] {
  const out: number[] = [];
  for (const pivot of pivots) {
    if (pivot.index >= currentIndex) continue;
    if (direction === "up") {
      if (pivot.dir !== 1) continue;
      out.push(pivot.price);
    } else {
      if (pivot.dir !== -1) continue;
      out.push(pivot.price);
    }
    if (out.length >= 2) break;
  }
  return [out[0] ?? null, out[1] ?? null];
}

function signalLabel(key: BreakerBlocksSignalKey): { label: string; direction: "up" | "down" | "neutral" } {
  switch (key) {
    case "BBplus":
      return { label: "+BB", direction: "up" };
    case "signUP":
      return { label: "signal UP", direction: "up" };
    case "cnclUP":
      return { label: "cancel UP", direction: "down" };
    case "LL1break":
      return { label: "LL 1 break", direction: "down" };
    case "LL2break":
      return { label: "LL 2 break", direction: "down" };
    case "SW1breakUP":
      return { label: "Swing UP 1 break", direction: "up" };
    case "SW2breakUP":
      return { label: "Swing UP 2 break", direction: "up" };
    case "tpUP1":
      return { label: "TP UP 1", direction: "up" };
    case "tpUP2":
      return { label: "TP UP 2", direction: "up" };
    case "tpUP3":
      return { label: "TP UP 3", direction: "up" };
    case "BB_endBl":
      return { label: "+BB mitigated", direction: "neutral" };
    case "BB_min":
      return { label: "-BB", direction: "down" };
    case "signDN":
      return { label: "signal DN", direction: "down" };
    case "cnclDN":
      return { label: "cancel DN", direction: "up" };
    case "HH1break":
      return { label: "HH 1 break", direction: "up" };
    case "HH2break":
      return { label: "HH 2 break", direction: "up" };
    case "SW1breakDN":
      return { label: "Swing DN 1 break", direction: "down" };
    case "SW2breakDN":
      return { label: "Swing DN 2 break", direction: "down" };
    case "tpDN1":
      return { label: "TP DN 1", direction: "down" };
    case "tpDN2":
      return { label: "TP DN 2", direction: "down" };
    case "tpDN3":
      return { label: "TP DN 3", direction: "down" };
    case "BB_endBr":
      return { label: "-BB mitigated", direction: "neutral" };
    default:
      return { label: key, direction: "neutral" };
  }
}

function emptySeries(size: number): BreakerBlocksOverlaySeries {
  return {
    bbTop: Array.from({ length: size }, () => null),
    bbBottom: Array.from({ length: size }, () => null),
    bbMid: Array.from({ length: size }, () => null),
    line1: Array.from({ length: size }, () => null),
    line2: Array.from({ length: size }, () => null),
    pd1: Array.from({ length: size }, () => null),
    pd2: Array.from({ length: size }, () => null),
    tp1: Array.from({ length: size }, () => null),
    tp2: Array.from({ length: size }, () => null),
    tp3: Array.from({ length: size }, () => null)
  };
}

function emptyBlockState(): BlockState {
  return {
    dir: 0,
    top: null,
    bottom: null,
    mid: null,
    startIndex: -1,
    endIndex: -1,
    broken: false,
    mitigated: false,
    scalp: false,
    line1: null,
    line2: null,
    broken1: false,
    broken2: false,
    pd1: null,
    pd2: null,
    pdBroken1: false,
    pdBroken2: false,
    tp1: null,
    tp2: null,
    tp3: null,
    tp1Hit: false,
    tp2Hit: false,
    tp3Hit: false
  };
}

function createPivotsStore(maxItems: number): Pivot[] {
  return [] as Pivot[];
}

function upsertPivot(pivots: Pivot[], pivot: Pivot, maxItems: number): void {
  const latest = pivots[0] ?? null;
  if (!latest || latest.dir !== pivot.dir) {
    pivots.unshift(pivot);
  } else if ((pivot.dir === 1 && pivot.price > latest.price) || (pivot.dir === -1 && pivot.price < latest.price)) {
    pivots[0] = pivot;
  }
  while (pivots.length > maxItems) pivots.pop();
}

function pickPivot(pivots: Pivot[], idx: number): Pivot | null {
  if (idx < 0 || idx >= pivots.length) return null;
  return pivots[idx] ?? null;
}

function emitSignal(
  signals: BreakerBlocksSignals,
  events: BreakerBlocksOverlayEvent[],
  candles: BreakerBlocksCandle[],
  index: number,
  key: BreakerBlocksSignalKey,
  price: number
): void {
  signals[key] = true;
  const info = signalLabel(key);
  events.push({
    index,
    ts: candles[index]?.ts ?? null,
    key,
    label: info.label,
    direction: info.direction,
    price
  });
}

function normalizeCandles(candles: BreakerBlocksCandle[]): BreakerBlocksCandle[] {
  return candles
    .filter((row) => Number.isFinite(row.open) && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.close))
    .slice()
    .sort((a, b) => {
      const ta = a.ts ?? 0;
      const tb = b.ts ?? 0;
      return ta - tb;
    });
}

export function normalizeBreakerBlocksSettings(
  input?: Partial<BreakerBlocksSettings> | null
): BreakerBlocksSettings {
  const source = input ?? {};
  return {
    len: clampInt(source.len, DEFAULT_BREAKER_BLOCKS_SETTINGS.len, 1, 10),
    breakerCandleOnlyBody: source.breakerCandleOnlyBody === true,
    breakerCandle2Last: source.breakerCandle2Last === true,
    tillFirstBreak: source.tillFirstBreak !== false,
    onlyWhenInPDarray: source.onlyWhenInPDarray === true,
    showPDarray: source.showPDarray === true,
    showBreaks: source.showBreaks === true,
    showSPD: source.showSPD !== false,
    pdTextColor: asColor(source.pdTextColor, DEFAULT_BREAKER_BLOCKS_SETTINGS.pdTextColor),
    pdSwingLineColor: asColor(source.pdSwingLineColor, DEFAULT_BREAKER_BLOCKS_SETTINGS.pdSwingLineColor),
    enableTp: source.enableTp === true,
    tpColor: asColor(source.tpColor, DEFAULT_BREAKER_BLOCKS_SETTINGS.tpColor),
    rrTp1: clampNum(source.rrTp1, DEFAULT_BREAKER_BLOCKS_SETTINGS.rrTp1, 0.2, 100),
    rrTp2: clampNum(source.rrTp2, DEFAULT_BREAKER_BLOCKS_SETTINGS.rrTp2, 0.2, 100),
    rrTp3: clampNum(source.rrTp3, DEFAULT_BREAKER_BLOCKS_SETTINGS.rrTp3, 0.2, 100),
    bbPlusColorA: asColor(source.bbPlusColorA, DEFAULT_BREAKER_BLOCKS_SETTINGS.bbPlusColorA),
    bbPlusColorB: asColor(source.bbPlusColorB, DEFAULT_BREAKER_BLOCKS_SETTINGS.bbPlusColorB),
    swingBullColor: asColor(source.swingBullColor, DEFAULT_BREAKER_BLOCKS_SETTINGS.swingBullColor),
    bbMinusColorA: asColor(source.bbMinusColorA, DEFAULT_BREAKER_BLOCKS_SETTINGS.bbMinusColorA),
    bbMinusColorB: asColor(source.bbMinusColorB, DEFAULT_BREAKER_BLOCKS_SETTINGS.bbMinusColorB),
    swingBearColor: asColor(source.swingBearColor, DEFAULT_BREAKER_BLOCKS_SETTINGS.swingBearColor)
  };
}

function createSignalCounts(): Record<BreakerBlocksSignalKey, number> {
  const out = {} as Record<BreakerBlocksSignalKey, number>;
  for (const key of SIGNAL_KEYS) out[key] = 0;
  return out;
}

function collectSignals(events: BreakerBlocksOverlayEvent[]): Record<BreakerBlocksSignalKey, number> {
  const out = createSignalCounts();
  for (const event of events) {
    out[event.key] += 1;
  }
  return out;
}

export function computeBreakerBlocksOverlay(
  candlesInput: BreakerBlocksCandle[],
  settingsInput?: Partial<BreakerBlocksSettings> | null
): BreakerBlocksOverlay {
  const settings = normalizeBreakerBlocksSettings(settingsInput);
  const candles = normalizeCandles(candlesInput);
  const size = candles.length;
  const dataGap = size < Math.max(80, settings.len * 8);
  const series = emptySeries(size);
  const events: BreakerBlocksOverlayEvent[] = [];
  const signalsByBar: BreakerBlocksSignals[] = Array.from({ length: size }, () => emptySignals());

  const state = emptyBlockState();
  const pivots = createPivotsStore(50);

  let mssDir: -1 | 0 | 1 = 0;

  for (let i = 0; i < size; i += 1) {
    const per = i >= size - 2000;
    const row = candles[i];
    const signals = signalsByBar[i];

    if (i >= 1) {
      const pivotIdx = i - 1;
      if (isPivotHigh(candles, pivotIdx, settings.len)) {
        upsertPivot(pivots, { dir: 1, index: pivotIdx, price: candles[pivotIdx].high }, 50);
      }
      if (isPivotLow(candles, pivotIdx, settings.len)) {
        upsertPivot(pivots, { dir: -1, index: pivotIdx, price: candles[pivotIdx].low }, 50);
      }
    }

    const iH = pickPivot(pivots, 2)?.dir === 1 ? 2 : 1;
    const iL = pickPivot(pivots, 2)?.dir === -1 ? 2 : 1;

    const pIh = pickPivot(pivots, iH);
    const pIh1 = pickPivot(pivots, iH - 1);
    const pIh2 = pickPivot(pivots, iH + 1);
    const pIh3 = pickPivot(pivots, iH + 2);
    const pIh4 = pickPivot(pivots, iH + 3);

    if (
      per
      && pIh
      && pIh1
      && pIh2
      && pIh3
      && pIh4
      && pIh.dir === 1
      && row.close > pIh.price
      && mssDir < 1
    ) {
      const Ex = pIh1.index;
      const Ey = pIh1.price;
      const Dx = pIh.index;
      const Cx = pIh2.index;
      const Cy = pIh2.price;
      const Bx = pIh3.index;
      const Ax = pIh4.index;

      const dyMx = bodyTop(candles[Dx]);
      const byMx = bodyTop(candles[Bx]);
      const ayMn = bodyBottom(candles[Ax]);
      const yUpper = Math.max(byMx, dyMx);
      const midPd = ayMn + ((yUpper - ayMn) / 2);

      const isOk = settings.onlyWhenInPDarray
        ? pIh4.price < Cy && pIh4.price < Ey && Ey < midPd
        : true;

      if (Ey < Cy && Cx !== Dx && isOk) {
        let found = false;
        let startIdx = -1;
        let top = 0;
        let bottom = 0;

        for (let idx = Dx; idx >= Cx; idx -= 1) {
          const candle = candles[idx];
          if (!isBull(candle)) continue;
          found = true;
          startIdx = idx;
          top = settings.breakerCandleOnlyBody ? bodyTop(candle) : candle.high;
          bottom = settings.breakerCandleOnlyBody ? bodyBottom(candle) : candle.low;

          if (settings.breakerCandle2Last && idx - 1 >= Cx && isBull(candles[idx - 1])) {
            const second = candles[idx - 1];
            const top2 = settings.breakerCandleOnlyBody ? bodyTop(second) : second.high;
            const bottom2 = settings.breakerCandleOnlyBody ? bodyBottom(second) : second.low;
            if (top2 > top || bottom2 < bottom) {
              startIdx = idx - 1;
            }
            top = Math.max(top, top2);
            bottom = Math.min(bottom, bottom2);
          }
          break;
        }

        if (found && startIdx >= 0) {
          const [pd1, pd2] = findPriorSwingPivots(pivots, i, "up");
          const spread = Math.max(1e-9, top - bottom);

          state.dir = 1;
          state.top = top;
          state.bottom = bottom;
          state.mid = (top + bottom) / 2;
          state.startIndex = startIdx;
          state.endIndex = i;
          state.broken = false;
          state.mitigated = false;
          state.scalp = false;
          state.line1 = settings.showSPD ? Cy : null;
          state.line2 = settings.showSPD ? Ey : null;
          state.broken1 = false;
          state.broken2 = false;
          state.pd1 = settings.showSPD ? pd1 : null;
          state.pd2 = settings.showSPD ? pd2 : null;
          state.pdBroken1 = false;
          state.pdBroken2 = false;
          state.tp1 = top + (spread * settings.rrTp1);
          state.tp2 = top + (spread * settings.rrTp2);
          state.tp3 = top + (spread * settings.rrTp3);
          state.tp1Hit = false;
          state.tp2Hit = false;
          state.tp3Hit = false;

          emitSignal(signals, events, candles, i, "BBplus", row.low);
        }
      }
      mssDir = 1;
    }

    const pIl = pickPivot(pivots, iL);
    const pIl1 = pickPivot(pivots, iL - 1);
    const pIl2 = pickPivot(pivots, iL + 1);
    const pIl3 = pickPivot(pivots, iL + 2);
    const pIl4 = pickPivot(pivots, iL + 3);

    if (
      per
      && pIl
      && pIl1
      && pIl2
      && pIl3
      && pIl4
      && pIl.dir === -1
      && row.close < pIl.price
      && mssDir > -1
    ) {
      const Ex = pIl1.index;
      const Ey = pIl1.price;
      const Dx = pIl.index;
      const Cx = pIl2.index;
      const Cy = pIl2.price;
      const Bx = pIl3.index;
      const Ax = pIl4.index;

      const dyMn = bodyBottom(candles[Dx]);
      const byMn = bodyBottom(candles[Bx]);
      const ayMx = bodyTop(candles[Ax]);
      const yLower = Math.min(byMn, dyMn);
      const midPd = ayMx - ((ayMx - yLower) / 2);

      const isOk = settings.onlyWhenInPDarray
        ? pIl4.price > Cy && pIl4.price > Ey && Ey > midPd
        : true;

      if (Ey > Cy && Cx !== Dx && isOk) {
        let found = false;
        let startIdx = -1;
        let top = 0;
        let bottom = 0;

        for (let idx = Dx; idx >= Cx; idx -= 1) {
          const candle = candles[idx];
          if (!isBear(candle)) continue;
          found = true;
          startIdx = idx;
          top = settings.breakerCandleOnlyBody ? bodyTop(candle) : candle.high;
          bottom = settings.breakerCandleOnlyBody ? bodyBottom(candle) : candle.low;

          if (settings.breakerCandle2Last && idx - 1 >= Cx && isBear(candles[idx - 1])) {
            const second = candles[idx - 1];
            const top2 = settings.breakerCandleOnlyBody ? bodyTop(second) : second.high;
            const bottom2 = settings.breakerCandleOnlyBody ? bodyBottom(second) : second.low;
            if (top2 > top || bottom2 < bottom) {
              startIdx = idx - 1;
            }
            top = Math.max(top, top2);
            bottom = Math.min(bottom, bottom2);
          }
          break;
        }

        if (found && startIdx >= 0) {
          const [pd1, pd2] = findPriorSwingPivots(pivots, i, "down");
          const spread = Math.max(1e-9, top - bottom);

          state.dir = -1;
          state.top = top;
          state.bottom = bottom;
          state.mid = (top + bottom) / 2;
          state.startIndex = startIdx;
          state.endIndex = i;
          state.broken = false;
          state.mitigated = false;
          state.scalp = false;
          state.line1 = settings.showSPD ? Cy : null;
          state.line2 = settings.showSPD ? Ey : null;
          state.broken1 = false;
          state.broken2 = false;
          state.pd1 = settings.showSPD ? pd1 : null;
          state.pd2 = settings.showSPD ? pd2 : null;
          state.pdBroken1 = false;
          state.pdBroken2 = false;
          state.tp1 = bottom - (spread * settings.rrTp1);
          state.tp2 = bottom - (spread * settings.rrTp2);
          state.tp3 = bottom - (spread * settings.rrTp3);
          state.tp1Hit = false;
          state.tp2Hit = false;
          state.tp3Hit = false;

          emitSignal(signals, events, candles, i, "BB_min", row.high);
        }
      }
      mssDir = -1;
    }

    if (state.dir === 1 && state.top !== null && state.bottom !== null && state.mid !== null) {
      if (!state.mitigated) {
        if (row.close < state.bottom) {
          state.mitigated = true;
          state.endIndex = i;
          emitSignal(signals, events, candles, i, "BB_endBl", row.low);
        } else {
          state.endIndex = i;
        }

        if (i > state.startIndex) {
          if (!state.broken) {
            if (state.scalp && settings.enableTp) {
              if (!state.tp1Hit && state.tp1 !== null && row.open < state.tp1 && row.high > state.tp1) {
                state.tp1Hit = true;
                emitSignal(signals, events, candles, i, "tpUP1", state.tp1);
              }
              if (!state.tp2Hit && state.tp2 !== null && row.open < state.tp2 && row.high > state.tp2) {
                state.tp2Hit = true;
                emitSignal(signals, events, candles, i, "tpUP2", state.tp2);
              }
              if (!state.tp3Hit && state.tp3 !== null && row.open < state.tp3 && row.high > state.tp3) {
                state.tp3Hit = true;
                emitSignal(signals, events, candles, i, "tpUP3", state.tp3);
              }
            }

            if (row.open > state.mid && row.open < state.top && row.close > state.top) {
              state.tp1Hit = false;
              state.tp2Hit = false;
              state.tp3Hit = false;
              state.scalp = true;
              emitSignal(signals, events, candles, i, "signUP", row.low);
            } else if (row.close < state.mid && row.close > state.bottom) {
              state.broken = true;
              state.scalp = false;
              emitSignal(signals, events, candles, i, "cnclUP", row.low);
            }
          } else if (!settings.tillFirstBreak && row.close > state.top) {
            state.broken = false;
            state.scalp = true;
            emitSignal(signals, events, candles, i, "BBplus", row.low);
          }
        }
      }

      if (!state.broken1 && state.line1 !== null && row.close < state.line1) {
        state.broken1 = true;
        emitSignal(signals, events, candles, i, "LL1break", row.low);
      }
      if (!state.broken2 && state.line2 !== null && row.close < state.line2) {
        state.broken2 = true;
        emitSignal(signals, events, candles, i, "LL2break", row.low);
      }

      if (!state.pdBroken1 && state.pd1 !== null && row.close > state.pd1 && i > state.startIndex) {
        state.pdBroken1 = true;
        emitSignal(signals, events, candles, i, "SW1breakUP", row.high);
      }
      if (!state.pdBroken2 && state.pd2 !== null && row.close > state.pd2 && i > state.startIndex) {
        state.pdBroken2 = true;
        emitSignal(signals, events, candles, i, "SW2breakUP", row.high);
      }
    }

    if (state.dir === -1 && state.top !== null && state.bottom !== null && state.mid !== null) {
      if (!state.mitigated) {
        if (row.close > state.top) {
          state.mitigated = true;
          state.endIndex = i;
          emitSignal(signals, events, candles, i, "BB_endBr", row.high);
        } else {
          state.endIndex = i;
        }

        if (i > state.startIndex) {
          if (!state.broken) {
            if (state.scalp && settings.enableTp) {
              if (!state.tp1Hit && state.tp1 !== null && row.open > state.tp1 && row.low < state.tp1) {
                state.tp1Hit = true;
                emitSignal(signals, events, candles, i, "tpDN1", state.tp1);
              }
              if (!state.tp2Hit && state.tp2 !== null && row.open > state.tp2 && row.low < state.tp2) {
                state.tp2Hit = true;
                emitSignal(signals, events, candles, i, "tpDN2", state.tp2);
              }
              if (!state.tp3Hit && state.tp3 !== null && row.open > state.tp3 && row.low < state.tp3) {
                state.tp3Hit = true;
                emitSignal(signals, events, candles, i, "tpDN3", state.tp3);
              }
            }

            if (row.open < state.mid && row.open > state.bottom && row.close < state.bottom) {
              state.tp1Hit = false;
              state.tp2Hit = false;
              state.tp3Hit = false;
              state.scalp = true;
              emitSignal(signals, events, candles, i, "signDN", row.high);
            } else if (row.close > state.mid && row.close < state.top) {
              state.broken = true;
              state.scalp = false;
              emitSignal(signals, events, candles, i, "cnclDN", row.high);
            }
          } else if (!settings.tillFirstBreak && row.close < state.bottom) {
            state.broken = false;
            state.scalp = true;
            emitSignal(signals, events, candles, i, "BB_min", row.high);
          }
        }
      }

      if (!state.broken1 && state.line1 !== null && row.close > state.line1) {
        state.broken1 = true;
        emitSignal(signals, events, candles, i, "HH1break", row.high);
      }
      if (!state.broken2 && state.line2 !== null && row.close > state.line2) {
        state.broken2 = true;
        emitSignal(signals, events, candles, i, "HH2break", row.high);
      }

      if (!state.pdBroken1 && state.pd1 !== null && row.close < state.pd1 && i > state.startIndex) {
        state.pdBroken1 = true;
        emitSignal(signals, events, candles, i, "SW1breakDN", row.low);
      }
      if (!state.pdBroken2 && state.pd2 !== null && row.close < state.pd2 && i > state.startIndex) {
        state.pdBroken2 = true;
        emitSignal(signals, events, candles, i, "SW2breakDN", row.low);
      }
    }

    if (state.dir !== 0 && state.startIndex >= 0 && i >= state.startIndex) {
      series.bbTop[i] = state.top;
      series.bbBottom[i] = state.bottom;
      series.bbMid[i] = state.mid;

      if (settings.showSPD) {
        series.line1[i] = state.broken1 ? null : state.line1;
        series.line2[i] = state.broken2 ? null : state.line2;
        series.pd1[i] = state.pdBroken1 ? null : state.pd1;
        series.pd2[i] = state.pdBroken2 ? null : state.pd2;
      }
      if (settings.enableTp) {
        series.tp1[i] = state.tp1Hit ? null : state.tp1;
        series.tp2[i] = state.tp2Hit ? null : state.tp2;
        series.tp3[i] = state.tp3Hit ? null : state.tp3;
      }
    }
  }

  const lastSignals = signalsByBar[size - 1] ?? emptySignals();
  const lastSignalKeys = SIGNAL_KEYS.filter((key) => lastSignals[key]);

  return {
    dataGap,
    settings,
    series,
    events,
    signalsByBar,
    lastSignalKeys,
    state: {
      dir: state.dir,
      broken: state.broken,
      mitigated: state.mitigated,
      scalp: state.scalp,
      top: state.top,
      bottom: state.bottom,
      mid: state.mid,
      line1: state.line1,
      line2: state.line2,
      pd1: state.pd1,
      pd2: state.pd2,
      tp1: state.tp1,
      tp2: state.tp2,
      tp3: state.tp3,
      tp1Hit: state.tp1Hit,
      tp2Hit: state.tp2Hit,
      tp3Hit: state.tp3Hit,
      broken1: state.broken1,
      broken2: state.broken2,
      pdBroken1: state.pdBroken1,
      pdBroken2: state.pdBroken2
    },
    colors: {
      bbPlusA: settings.bbPlusColorA,
      bbPlusB: settings.bbPlusColorB,
      bbMinusA: settings.bbMinusColorA,
      bbMinusB: settings.bbMinusColorB,
      swingBull: settings.swingBullColor,
      swingBear: settings.swingBearColor,
      pdText: settings.pdTextColor,
      pdLine: settings.pdSwingLineColor,
      tp: settings.tpColor
    }
  };
}

export function computeBreakerBlocksSnapshot(
  candlesInput: BreakerBlocksCandle[],
  settingsInput?: Partial<BreakerBlocksSettings> | null
): BreakerBlocksSnapshot {
  const overlay = computeBreakerBlocksOverlay(candlesInput, settingsInput);
  const lastSignals = overlay.signalsByBar[overlay.signalsByBar.length - 1] ?? emptySignals();

  return {
    dataGap: overlay.dataGap,
    dir: overlay.state.dir,
    broken: overlay.state.broken,
    mitigated: overlay.state.mitigated,
    scalp: overlay.state.scalp,
    top: overlay.state.top,
    bottom: overlay.state.bottom,
    mid: overlay.state.mid,
    line1: overlay.state.line1,
    line2: overlay.state.line2,
    pd1: overlay.state.pd1,
    pd2: overlay.state.pd2,
    tp1: overlay.state.tp1,
    tp2: overlay.state.tp2,
    tp3: overlay.state.tp3,
    tp1Hit: overlay.state.tp1Hit,
    tp2Hit: overlay.state.tp2Hit,
    tp3Hit: overlay.state.tp3Hit,
    broken1: overlay.state.broken1,
    broken2: overlay.state.broken2,
    pdBroken1: overlay.state.pdBroken1,
    pdBroken2: overlay.state.pdBroken2,
    signals: lastSignals,
    lastSignalKeys: overlay.lastSignalKeys,
    eventCounts: collectSignals(overlay.events)
  };
}

export function defaultBreakerBlocksSettings(): BreakerBlocksSettings {
  return { ...DEFAULT_BREAKER_BLOCKS_SETTINGS };
}

export function breakerBlocksSignalKeys(): BreakerBlocksSignalKey[] {
  return [...SIGNAL_KEYS];
}
