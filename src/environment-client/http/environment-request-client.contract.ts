import type { Effect, Schema } from "effect";
import type {
  EnvironmentHttpRejected,
  EnvironmentResponseError,
} from "#environment-client/environment-connection-errors";
import type {
  EnvironmentHttpCommand,
  RequestableEnvironmentHttpRoute,
} from "#environment-client/http/environment-http-request.contract";

export type EnvironmentHttpRoutes = Record<
  string,
  RequestableEnvironmentHttpRoute
>;

export type EnvironmentHttpRoutesFailure<Routes extends EnvironmentHttpRoutes> =
  Routes[keyof Routes]["failure"]["Type"];

export interface EnvironmentRequestErrors<
  Routes extends EnvironmentHttpRoutes,
  Error,
> {
  readonly disconnected: () => Error;
  readonly response: (
    error:
      | EnvironmentResponseError
      | EnvironmentHttpRejected<EnvironmentHttpRoutesFailure<Routes>>,
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
        command: EnvironmentHttpCommand<Routes[Name]>,
      ) => Effect.Effect<Routes[Name]["success"]["Type"], Error>
    : () => Effect.Effect<Routes[Name]["success"]["Type"], Error>;
};

export type EnvironmentRequestClient = <
  Routes extends EnvironmentHttpRoutes,
  Error,
>(
  routes: Routes,
  errors: EnvironmentRequestErrors<Routes, Error>,
) => EnvironmentHttpRoutesClient<Routes, Error>;
