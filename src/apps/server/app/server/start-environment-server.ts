import { Effect, type Scope } from "effect";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import type { RuntimeMarkerError } from "#server/app/runtime/runtime-marker.ts";
import {
  type RuntimeRequirementsError,
  verifyRuntimeRequirements,
} from "#server/app/runtime/runtime-requirements.ts";
import type { EnvironmentServerStartError } from "#server/app/server/environment-listener.ts";
import {
  acquireEnvironment,
  type EnvironmentServer,
  type EnvironmentServerOptions,
  serveEnvironment,
} from "#server/app/server/serve-environment.ts";
import type { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation.ts";

export type {
  EnvironmentServer,
  EnvironmentServerOptions,
} from "#server/app/server/serve-environment.ts";

export function startEnvironmentServer(
  options: EnvironmentServerOptions,
): Effect.Effect<
  EnvironmentServer,
  | EnvironmentServerStartError
  | EnvironmentStorageError
  | RuntimeMarkerError
  | RuntimeRequirementsError,
  Scope.Scope
> {
  return Effect.gen(function* () {
    yield* verifyRuntimeRequirements;
    return yield* serveEnvironment(
      yield* acquireEnvironment(options.home, createLocalGitCommandRunner()),
      options,
    );
  });
}
