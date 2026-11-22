import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { verifyRuntimeRequirements } from "#server/app/runtime/runtime-requirements.ts";
import { acquireScoped } from "#server/app/server/resource-scope.ts";
import {
  acquireEnvironment,
  type EnvironmentServerOptions,
  serveEnvironment,
} from "#server/app/server/serve-environment.ts";

export type {
  EnvironmentServer,
  EnvironmentServerOptions,
} from "#server/app/server/serve-environment.ts";

export async function startEnvironmentServer(
  options: EnvironmentServerOptions,
) {
  await verifyRuntimeRequirements();
  return acquireScoped(async (scope) => {
    const dependencies = scope.use(
      await acquireEnvironment(options.home, createLocalGitCommandRunner()),
    );
    const { close, ...server } = await serveEnvironment(dependencies, options);
    scope.defer(close);
    return server;
  });
}
