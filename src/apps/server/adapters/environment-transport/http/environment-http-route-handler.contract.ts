import type {
  EnvironmentDeviceAuthorization,
  EnvironmentHttpRoute,
} from "@rebase/contracts";
import type { Effect, Schema } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type { EnvironmentAuthorizationError } from "#server/features/environment-authorization/environment-authorization.contract";

export type ServableEnvironmentHttpRoute = EnvironmentHttpRoute & {
  readonly failure: Schema.ConstraintEncoder<unknown>;
  readonly request?: Schema.ConstraintDecoder<unknown>;
  readonly success: Schema.ConstraintEncoder<unknown>;
};

export type EnvironmentHttpRouteCommand<
  Route extends ServableEnvironmentHttpRoute,
> = Route extends { readonly request?: infer Request }
  ? CommandOf<Request>
  : undefined;

export type EnvironmentHttpFailureStatus<
  Route extends ServableEnvironmentHttpRoute,
> = Route["failureStatuses"][number];

export interface EnvironmentHttpRequestContext<
  Route extends ServableEnvironmentHttpRoute = ServableEnvironmentHttpRoute,
> {
  readonly credential: string | undefined;
  readonly device: DeviceOf<Route["capability"]>;
  readonly establishBrowserSession: (credential: string) => void;
  readonly origin: string;
}

export interface EnvironmentHttpRouteFailure {
  readonly failure: unknown;
}

export type EnvironmentHttpRouteHandle<
  Route extends ServableEnvironmentHttpRoute,
  Failure extends EnvironmentHttpRouteFailure,
> = (
  command: EnvironmentHttpRouteCommand<Route>,
  context: EnvironmentHttpRequestContext<Route>,
) => Effect.Effect<
  Route["success"]["Type"],
  Failure | EnvironmentAuthorizationError | EnvironmentStorageError
>;

export interface EnvironmentHttpRouteOptions {
  readonly requiresOrigin?: true;
}

export interface EnvironmentHttpRouteFailureOptions<
  Route extends ServableEnvironmentHttpRoute,
  Failure extends EnvironmentHttpRouteFailure,
> extends EnvironmentHttpRouteOptions {
  readonly failureStatus: (
    failure: Failure,
  ) => EnvironmentHttpFailureStatus<Route>;
}

export interface EnvironmentHttpRouteHandler<
  Route extends ServableEnvironmentHttpRoute = ServableEnvironmentHttpRoute,
  Failure extends EnvironmentHttpRouteFailure = EnvironmentHttpRouteFailure,
> {
  readonly route: Route;
  readonly requiresOrigin: boolean;
  handle(
    command: EnvironmentHttpRouteCommand<Route>,
    context: EnvironmentHttpRequestContext<Route>,
  ): Effect.Effect<
    Route["success"]["Type"],
    Failure | EnvironmentAuthorizationError | EnvironmentStorageError
  >;
  failureStatus?(failure: Failure): EnvironmentHttpFailureStatus<Route>;
}

type CommandOf<Request> = Request extends Schema.Top
  ? Request["Type"]
  : undefined;

type DeviceOf<Capability> = Capability extends null
  ? undefined
  : EnvironmentDeviceAuthorization;
