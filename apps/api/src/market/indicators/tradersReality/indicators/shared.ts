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
