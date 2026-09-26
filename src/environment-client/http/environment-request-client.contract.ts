import type { RouteFailure, RouteInput, RouteSuccess } from "@rebase/contracts";
import type { Effect, Schema } from "effect";
import type {
  EnvironmentAccessDenied,
  EnvironmentHttpRejected,
  EnvironmentResponseError,
} from "#environment-client/environment-connection-errors";
import type { RequestableEnvironmentHttpRoute } from "#environment-client/http/environment-http-request.contract";

export type EnvironmentHttpRoutes = Record<
  string,
  RequestableEnvironmentHttpRoute
>;

export type EnvironmentHttpRoutesFailure<Routes extends EnvironmentHttpRoutes> =
  RouteFailure<Routes[keyof Routes]>;

export type EnvironmentRequestFailure<Failure> =
  | EnvironmentResponseError
  | EnvironmentAccessDenied
  | EnvironmentHttpRejected<Failure>;

export interface EnvironmentRequestErrors<
  Routes extends EnvironmentHttpRoutes,
  Error,
> {
  readonly disconnected: () => Error;
  readonly response: (
    error: EnvironmentRequestFailure<EnvironmentHttpRoutesFailure<Routes>>,
  ) => Error;
}

export type EnvironmentHttpRoutesClient<
  Routes extends EnvironmentHttpRoutes,
  Error,
> = {
  readonly [Name in keyof Routes]: Routes[Name] extends {
    readonly request: Schema.ConstraintEncoder<unknown>;
  }
    ? (
        command: RouteInput<Routes[Name]>,
      ) => Effect.Effect<RouteSuccess<Routes[Name]>, Error>
    : () => Effect.Effect<RouteSuccess<Routes[Name]>, Error>;
};

export type EnvironmentRequestClient = <
  Routes extends EnvironmentHttpRoutes,
  Error,
>(
  routes: Routes,
  errors: EnvironmentRequestErrors<Routes, Error>,
) => EnvironmentHttpRoutesClient<Routes, Error>;
