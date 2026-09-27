import { EnvironmentFilesystemHttpApi } from "@rebase/contracts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/combine-environment-features";
import { route } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { createEnvironmentFilesystem } from "#server/features/environment-filesystem/environment-filesystem";

export function environmentFilesystemFeature(): EnvironmentFeature {
  const filesystem = createEnvironmentFilesystem();
  return {
    capabilities: [],
    httpRoutes: [
      route(EnvironmentFilesystemHttpApi.listDirectory, (directory) =>
        filesystem.listDirectory(directory.path, directory.includeHidden),
      ),
    ],
  };
}
