import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq, isNotNull } from "drizzle-orm";
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
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { GitLfs } from "#server/features/repository-lfs/git-lfs.ts";
import {
  primaryRemote,
  remoteUrls,
} from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  type GitHost,
  repositoryFor,
} from "#server/features/source-control/git-host.ts";
import {
  type AzureDevOpsClient,
  createAzureDevOpsClient,
} from "#server/features/source-control/hosts/azure-devops-client.ts";
import { createAzureDevOpsHost } from "#server/features/source-control/hosts/azure-devops-host.ts";
import {
  type BitbucketClient,
  createBitbucketClient,
} from "#server/features/source-control/hosts/bitbucket-client.ts";
import { createBitbucket } from "#server/features/source-control/hosts/bitbucket-host.ts";
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

const isCloneableRepository = (value: unknown): value is CloneableRepository =>
  CloneableRepository.safeParse(value).success;

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
  lfs: GitLfs,
) {
  const bitbucket = createBitbucket(context, clients.bitbucket);
  const hosts: readonly GitHost[] = [
    createGitHubHost(clients.github),
    createAzureDevOpsHost(clients.azureDevOps),
    bitbucket.host,
    createGitLabHost(clients.gitlab),
    createForgejoHost(clients.forgejo),
  ];
  const disabledKinds = async () =>
    new Set(
      await context.read("Could not read Git host settings", async (database) =>
        (
          await database
            .select({ kind: gitHostTable.kind })
            .from(gitHostTable)
            .where(eq(gitHostTable.enabled, false))
        ).map(({ kind }) => kind),
      ),
    );

  const enabledHosts = async () => {
    const disabled = await disabledKinds();
    return hosts.filter(({ kind }) => !disabled.has(kind));
  };

  return {
    bitbucket,
    enabledHosts,
    hostedRepository: async (directory: string) => {
      const remotes = await runRepositoryGit(
        git,
        directory,
        ["config", "--get-regexp", "^remote\\..*\\.url$"],
        { exitCodes: [0, 1], maxOutputBytes: 65_536 },
      );
      const urls = remoteUrls(remotes);
      const remote = primaryRemote(urls);
      const remoteUrl = remote === undefined ? undefined : urls.get(remote);
      const found =
        remote === undefined || remoteUrl === undefined
          ? undefined
          : await repositoryFor(await enabledHosts(), remoteUrl);
      return found && { ...found, remote, urls };
    },
    cloneable: async () => {
      const [enabled, remotes] = await Promise.all([
        enabledHosts(),
        catalogRemotes(context),
      ]);
      const lists = await Promise.all(
        enabled.map(async (host) => {
          const cloned = new Set(
            remotes.map((url) => host.repositoryId(url) ?? url),
          );
          return (await host.cloneable()).map((list) => ({
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
      );
      return lists.flat();
    },
    discover: async () => {
      const disabled = await disabledKinds();
      const [gitState, lfsState, hostStates] = await Promise.all([
        gitStatus(git),
        lfs.rescan(),
        Promise.all(
          hosts
            .toSorted(
              (left, right) =>
                GitHostKinds.options.indexOf(left.kind) -
                GitHostKinds.options.indexOf(right.kind),
            )
            .map((host) => hostStatus(host, !disabled.has(host.kind))),
        ),
      ]);
      return { git: gitState, lfs: lfsState, hosts: hostStates };
    },
    setHostEnabled: async (kind: GitHostKind, enabled: boolean) => {
      await context.write(
        "Could not save Git host settings",
        async (database) => {
          await database
            .insert(gitHostTable)
            .values({ kind, enabled })
            .onConflictDoUpdate({
              target: gitHostTable.kind,
              set: { enabled },
            });
        },
      );
    },
  };
}

export function sourceControlFeature({
  events,
  sourceControl,
}: {
  readonly events: EnvironmentEventPublisher;
  readonly sourceControl: SourceControl;
}) {
  const changed = async (write: Promise<void>) => {
    await write;
    events.publishChanged();
  };
  return {
    routes: [
      route(SourceControlApi.discover, () => sourceControl.discover()),
      route(SourceControlApi.cloneable, () => sourceControl.cloneable()),
      route(SourceControlApi.setHostEnabled, ({ kind, enabled }) =>
        changed(sourceControl.setHostEnabled(kind, enabled)),
      ),
      route(SourceControlApi.saveBitbucketToken, (token) =>
        changed(sourceControl.bitbucket.save(token)),
      ),
      route(SourceControlApi.removeBitbucketToken, () =>
        changed(sourceControl.bitbucket.remove()),
      ),
    ],
  } satisfies EnvironmentFeature;
}

async function catalogRemotes(context: EnvironmentContext) {
  const rows = await context.read(
    "Could not read repository catalog",
    (database) =>
      database
        .selectDistinct({
          directory: repositoryCatalogTable.gitCommonDirectory,
        })
        .from(repositoryCatalogTable)
        .where(isNotNull(repositoryCatalogTable.gitCommonDirectory)),
  );
  const urls = await Promise.all(
    rows.map(({ directory }) =>
      readFile(join(directory ?? "", "config"), "utf8").then(
        configRemoteUrls,
        () => [],
      ),
    ),
  );
  return urls.flat();
}

function configRemoteUrls(config: string) {
  return [...config.matchAll(/^\s*url\s*=\s*(.+?)\s*$/gm)].flatMap(
    (match) => match[1] ?? [],
  );
}

async function gitStatus(git: GitCommandRunner): Promise<GitStatus> {
  try {
    const { exitCode, stdout } = await git.run({
      directory: homedir(),
      arguments: ["--version"],
    });
    const version = stdout.split("\n")[0]?.trim();
    return exitCode === 0 && version
      ? { _tag: "Available", version }
      : { _tag: "Missing" };
  } catch {
    return { _tag: "Missing" };
  }
}

async function hostStatus(
  host: GitHost,
  enabled: boolean,
): Promise<GitHostStatus> {
  return { ...(await host.tool()), kind: host.kind, enabled };
}
