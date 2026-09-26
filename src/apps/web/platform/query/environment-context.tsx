import type { EnvironmentRpcClient } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import { createContext, type ReactNode, useContext } from "react";
import type { EnvironmentChanges } from "#web/platform/environment/environment-protocol.contract";
import { useEnvironmentInvalidation } from "#web/platform/query/environment-invalidation";

export interface Environment {
  readonly environmentId: string | undefined;
  readonly requests: EnvironmentRequestClient;
  readonly rpc: EnvironmentRpcClient | undefined;
  readonly changes: EnvironmentChanges;
  readonly connected: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
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
