import { RepositoryCatalogHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import type {
  RepositoryCatalog,
  RepositoryCatalogError,
} from "#server/domain/repository-catalog.contract";

export function repositoryCatalogHttpRoutes(
  catalog: RepositoryCatalog,
): readonly EnvironmentHttpRouteHandler[] {
  const api = RepositoryCatalogHttpApi;
  return [
    httpRoute(api.list, () =>
      Effect.map(catalog.list(), (repositories) => ({ repositories })),
    ),
    httpRoute(api.remember, (command) => catalog.remember(command.path), {
      failureStatus,
    }),
    httpRoute(
      api.recordOpened,
      (command) => catalog.recordOpened(command.repositoryId),
      { failureStatus },
    ),
    httpRoute(api.remove, (command) => catalog.remove(command.repositoryId), {
      failureStatus,
    }),
  ];
}

function failureStatus(error: RepositoryCatalogError) {
  if (error.failure._tag === "RepositoryMissing") {
    return 404;
  }
  switch (error.failure.reason) {
    case "MalformedPath":
      return 400;
    case "NotFound":
      return 404;
    case "InspectionFailed":
    case "NotDirectory":
    case "NotRepository":
      return 422;
  }
}
