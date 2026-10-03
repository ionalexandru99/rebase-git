import { homedir } from "node:os";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  type GitHostKind,
  GitHostKind as GitHostKinds,
  type GitHostStatus,
  type GitStatus,
  SourceControlApi,
} from "#contracts/source-control/source-control.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type EnvironmentFeature,
  route,
} from "#server/adapters/environment-transport/environment-routes.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import type { Bitbucket } from "#server/features/source-control/bitbucket-host.ts";
import type { GitHost } from "#server/features/source-control/git-host.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import { gitHostTable } from "#server/persistence/environment-state.schema.ts";

export type SourceControl = ReturnType<typeof createSourceControl>;

export function createSourceControl(
  context: EnvironmentContext,
  git: GitCommandRunner,
  hosts: readonly GitHost[],
) {
  const disabledKinds = context.read(
    "Could not read Git host settings",
    async (database) =>
      new Set(
        (
          await database
            .select({ kind: gitHostTable.kind })
            .from(gitHostTable)
            .where(eq(gitHostTable.enabled, false))
        ).map(({ kind }) => kind),
      ),
  );

  return {
    enabledHosts: disabledKinds.pipe(
      Effect.map((disabled) => hosts.filter(({ kind }) => !disabled.has(kind))),
    ),
    discover: Effect.gen(function* () {
      const disabled = yield* disabledKinds;
      return yield* Effect.all(
        {
          git: gitStatus(git),
          hosts: Effect.forEach(
            GitHostKinds.literals,
            (kind) => hostStatus(hosts, kind, !disabled.has(kind)),
            { concurrency: "unbounded" },
          ),
        },
        { concurrency: "unbounded" },
      );
    }),
    setHostEnabled: (kind: GitHostKind, enabled: boolean) =>
      context.write("Could not save Git host settings", async (database) => {
        await database
          .insert(gitHostTable)
          .values({ kind, enabled })
          .onConflictDoUpdate({ target: gitHostTable.kind, set: { enabled } });
      }),
  };
}

export function sourceControlFeature({
  events,
  sourceControl,
  bitbucket,
}: {
  readonly events: EnvironmentEventPublisher;
  readonly sourceControl: SourceControl;
  readonly bitbucket: Bitbucket;
}) {
  const changed = Effect.tap(() => Effect.sync(() => events.publishChanged()));
  return {
    routes: [
      route(SourceControlApi.discover, () => sourceControl.discover),
      route(SourceControlApi.setHostEnabled, ({ kind, enabled }) =>
        sourceControl.setHostEnabled(kind, enabled).pipe(changed),
      ),
      route(SourceControlApi.saveBitbucketToken, (token) =>
        bitbucket.save(token).pipe(changed),
      ),
      route(SourceControlApi.removeBitbucketToken, () =>
        bitbucket.remove.pipe(changed),
      ),
    ],
  } satisfies EnvironmentFeature;
}

function gitStatus(git: GitCommandRunner): Effect.Effect<GitStatus> {
  return git.run({ directory: homedir(), arguments: ["--version"] }).pipe(
    Effect.map(({ exitCode, stdout }) => {
      const version = stdout.split("\n")[0]?.trim();
      return exitCode === 0 && version
        ? ({ _tag: "Available", version } as const)
        : ({ _tag: "Missing" } as const);
    }),
    Effect.orElseSucceed(() => ({ _tag: "Missing" }) as const),
  );
}

function hostStatus(
  hosts: readonly GitHost[],
  kind: GitHostKind,
  enabled: boolean,
): Effect.Effect<GitHostStatus> {
  const host = hosts.find((candidate) => candidate.kind === kind);
  if (host === undefined)
    return Effect.succeed({ _tag: "ComingSoon", kind } as const);
  return host.tool.pipe(Effect.map((tool) => ({ ...tool, kind, enabled })));
}
