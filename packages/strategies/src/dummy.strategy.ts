import type { Strategy } from "./strategy.interface.js";

export const DummyStrategy: Strategy = {
  async onTick() {
    return { type: "none" };
  }
};