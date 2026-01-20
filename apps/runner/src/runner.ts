import { createContext } from "./context.js";

export function createRunner() {
  const context = createContext();
  return {
    start() {
      void context;
    }
  };
}
