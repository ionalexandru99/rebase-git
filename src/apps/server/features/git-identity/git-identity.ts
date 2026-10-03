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
import {
  type GitCommandRunner,
  type GitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const keys = { name: "user.name", email: "user.email" } as const;
const fields = ["name", "email"] as const;
const inheritedScopes = ["system", "global"];
const localScopes = ["local", "worktree"];

type ScopedValue = { readonly scope: string; readonly value: string };
type ConfigScope = "--global" | "--local";

export function gitIdentityFeature({
  access,
  events,
  git,
}: {
  readonly access: RepositoryAccess;
  readonly events: EnvironmentEventPublisher;
  readonly git: GitCommandRunner;
}) {
  const readEnvironment = readIdentity(git, homedir()).pipe(
    Effect.map((values) => pick(values, inheritedScopes)),
    Effect.mapError(identityFailed),
  );
  const readRepository = (path: string) =>
    readIdentity(git, path).pipe(
      Effect.map(
        (values): RepositoryIdentity => ({
          local: pick(values, localScopes),
          inherited: pick(values, inheritedScopes),
        }),
      ),
    );
  const changed = Effect.sync(() => events.publishChanged());
  return {
    routes: [
      route(GitIdentityApi.read, () => readEnvironment),
      route(GitIdentityApi.save, (identity) =>
        writeIdentity(git, homedir(), "--global", identity).pipe(
          Effect.mapError(identityFailed),
          Effect.andThen(changed),
          Effect.andThen(readEnvironment),
        ),
      ),
      route(GitIdentityApi.readRepository, ({ repositoryId }) =>
        access.repository(repositoryId).pipe(
          Effect.flatMap(({ path }) => readRepository(path)),
          Effect.catchTag("GitFailed", ({ detail }) =>
            Effect.fail(repositoryRejected("GitFailed", detail)),
          ),
        ),
      ),
      route(GitIdentityApi.saveRepository, ({ repositoryId, identity }) =>
        access.repository(repositoryId).pipe(
          Effect.flatMap(({ path }) =>
            writeIdentity(git, path, "--local", identity).pipe(
              Effect.andThen(changed),
              Effect.andThen(readRepository(path)),
            ),
          ),
          Effect.catchTag("GitFailed", ({ detail }) =>
            Effect.fail(repositoryRejected("GitFailed", detail)),
          ),
        ),
      ),
    ],
  } satisfies EnvironmentFeature;
}

function readIdentity(git: GitCommandRunner, directory: string) {
  return Effect.forEach(fields, (field) =>
    runRepositoryGit(
      git,
      directory,
      ["config", "-z", "--show-scope", "--get-all", keys[field]],
      { exitCodes: [0, 1] },
    ).pipe(Effect.map((output) => [field, scopedValues(output)] as const)),
  ).pipe(Effect.map((entries) => new Map(entries)));
}

function scopedValues(output: string): readonly ScopedValue[] {
  const parts = output.split("\0");
  const values: ScopedValue[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2)
    values.push({ scope: parts[index] ?? "", value: parts[index + 1] ?? "" });
  return values;
}

function pick(
  values: ReadonlyMap<keyof typeof keys, readonly ScopedValue[]>,
  scopes: readonly string[],
): GitIdentity {
  const identity: { name?: string; email?: string } = {};
  for (const field of fields) {
    const value = values
      .get(field)
      ?.filter(({ scope }) => scopes.includes(scope))
      .at(-1)
      ?.value.trim();
    if (value) identity[field] = value;
  }
  return identity;
}

function writeIdentity(
  git: GitCommandRunner,
  directory: string,
  scope: ConfigScope,
  identity: GitIdentity,
) {
  return Effect.forEach(
    fields,
    (field) => {
      const value = identity[field];
      return value === undefined
        ? runRepositoryGit(
            git,
            directory,
            ["config", scope, "--unset-all", keys[field]],
            { exitCodes: [0, 5] },
          )
        : runRepositoryGit(git, directory, [
            "config",
            scope,
            "--replace-all",
            keys[field],
            value,
          ]);
    },
    { discard: true },
  );
}

function identityFailed({ detail }: GitFailed): IdentityFailed {
  return { _tag: "IdentityFailed", detail: detail.slice(0, 2_048) };
}
