import { EnvironmentHttpApi, EnvironmentRpc } from "@rebase/contracts";
import type {
  EnvironmentFeature,
  EnvironmentRpcHandlers,
} from "#server/adapters/environment-transport/environment-feature.contract";

export function validateEnvironmentFeatures(
  features: readonly EnvironmentFeature[],
) {
  const routes = new Set<string>();
  const rpcs = new Set<string>();
  const reservedPaths = new Set([
    "/health",
    EnvironmentHttpApi.discovery.path,
    EnvironmentHttpApi.snapshot.path,
  ]);
  for (const feature of features) {
    for (const { route } of feature.httpRoutes) {
      if (reservedPaths.has(route.path)) {
        throw new Error(`Reserved HTTP route: ${route.path}`);
      }
      const name = `${route.method} ${route.path}`;
      if (routes.has(name)) {
        throw new Error(`Duplicate HTTP route: ${name}`);
      }
      routes.add(name);
    }
    for (const name of feature.rpc?.names ?? []) {
      if (name === "Hello" || name === "WatchEnvironment") {
        throw new Error(`Reserved RPC: ${name}`);
      }
      if (!EnvironmentRpc.requests.has(name)) {
        throw new Error(`Unknown RPC: ${name}`);
      }
      if (rpcs.has(name)) {
        throw new Error(`Duplicate RPC: ${name}`);
      }
      rpcs.add(name);
    }
  }
}

export function validateEnvironmentRpcHandlers(
  names: readonly string[],
  handlers: Partial<EnvironmentRpcHandlers>,
) {
  const declared = new Set(names);
  const registered = new Map<string, unknown>(Object.entries(handlers));
  for (const name of names) {
    if (typeof registered.get(name) !== "function") {
      throw new Error(`Missing RPC handler: ${name}`);
    }
  }
  for (const name of registered.keys()) {
    if (!declared.has(name)) {
      throw new Error(`Undeclared RPC handler: ${name}`);
    }
  }
}
