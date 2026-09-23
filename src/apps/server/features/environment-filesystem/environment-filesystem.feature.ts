import { EnvironmentFilesystemHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import {
  createEnvironmentFilesystem,
  type EnvironmentFilesystemError,
} from "#server/features/environment-filesystem/environment-filesystem";

export const environmentFilesystemFeature = Effect.sync(() => {
  const filesystem = createEnvironmentFilesystem();
  return {
    capabilities: [],
    httpRoutes: [
      httpRoute(
        EnvironmentFilesystemHttpApi.listDirectory,
        (directory) =>
          filesystem.listDirectory(directory.path, directory.includeHidden),
        { failureStatus },
      ),
    ],
  } satisfies EnvironmentFeature;
});

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
