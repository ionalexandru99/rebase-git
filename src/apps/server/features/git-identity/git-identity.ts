import { homedir } from "node:os";
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
import {
  type GitCommandRunner,
  isGitFailed,
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
        failingAsIdentity(async () =>
          pick(await readScopedConfig(git, homedir(), configKeys), "--global"),
        ),
      ),
      route(GitIdentityApi.save, (identity) =>
        failingAsIdentity(async () => {
          const values = await saveIdentity(
            git,
            homedir(),
            "--global",
            identity,
          );
          events.publishChanged();
          return pick(values, "--global");
        }),
      ),
      route(GitIdentityApi.readRepository, async ({ repositoryId }) => {
        const { path } = await access.repository(repositoryId);
        return rejectingGitFailures(async () =>
          repositoryIdentity(await readScopedConfig(git, path, configKeys)),
        );
      }),
      route(
        GitIdentityApi.saveRepository,
        async ({ repositoryId, identity }) => {
          const { path } = await access.repository(repositoryId);
          return rejectingGitFailures(async () => {
            const values = await saveIdentity(git, path, "--local", identity);
            events.publishChanged([repositoryId]);
            return repositoryIdentity(values);
          });
        },
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

async function failingAsIdentity<Value>(run: () => Promise<Value>) {
  try {
    return await run();
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    throw {
      _tag: "IdentityFailed",
      detail: error.detail.slice(0, 2_048),
    } satisfies IdentityFailed;
  }
}

async function rejectingGitFailures<Value>(run: () => Promise<Value>) {
  try {
    return await run();
  } catch (error) {
    throw isGitFailed(error)
      ? repositoryRejected("GitFailed", error.detail)
      : error;
  }
}
