import { createContext } from "./context.js";
import { runLoop } from "./loop.js";

export function createRunner() {
  const context = createContext();
  return {
    start() {
      runLoop(context);
    }
  };
}
