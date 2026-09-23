import { RepositoryChangesHttpApi } from "@rebase/contracts";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import type {
  RepositoryChangesError,
  RepositoryChangesService,
} from "#server/domain/repository-changes.contract";

export function repositoryChangesHttpRoutes(
  changes: RepositoryChangesService,
): readonly EnvironmentHttpRouteHandler[] {
  const api = RepositoryChangesHttpApi;
  return [
    httpRoute(api.read, (scope) => changes.read(scope), { failureStatus }),
    httpRoute(api.diff, (command) => changes.diff(command), { failureStatus }),
    httpRoute(api.mutate, (command) => changes.mutate(command), {
      failureStatus,
    }),
    httpRoute(api.commit, (command) => changes.commit(command), {
      failureStatus,
    }),
  ];
}

function failureStatus(error: RepositoryChangesError) {
  return error.failure.reason === "Missing" ? 404 : 409;
}
