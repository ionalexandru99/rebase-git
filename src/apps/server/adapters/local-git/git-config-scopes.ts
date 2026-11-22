import {
  type GitCommandRunner,
  gitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";

export type ConfigScope = "--global" | "--local";

type ScopedValue = {
  readonly scope: string;
  readonly origin: string;
  readonly value: string;
};

export type ScopedConfig<Key extends string> = ReadonlyMap<
  Key,
  readonly ScopedValue[]
>;

const scopes: Readonly<Record<ConfigScope, readonly string[]>> = {
  "--global": ["system", "global"],
  "--local": ["local", "worktree"],
};

export async function readScopedConfig<Key extends string>(
  git: GitCommandRunner,
  directory: string,
  keys: readonly Key[],
): Promise<ScopedConfig<Key>> {
  const values = new Map<Key, readonly ScopedValue[]>();
  for (const key of keys)
    values.set(
      key,
      scopedValues(
        await runRepositoryGit(
          git,
          directory,
          ["config", "-z", "--show-scope", "--show-origin", "--get-all", key],
          { exitCodes: [0, 1] },
        ),
      ),
    );
  return values;
}

export function scopedValue<Key extends string>(
  values: ScopedConfig<Key>,
  scope: ConfigScope,
  key: Key,
) {
  return winner(values, scope, key)?.value.trim() || undefined;
}

export async function saveScopedConfig<Key extends string>(
  git: GitCommandRunner,
  directory: string,
  scope: ConfigScope,
  keys: readonly Key[],
  writes: Readonly<Partial<Record<Key, string | null>>>,
) {
  const written = keys.filter((key) => writes[key] !== undefined);
  for (const key of written) {
    const value = writes[key];
    if (value === null || value === undefined)
      await runRepositoryGit(
        git,
        directory,
        ["config", scope, "--unset-all", key],
        { exitCodes: [0, 5] },
      );
    else
      await runRepositoryGit(git, directory, [
        "config",
        scope,
        "--replace-all",
        key,
        value,
      ]);
  }
  const values = await readScopedConfig(git, directory, keys);
  const key = written.find(
    (candidate) =>
      scopedValue(values, scope, candidate) !==
      (writes[candidate] ?? undefined),
  );
  const shadow = key && winner(values, scope, key);
  if (key !== undefined && shadow !== undefined)
    throw gitFailed(
      "Failed",
      `${shadow.origin.replace(/^file:/, "")} sets ${key}, so change it there.`,
    );
  return values;
}

function scopedValues(output: string): readonly ScopedValue[] {
  const parts = output.split("\0");
  const values: ScopedValue[] = [];
  for (let index = 0; index + 2 < parts.length; index += 3)
    values.push({
      scope: parts[index] ?? "",
      origin: parts[index + 1] ?? "",
      value: parts[index + 2] ?? "",
    });
  return values;
}

function winner<Key extends string>(
  values: ScopedConfig<Key>,
  scope: ConfigScope,
  key: Key,
) {
  return values
    .get(key)
    ?.filter((value) => scopes[scope].includes(value.scope))
    .at(-1);
}
