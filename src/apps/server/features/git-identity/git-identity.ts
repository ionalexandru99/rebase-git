import {
  type GitIdentity,
  GitIdentityApi,
} from "#contracts/git-identity/git-identity.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import type {
  EnvironmentFeature,
  RepositoryDependencies,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type ConfigScope,
  type ScopedConfig,
  scopedValue,
} from "#server/adapters/local-git/git-config-scopes.ts";
import { gitConfigSettingRoutes } from "#server/features/git-config-settings/git-config-setting.ts";

const keys = { name: "user.name", email: "user.email" } as const;

type IdentityConfig = ScopedConfig<(typeof keys)[keyof typeof keys]>;

export function gitIdentityFeature(
  dependencies: RepositoryDependencies & {
    readonly events: EnvironmentEventPublisher;
  },
) {
  return {
    routes: gitConfigSettingRoutes(
      {
        api: GitIdentityApi,
        keys: [keys.name, keys.email],
        server: (values) => pick(values, "--global"),
        repository: (values) => ({
          local: pick(values, "--local"),
          inherited: pick(values, "--global"),
        }),
        writes: (identity: GitIdentity | null) => ({
          [keys.name]: identity?.name ?? null,
          [keys.email]: identity?.email ?? null,
        }),
      },
      dependencies,
    ),
  } satisfies EnvironmentFeature;
}

function pick(values: IdentityConfig, scope: ConfigScope): GitIdentity {
  const name = scopedValue(values, scope, keys.name);
  const email = scopedValue(values, scope, keys.email);
  return {
    ...(name === undefined ? {} : { name }),
    ...(email === undefined ? {} : { email }),
  };
}
