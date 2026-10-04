import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq, isNotNull } from "drizzle-orm";
import { Effect, Schema } from "effect";
import {
  CloneableRepository,
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
import type { GitHost } from "#server/features/source-control/git-host.ts";
import {
  type AzureDevOpsClient,
  createAzureDevOpsClient,
  createAzureDevOpsHost,
} from "#server/features/source-control/hosts/azure-devops-host.ts";
import {
  type BitbucketClient,
  createBitbucket,
  createBitbucketClient,
} from "#server/features/source-control/hosts/bitbucket-host.ts";
import {
  createForgejoHost,
  createTeaCli,
  type TeaCli,
} from "#server/features/source-control/hosts/forgejo-host.ts";
import {
  createGitHubCli,
  createGitHubHost,
  type GitHubCli,
} from "#server/features/source-control/hosts/github-host.ts";
import {
  createGitLabCli,
  createGitLabHost,
  type GitLabCli,
} from "#server/features/source-control/hosts/gitlab-host.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import {
  gitHostTable,
  repositoryCatalogTable,
} from "#server/persistence/environment-state.schema.ts";

export type SourceControl = ReturnType<typeof createSourceControl>;

const isCloneableRepository = Schema.is(CloneableRepository);

export interface GitHostClients {
  readonly azureDevOps: AzureDevOpsClient;
  readonly bitbucket: BitbucketClient;
  readonly forgejo: TeaCli;
  readonly github: GitHubCli;
  readonly gitlab: GitLabCli;
}

export function createGitHostClients(): GitHostClients {
  return {
    azureDevOps: createAzureDevOpsClient(),
    bitbucket: createBitbucketClient(),
    forgejo: createTeaCli(),
    github: createGitHubCli(),
    gitlab: createGitLabCli(),
  };
}

export function createSourceControl(
  context: EnvironmentContext,
  git: GitCommandRunner,
  clients: GitHostClients,
) {
  const bitbucket = createBitbucket(context, clients.bitbucket);
  const hosts: readonly GitHost[] = [
    createGitHubHost(clients.github),
    createAzureDevOpsHost(clients.azureDevOps),
    bitbucket.host,
    createGitLabHost(clients.gitlab),
    createForgejoHost(clients.forgejo),
  ];
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

  const enabledHosts = disabledKinds.pipe(
    Effect.map((disabled) => hosts.filter(({ kind }) => !disabled.has(kind))),
  );

  return {
    bitbucket,
    enabledHosts,
    cloneable: Effect.gen(function* () {
      const [enabled, remotes] = yield* Effect.all(
        [enabledHosts, catalogRemotes(context)],
        { concurrency: "unbounded" },
      );
      const lists = yield* Effect.forEach(
        enabled,
        (host) =>
          (host.cloneable ?? Effect.succeed([])).pipe(
            Effect.map((lists) => {
              const cloned = new Set(
                remotes.map((url) => host.repositoryId(url) ?? url),
              );
              return lists.map((list) => ({
                ...list,
                repositories: list.repositories.filter(
                  (repository) =>
                    isCloneableRepository(repository) &&
                    !cloned.has(
                      host.repositoryId(repository.url) ?? repository.url,
                    ),
                ),
              }));
            }),
          ),
        { concurrency: "unbounded" },
      );
      return lists.flat();
    }),
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
}: {
  readonly events: EnvironmentEventPublisher;
  readonly sourceControl: SourceControl;
}) {
  const changed = Effect.tap(() => Effect.sync(() => events.publishChanged()));
  return {
    routes: [
      route(SourceControlApi.discover, () => sourceControl.discover),
      route(SourceControlApi.cloneable, () => sourceControl.cloneable),
      route(SourceControlApi.setHostEnabled, ({ kind, enabled }) =>
        sourceControl.setHostEnabled(kind, enabled).pipe(changed),
      ),
      route(SourceControlApi.saveBitbucketToken, (token) =>
        sourceControl.bitbucket.save(token).pipe(changed),
      ),
      route(SourceControlApi.removeBitbucketToken, () =>
        sourceControl.bitbucket.remove.pipe(changed),
      ),
    ],
  } satisfies EnvironmentFeature;
}

function catalogRemotes(context: EnvironmentContext) {
  return context
    .read("Could not read repository catalog", (database) =>
      database
        .selectDistinct({
          directory: repositoryCatalogTable.gitCommonDirectory,
        })
        .from(repositoryCatalogTable)
        .where(isNotNull(repositoryCatalogTable.gitCommonDirectory)),
    )
    .pipe(
      Effect.flatMap((rows) =>
        Effect.promise(() =>
          Promise.all(
            rows.map(({ directory }) =>
              readFile(join(directory ?? "", "config"), "utf8").then(
                remoteUrls,
                () => [],
              ),
            ),
          ),
        ),
      ),
      Effect.map((urls) => urls.flat()),
    );
}

function remoteUrls(config: string) {
  return [...config.matchAll(/^\s*url\s*=\s*(.+?)\s*$/gm)].flatMap(
    (match) => match[1] ?? [],
  );
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
