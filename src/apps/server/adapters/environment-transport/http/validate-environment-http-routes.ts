import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";

export function validateEnvironmentHttpRoutes(
  routes: readonly EnvironmentHttpRouteHandler[],
) {
  const registered = new Set<string>();
  for (const { route } of routes) {
    const name = `${route.method} ${route.path}`;
    if (registered.has(name)) {
      throw new Error(`Duplicate HTTP route: ${name}`);
    }
    registered.add(name);
  }
}
