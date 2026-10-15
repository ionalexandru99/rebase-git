import { Effect } from "effect";
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

export function readScopedConfig<Key extends string>(
  git: GitCommandRunner,
  directory: string,
  keys: readonly Key[],
) {
  return Effect.forEach(keys, (key) =>
    runRepositoryGit(
      git,
      directory,
      ["config", "-z", "--show-scope", "--show-origin", "--get-all", key],
      { exitCodes: [0, 1] },
    ).pipe(Effect.map((output) => [key, scopedValues(output)] as const)),
  ).pipe(Effect.map((entries): ScopedConfig<Key> => new Map(entries)));
}

export function scopedValue<Key extends string>(
  values: ScopedConfig<Key>,
  scope: ConfigScope,
  key: Key,
) {
  return winner(values, scope, key)?.value.trim() || undefined;
}

export function saveScopedConfig<Key extends string>(
  git: GitCommandRunner,
  directory: string,
  scope: ConfigScope,
  keys: readonly Key[],
  writes: Readonly<Partial<Record<Key, string | null>>>,
) {
  const written = keys.filter((key) => writes[key] !== undefined);
  return Effect.forEach(
    written,
    (key) => {
      const value = writes[key];
      return value === null || value === undefined
        ? runRepositoryGit(
            git,
            directory,
            ["config", scope, "--unset-all", key],
            {
              exitCodes: [0, 5],
            },
          )
        : runRepositoryGit(git, directory, [
            "config",
            scope,
            "--replace-all",
            key,
            value,
          ]);
    },
    { discard: true },
  ).pipe(
    Effect.andThen(readScopedConfig(git, directory, keys)),
    Effect.tap((values) => {
      const key = written.find(
        (candidate) =>
          scopedValue(values, scope, candidate) !==
          (writes[candidate] ?? undefined),
      );
      const shadow = key && winner(values, scope, key);
      return key === undefined || shadow === undefined
        ? Effect.void
        : Effect.fail(
            gitFailed(
              "Failed",
              `${shadow.origin.replace(/^file:/, "")} sets ${key}, so change it there.`,
            ),
          );
    }),
  );
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
