import { EnvironmentHttpApi } from "@rebase/contracts";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";

export function validateEnvironmentHttpRoutes(
  routes: readonly EnvironmentHttpRouteHandler[],
) {
  const registered = new Set<string>();
  const reservedPaths = new Set<string>([
    EnvironmentHttpApi.discovery.path,
    EnvironmentHttpApi.snapshot.path,
  ]);
  for (const { route } of routes) {
    if (reservedPaths.has(route.path)) {
      throw new Error(`Reserved HTTP route: ${route.path}`);
    }
    const name = `${route.method} ${route.path}`;
    if (registered.has(name)) {
      throw new Error(`Duplicate HTTP route: ${name}`);
    }
    registered.add(name);
  }
}
