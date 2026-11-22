import { homedir } from "node:os";
import type {
  SettingApi,
  SettingFailed,
} from "#contracts/settings/setting-routes.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type RepositoryDependencies,
  repositoryRoutes,
  route,
} from "#server/adapters/environment-transport/environment-routes.ts";
import { isGitFailed } from "#server/adapters/local-git/git-commands.ts";
import {
  type ConfigKeys,
  readScopedConfig,
  type ScopedConfig,
  saveScopedConfig,
} from "#server/adapters/local-git/git-config-scopes.ts";

export interface GitConfigSetting<Key extends string, Value, Choice, Repository>
  extends ConfigKeys<Key> {
  readonly api: SettingApi<Value, Choice, Repository>;
  readonly server: (values: ScopedConfig<Key>) => Value;
  readonly repository: (values: ScopedConfig<Key>) => Repository;
  readonly writes: (
    choice: Choice | null,
  ) => Partial<Record<Key, string | null>>;
}

export function gitConfigSettingRoutes<
  Key extends string,
  Value,
  Choice,
  Repository,
>(
  setting: GitConfigSetting<Key, Value, Choice, Repository>,
  dependencies: RepositoryDependencies & {
    readonly events: EnvironmentEventPublisher;
  },
) {
  const { events, git } = dependencies;
  const { repository } = repositoryRoutes(dependencies);
  const { api } = setting;
  return [
    route(api.read, () =>
      failingAsSetting(async () =>
        setting.server(await readScopedConfig(git, homedir(), setting)),
      ),
    ),
    route(api.save, ({ value }) =>
      failingAsSetting(async () => {
        const values = await saveScopedConfig(
          git,
          homedir(),
          "--global",
          setting,
          setting.writes(value),
        );
        events.publishChanged();
        return setting.server(values);
      }),
    ),
    repository(api.readRepository, async (_, { path }) =>
      setting.repository(await readScopedConfig(git, path, setting)),
    ),
    repository(
      api.saveRepository,
      async ({ repositoryId, value }, { path }) => {
        const values = await saveScopedConfig(
          git,
          path,
          "--local",
          setting,
          setting.writes(value),
        );
        events.publishChanged([repositoryId]);
        return setting.repository(values);
      },
    ),
  ];
}

async function failingAsSetting<Value>(run: () => Promise<Value>) {
  try {
    return await run();
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    throw {
      _tag: "SettingFailed",
      detail: error.detail.slice(0, 2_048),
    } satisfies SettingFailed;
  }
}
