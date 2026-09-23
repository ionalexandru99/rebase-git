import { EnvironmentFilesystemHttpApi } from "@rebase/contracts";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import type {
  EnvironmentFilesystem,
  EnvironmentFilesystemError,
} from "#server/domain/environment-filesystem.contract";

export function environmentFilesystemHttpRoutes(
  filesystem: EnvironmentFilesystem,
): readonly EnvironmentHttpRouteHandler[] {
  return [
    httpRoute(
      EnvironmentFilesystemHttpApi.listDirectory,
      (directory) =>
        filesystem.listDirectory(directory.path, directory.includeHidden),
      { failureStatus },
    ),
  ];
}

function failureStatus(error: EnvironmentFilesystemError) {
  switch (error.failure.reason) {
    case "MalformedPath":
      return 400;
    case "NotFound":
      return 404;
    case "InspectionFailed":
    case "NotDirectory":
    case "PermissionDenied":
      return 422;
  }
}
