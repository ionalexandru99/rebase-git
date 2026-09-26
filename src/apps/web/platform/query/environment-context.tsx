import type { EnvironmentRpcClient } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import { createContext, type ReactNode, useContext } from "react";
import type {
  EnvironmentChanges,
  NegotiatedEnvironment,
} from "#web/platform/environment/environment-protocol.contract";
import { useEnvironmentInvalidation } from "#web/platform/query/environment-invalidation";

export type EnvironmentAvailability =
  | "available"
  | "connecting"
  | "unavailable";

export interface EnvironmentStatus {
  readonly availability: EnvironmentAvailability;
  readonly connectionState: string;
  readonly detail: string;
  readonly status: string;
}

export interface Environment {
  readonly environmentId: string | undefined;
  readonly requests: EnvironmentRequestClient;
  readonly rpc: EnvironmentRpcClient | undefined;
  readonly capabilities: NegotiatedEnvironment["capabilities"];
  readonly changes: EnvironmentChanges;
  readonly connected: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly status: EnvironmentStatus;
}

const EnvironmentContext = createContext<Environment | undefined>(undefined);

export function EnvironmentProvider({
  environment,
  children,
}: {
  readonly environment: Environment;
  readonly children?: ReactNode;
}) {
  useEnvironmentInvalidation(environment.changes, environment.connected);
  return (
    <EnvironmentContext.Provider value={environment}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment(): Environment {
  const environment = useContext(EnvironmentContext);
  if (environment === undefined)
    throw new Error("Environment workflows require an environment provider.");
  return environment;
}
