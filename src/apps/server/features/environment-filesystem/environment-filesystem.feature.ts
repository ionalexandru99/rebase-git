import { EnvironmentFilesystemHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { route } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { createEnvironmentFilesystem } from "#server/features/environment-filesystem/environment-filesystem";

export const environmentFilesystemFeature = Effect.sync(() => {
  const filesystem = createEnvironmentFilesystem();
  return {
    capabilities: [],
    httpRoutes: [
      route(EnvironmentFilesystemHttpApi.listDirectory, (directory) =>
        filesystem.listDirectory(directory.path, directory.includeHidden),
      ),
    ],
  } satisfies EnvironmentFeature;
});
