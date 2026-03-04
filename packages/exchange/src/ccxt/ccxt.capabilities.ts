import type { ExchangeCapabilities } from "../exchange.interface.js";

function hasFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "emulated" || normalized === "true";
  }
  return false;
}

export function createDefaultCcxtCapabilities(has: Record<string, unknown>): ExchangeCapabilities {
  return {
    supportsSpot: true,
    supportsPerp: hasFlag(has.fetchPositions) || hasFlag(has.setLeverage),
    supportsEditOrder: hasFlag(has.editOrder),
    supportsCancelAll: hasFlag(has.cancelAllOrders),
    supportsLeverage: hasFlag(has.setLeverage),
    supportsTpSl: false
  };
}
