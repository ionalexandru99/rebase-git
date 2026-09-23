import { Effect } from "effect";
import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";
import { requestEnvironmentHttp } from "#environment-client/http/environment-http-request";
import type { EnvironmentHttpCommand } from "#environment-client/http/environment-http-request.contract";
import type {
  EnvironmentHttpRoutes,
  EnvironmentHttpRoutesClient,
  EnvironmentRequestClient,
} from "#environment-client/http/environment-request-client.contract";

export function createEnvironmentRequestClient(
  origin: string,
  credential: () => EnvironmentCredential | undefined,
): EnvironmentRequestClient {
  return (routes, errors) =>
    environmentHttpRoutesClient(routes, (route, command) =>
      Effect.suspend(() => {
        const authorized = credential();
        if (authorized === undefined) return Effect.fail(errors.disconnected());
        return requestEnvironmentHttp(origin, route, {
          command,
          credential: authorized,
        }).pipe(Effect.mapError(errors.response));
      }),
    );
}

export function environmentHttpRoutesClient<
  Routes extends EnvironmentHttpRoutes,
  Error,
>(
  routes: Routes,
  request: <Route extends Routes[keyof Routes]>(
    route: Route,
    command: EnvironmentHttpCommand<Route>,
  ) => Effect.Effect<Route["success"]["Type"], Error>,
): EnvironmentHttpRoutesClient<Routes, Error> {
  const client: Partial<Record<keyof Routes, unknown>> = {};
  for (const name of Object.keys(routes) as (keyof Routes)[]) {
    const route = routes[name];
    client[name] = (command: EnvironmentHttpCommand<typeof route>) =>
      request(route, command);
  }
  return client as EnvironmentHttpRoutesClient<Routes, Error>;
}
