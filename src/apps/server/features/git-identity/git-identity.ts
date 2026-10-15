import { homedir } from "node:os";
import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type GitIdentity,
  GitIdentityApi,
  type IdentityFailed,
  type RepositoryIdentity,
} from "#contracts/git-identity/git-identity.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type EnvironmentFeature,
  route,
} from "#server/adapters/environment-transport/environment-routes.ts";
import type {
  GitCommandRunner,
  GitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import {
  type ConfigScope,
  readScopedConfig,
  type ScopedConfig,
  saveScopedConfig,
  scopedValue,
} from "#server/adapters/local-git/git-config-scopes.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const keys = { name: "user.name", email: "user.email" } as const;
const configKeys = [keys.name, keys.email];

type IdentityKey = (typeof configKeys)[number];
type IdentityConfig = ScopedConfig<IdentityKey>;

export function gitIdentityFeature({
  access,
  events,
  git,
}: {
  readonly access: RepositoryAccess;
  readonly events: EnvironmentEventPublisher;
  readonly git: GitCommandRunner;
}) {
  const repositoryIdentity = (values: IdentityConfig): RepositoryIdentity => ({
    local: pick(values, "--local"),
    inherited: pick(values, "--global"),
  });
  return {
    routes: [
      route(GitIdentityApi.read, () =>
        readScopedConfig(git, homedir(), configKeys).pipe(
          Effect.map((values) => pick(values, "--global")),
          Effect.mapError(identityFailed),
        ),
      ),
      route(GitIdentityApi.save, (identity) =>
        saveIdentity(git, homedir(), "--global", identity).pipe(
          Effect.tap(() => Effect.sync(() => events.publishChanged())),
          Effect.map((values) => pick(values, "--global")),
          Effect.mapError(identityFailed),
        ),
      ),
      route(GitIdentityApi.readRepository, ({ repositoryId }) =>
        access.repository(repositoryId).pipe(
          Effect.flatMap(({ path }) => readScopedConfig(git, path, configKeys)),
          Effect.map(repositoryIdentity),
          Effect.catchTag("GitFailed", ({ detail }) =>
            Effect.fail(repositoryRejected("GitFailed", detail)),
          ),
        ),
      ),
      route(GitIdentityApi.saveRepository, ({ repositoryId, identity }) =>
        access.repository(repositoryId).pipe(
          Effect.flatMap(({ path }) =>
            saveIdentity(git, path, "--local", identity),
          ),
          Effect.tap(() =>
            Effect.sync(() => events.publishChanged([repositoryId])),
          ),
          Effect.map(repositoryIdentity),
          Effect.catchTag("GitFailed", ({ detail }) =>
            Effect.fail(repositoryRejected("GitFailed", detail)),
          ),
        ),
      ),
    ],
  } satisfies EnvironmentFeature;
}

function saveIdentity(
  git: GitCommandRunner,
  directory: string,
  scope: ConfigScope,
  identity: GitIdentity,
) {
  return saveScopedConfig(git, directory, scope, configKeys, {
    [keys.name]: identity.name ?? null,
    [keys.email]: identity.email ?? null,
  });
}

function pick(values: IdentityConfig, scope: ConfigScope): GitIdentity {
  const name = scopedValue(values, scope, keys.name);
  const email = scopedValue(values, scope, keys.email);
  return {
    ...(name === undefined ? {} : { name }),
    ...(email === undefined ? {} : { email }),
  };
}

function identityFailed({ detail }: GitFailed): IdentityFailed {
  return { _tag: "IdentityFailed", detail: detail.slice(0, 2_048) };
}
