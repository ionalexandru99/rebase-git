import type { RouteResultValue } from "@rebase/contracts";
import { Effect, type Schema } from "effect";
import type {
  EnvironmentHttpRequestContext,
  EnvironmentHttpRouteHandle,
  EnvironmentHttpRouteHandler,
  EnvironmentHttpRouteOptions,
  EnvironmentTransportError,
  ServableEnvironmentHttpRoute,
} from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import { EnvironmentAuthorizationError } from "#server/domain/environment-authorization.contract";
import { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";

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
