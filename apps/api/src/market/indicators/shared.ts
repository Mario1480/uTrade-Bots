export function toFinite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function round(value: number | null, decimals = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    sum += value;
  }
  return sum / values.length;
}

export function std(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = mean(values);
  if (avg === null) return null;
  let sum = 0;
  for (const value of values) {
    const delta = value - avg;
    sum += delta * delta;
  }
  return Math.sqrt(sum / values.length);
}

export function smaSeries(values: number[], period: number): number[] {
  if (period <= 0 || values.length < period) return [];
  const out: number[] = [];
  let windowSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    windowSum += values[i];
    if (i >= period) {
      windowSum -= values[i - period];
    }
    if (i >= period - 1) {
      out.push(windowSum / period);
    }
  }
  return out;
}

export function emaLatest(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);
  const seed = mean(values.slice(0, period));
  if (seed === null) return null;
  let ema = seed;
  for (let i = period; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}
