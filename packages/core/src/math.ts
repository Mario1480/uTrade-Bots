export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function normalizeWeights(ws: number[]): number[] {
  const s = sum(ws);
  if (s <= 0) return ws.map(() => 1 / ws.length);
  return ws.map((w) => w / s);
}

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let state = (Math.floor(seed) >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function randBetween(min: number, max: number, rng?: Rng): number {
  const next = rng ? rng() : Math.random();
  return min + next * (max - min);
}
