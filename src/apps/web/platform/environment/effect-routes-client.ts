import type { RouteFailure, RouteInput, RouteSuccess } from "@rebase/contracts";
import {
  type EnvironmentRequestClient,
  type EnvironmentRequestFailure,
  environmentRouteFailure,
  type RequestableEnvironmentHttpRoute,
} from "@rebase/environment-client";
import { Effect, type Schema } from "effect";

type Routes = Record<string, RequestableEnvironmentHttpRoute>;

export type EffectRoutesClient<Api extends Routes, Error> = {
  readonly [Name in keyof Api]: Api[Name] extends {
    readonly request: Schema.ConstraintEncoder<unknown>;
  }
    ? (
        command: RouteInput<Api[Name]>,
      ) => Effect.Effect<RouteSuccess<Api[Name]>, Error>
    : () => Effect.Effect<RouteSuccess<Api[Name]>, Error>;
};

export function effectRoutesClient<Api extends Routes, Error>(
  requests: EnvironmentRequestClient,
  routes: Api,
  toError: (
    failure: EnvironmentRequestFailure<RouteFailure<Api[keyof Api]>>,
  ) => Error,
): EffectRoutesClient<Api, Error> {
  const client: Partial<Record<keyof Api, unknown>> = {};
  for (const name of Object.keys(routes) as (keyof Api)[]) {
    const route = routes[name];
    client[name] = (command: RouteInput<typeof route>) =>
      Effect.tryPromise({
        try: (signal) => requests(route, command, { signal }),
        catch: (error) => toError(environmentRouteFailure(route, error)),
      });
  }
  return client as EffectRoutesClient<Api, Error>;
}
