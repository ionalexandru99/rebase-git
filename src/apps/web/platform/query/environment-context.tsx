import { createContext, type ReactNode, useContext } from "react";
import type {
  EnvironmentRoute,
  RouteInput,
  RouteSuccess,
} from "#contracts/environment-connection/environment-route.contract.ts";

export type EnvironmentAvailability =
  | "available"
  | "connecting"
  | "unavailable";

export type EnvironmentConnectionState =
  | "PairingRequired"
  | "Authorizing"
  | "Connecting"
  | "Connected"
  | "Reconnecting"
  | "AuthorizationFailed"
  | "ProtocolMismatch";

export interface EnvironmentStatus {
  readonly availability: EnvironmentAvailability;
  readonly connectionState: EnvironmentConnectionState;
  readonly detail: string;
  readonly status: string;
}

export type EnvironmentRequests = <Route extends EnvironmentRoute>(
  route: Route,
  input: RouteInput<Route>,
  options?: { readonly signal?: AbortSignal },
) => Promise<RouteSuccess<Route>>;

export interface Environment {
  readonly environmentId: string | undefined;
  readonly requests: EnvironmentRequests;
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
