import type { RouteInput } from "@rebase/contracts";
import {
  createEnvironmentRequestClient,
  type RequestableEnvironmentHttpRoute,
} from "@rebase/environment-client";
import { Effect } from "effect";

export function bearerRequests(origin: string, token: string) {
  const requests = createEnvironmentRequestClient(origin, () => ({
    type: "bearer",
    value: token,
  }));
  return <Route extends RequestableEnvironmentHttpRoute>(
    route: Route,
    input: RouteInput<Route>,
  ) =>
    Effect.tryPromise({
      try: () => requests(route, input),
      catch: (error) => error,
    });
}
