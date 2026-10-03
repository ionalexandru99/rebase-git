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
  gitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const keys = { name: "user.name", email: "user.email" } as const;
const fields = ["name", "email"] as const;
const inheritedScopes = ["system", "global"];
const localScopes = ["local", "worktree"];

type Field = (typeof fields)[number];
type ConfigScope = "--global" | "--local";
type ScopedValue = {
  readonly scope: string;
  readonly origin: string;
  readonly value: string;
};
type ScopedValues = ReadonlyMap<Field, readonly ScopedValue[]>;

export function gitIdentityFeature({
  access,
  events,
  git,
}: {
  readonly access: RepositoryAccess;
  readonly events: EnvironmentEventPublisher;
  readonly git: GitCommandRunner;
}) {
  const repositoryIdentity = (values: ScopedValues): RepositoryIdentity => ({
    local: pick(values, localScopes),
    inherited: pick(values, inheritedScopes),
  });
  return {
    routes: [
      route(GitIdentityApi.read, () =>
        readIdentity(git, homedir()).pipe(
          Effect.map((values) => pick(values, inheritedScopes)),
          Effect.mapError(identityFailed),
        ),
      ),
      route(GitIdentityApi.save, (identity) =>
        saveIdentity(git, homedir(), "--global", identity).pipe(
          Effect.tap(() => Effect.sync(() => events.publishChanged())),
          Effect.map((values) => pick(values, inheritedScopes)),
          Effect.mapError(identityFailed),
        ),
      ),
      route(GitIdentityApi.readRepository, ({ repositoryId }) =>
        access.repository(repositoryId).pipe(
          Effect.flatMap(({ path }) => readIdentity(git, path)),
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
  const scopes = scope === "--global" ? inheritedScopes : localScopes;
  return writeIdentity(git, directory, scope, identity).pipe(
    Effect.andThen(readIdentity(git, directory)),
    Effect.tap((values) => {
      const field = fields.find(
        (candidate) =>
          (winner(values, scopes, candidate)?.value.trim() || undefined) !==
          identity[candidate],
      );
      const shadow = field && winner(values, scopes, field);
      return field === undefined || shadow === undefined
        ? Effect.void
        : Effect.fail(
            gitFailed(
              "Failed",
              `${shadow.origin.replace(/^file:/, "")} sets ${keys[field]}, so change it there.`,
            ),
          );
    }),
  );
}

function readIdentity(git: GitCommandRunner, directory: string) {
  return Effect.forEach(fields, (field) =>
    runRepositoryGit(
      git,
      directory,
      [
        "config",
        "-z",
        "--show-scope",
        "--show-origin",
        "--get-all",
        keys[field],
      ],
      { exitCodes: [0, 1] },
    ).pipe(Effect.map((output) => [field, scopedValues(output)] as const)),
  ).pipe(Effect.map((entries): ScopedValues => new Map(entries)));
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

function winner(values: ScopedValues, scopes: readonly string[], field: Field) {
  return values
    .get(field)
    ?.filter(({ scope }) => scopes.includes(scope))
    .at(-1);
}

function pick(values: ScopedValues, scopes: readonly string[]): GitIdentity {
  const identity: { name?: string; email?: string } = {};
  for (const field of fields) {
    const value = winner(values, scopes, field)?.value.trim();
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
