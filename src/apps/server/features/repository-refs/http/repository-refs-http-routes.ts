import { RepositoryRefsHttpApi } from "@rebase/contracts";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import type {
  RepositoryRefsError,
  RepositoryRefsService,
} from "#server/domain/repository-refs.contract";

export function repositoryRefsHttpRoutes(
  refs: RepositoryRefsService,
): readonly EnvironmentHttpRouteHandler[] {
  return [
    httpRoute(
      RepositoryRefsHttpApi.checkout,
      (command) => refs.checkout(command),
      { failureStatus },
    ),
  ];
}

function failureStatus(error: RepositoryRefsError) {
  switch (error.failure._tag) {
    case "RepositoryMissing":
    case "WorktreeMissing":
    case "RefMissing":
      return 404;
    case "BranchCheckedOutElsewhere":
    case "CheckoutRejected":
      return 409;
    case "GitFailed":
      return 422;
  }
}
