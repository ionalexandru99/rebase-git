import type { ManagedRuntime } from "effect";
import { createContext, useContext } from "react";

export const ApplicationRuntime = createContext<
  ManagedRuntime.ManagedRuntime<never, never> | undefined
>(undefined);

export function useApplicationRuntime() {
  const runtime = useContext(ApplicationRuntime);
  if (runtime === undefined) {
    throw new Error("Application workflows require a runtime provider.");
  }
  return runtime;
}
