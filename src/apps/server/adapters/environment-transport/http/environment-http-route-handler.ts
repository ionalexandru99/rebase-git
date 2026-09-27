import type {
  EnvironmentDeviceAuthorization,
  EnvironmentHttpRoute,
  RouteFailure,
  RouteInput,
  RouteResultValue,
  RouteSuccess,
} from "@rebase/contracts";
import { Effect, type Schema } from "effect";
import { EnvironmentAuthorizationError } from "#server/features/environment-authorization/environment-authorization";
import { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation";

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
  readonly device: DeviceOf<Route["public"]>;
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

type DeviceOf<Public> = Public extends true
  ? undefined
  : EnvironmentDeviceAuthorization;

export type ResultHttpRoute<Input, Success, Failure> =
  ServableEnvironmentHttpRoute & {
    readonly request: Schema.ConstraintDecoder<Input>;
    readonly response: {
      readonly Type: RouteResultValue<Success, Failure>;
    };
  };

export function route<Route extends ServableEnvironmentHttpRoute>(
  definition: Route,
  handle: EnvironmentHttpRouteHandle<Route>,
  options?: EnvironmentHttpRouteOptions,
): EnvironmentHttpRouteHandler {
  return routeHandler(definition, handle, options);
}

export function resultRoute<Input, Success, Failure>(
  definition: ResultHttpRoute<Input, Success, Failure>,
  handle: (
    input: Input,
  ) => Effect.Effect<
    NoInfer<Success>,
    NoInfer<Failure> | EnvironmentTransportError
  >,
): EnvironmentHttpRouteHandler {
  return routeHandler(definition, handle);
}

function routeHandler<
  Route extends ServableEnvironmentHttpRoute,
  Input,
  Success,
  Failure,
>(
  definition: Route,
  handle: (
    input: Input,
    context: EnvironmentHttpRequestContext<Route>,
  ) => Effect.Effect<Success, Failure | EnvironmentTransportError>,
  options?: EnvironmentHttpRouteOptions,
): EnvironmentHttpRouteHandler {
  return {
    route: definition,
    requiresOrigin: options?.requiresOrigin ?? false,
    respond: (input: Input, context: EnvironmentHttpRequestContext<Route>) =>
      handle(input, context).pipe(
        Effect.map(
          (value): RouteResultValue<Success, Failure> => ({
            _tag: "Ok",
            value,
          }),
        ),
        Effect.catch((error) =>
          isTransportError(error)
            ? Effect.fail(error)
            : Effect.succeed<RouteResultValue<Success, Failure>>({
                _tag: "Rejected",
                failure: error,
              }),
        ),
      ),
  };
}

function isTransportError(error: unknown): error is EnvironmentTransportError {
  return (
    error instanceof EnvironmentAuthorizationError ||
    error instanceof EnvironmentStorageError
  );
}
