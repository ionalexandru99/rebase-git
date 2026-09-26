import type {
  EnvironmentDeviceAuthorization,
  EnvironmentHttpRoute,
  RouteFailure,
  RouteInput,
  RouteResultValue,
  RouteSuccess,
} from "@rebase/contracts";
import type { Effect, Schema } from "effect";
import type { EnvironmentAuthorizationError } from "#server/domain/environment-authorization.contract";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";

export type ServableEnvironmentHttpRoute = EnvironmentHttpRoute & {
  readonly request?: Schema.ConstraintDecoder<unknown>;
  readonly response: Schema.ConstraintCodec<
    RouteResultValue<unknown, unknown>,
    unknown,
    unknown,
    never
  >;
};

export type EnvironmentTransportError =
  | EnvironmentAuthorizationError
  | EnvironmentStorageError;

export interface EnvironmentHttpRequestContext<
  Route extends ServableEnvironmentHttpRoute = ServableEnvironmentHttpRoute,
> {
  readonly credential: string | undefined;
  readonly device: DeviceOf<Route["capability"]>;
  readonly establishBrowserSession: (credential: string) => void;
  readonly origin: string;
}

export type EnvironmentHttpRouteHandle<
  Route extends ServableEnvironmentHttpRoute,
> = (
  input: RouteInput<Route>,
  context: EnvironmentHttpRequestContext<Route>,
) => Effect.Effect<
  RouteSuccess<Route>,
  RouteFailure<Route> | EnvironmentTransportError
>;

export interface EnvironmentHttpRouteOptions {
  readonly requiresOrigin?: true;
}

export interface EnvironmentHttpRouteHandler {
  readonly route: ServableEnvironmentHttpRoute;
  readonly requiresOrigin: boolean;
  respond(
    input: unknown,
    context: EnvironmentHttpRequestContext,
  ): Effect.Effect<
    RouteResultValue<unknown, unknown>,
    EnvironmentTransportError
  >;
}

type DeviceOf<Capability> = Capability extends null
  ? undefined
  : EnvironmentDeviceAuthorization;
