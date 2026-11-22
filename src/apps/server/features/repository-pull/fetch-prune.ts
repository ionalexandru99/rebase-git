import {
  type FetchPrune,
  FetchPruneApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  type ConfigScope,
  readScopedConfig,
  type ScopedConfig,
  scopedValue,
} from "#server/adapters/local-git/git-config-scopes.ts";
import type { GitConfigSetting } from "#server/features/git-config-settings/git-config-setting.ts";

const key = "fetch.prune";
const pruneByDefault = true;

type PruneConfig = ScopedConfig<typeof key>;

export const fetchPruneSetting = {
  api: FetchPruneApi,
  keys: [key],
  type: "bool",
  server: (values) => prune(values, "--global") ?? pruneByDefault,
  repository: (values) => ({
    repository: prune(values, "--local"),
    server: prune(values, "--global") ?? pruneByDefault,
  }),
  writes: (prune) => ({ [key]: prune === null ? null : String(prune) }),
} satisfies GitConfigSetting<typeof key, boolean, boolean, FetchPrune>;

export async function defaultPruneArguments(
  git: GitCommandRunner,
  path: string,
) {
  const values = await readScopedConfig(git, path, fetchPruneSetting);
  return values.get(key)?.length ? [] : ["-c", `${key}=${pruneByDefault}`];
}

function prune(values: PruneConfig, scope: ConfigScope) {
  const value = scopedValue(values, scope, key);
  return value === undefined ? null : value === "true";
}
