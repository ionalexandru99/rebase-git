import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  isPullRequestLink,
  type PullRequest,
  type PullRequestKind,
  PullRequestsApi,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import type { GitHostKind } from "#contracts/source-control/source-control.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
  route,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import { settlePolicy } from "#server/features/branch-settling/branch-settling.ts";
import {
  primaryRemoteUrl,
  remoteUrls,
} from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  type HostedPullRequest,
  repositoryFor,
  unavailable,
} from "#server/features/source-control/git-host.ts";
import type { SourceControl } from "#server/features/source-control/source-control.ts";

const pullRequestsPerBranch = 10;
const linkedAtOnce = 4;
const linkedKey = "rebaseLinkedPullRequest";
const unlinkedKey = "rebaseUnlinkedPullRequest";

export function pullRequestsFeature(
  dependencies: RepositoryDependencies & {
    readonly events: EnvironmentEventPublisher;
    readonly sourceControl: SourceControl;
  },
) {
  const { access, events, git, sourceControl } = dependencies;
  const { command } = repositoryRoutes(dependencies);
  return {
    routes: [
      route(PullRequestsApi.list, ({ repositoryId }) =>
        access.repository(repositoryId).pipe(
          Effect.flatMap((repository) =>
            listPullRequests(git, sourceControl, repository.path),
          ),
          Effect.map((found) =>
            found === undefined
              ? null
              : {
                  kind: found.kind,
                  branches: found.branches.filter(
                    ({ pullRequests }) => pullRequests.length > 0,
                  ),
                },
          ),
          Effect.catchTag("GitFailed", (failure) =>
            Effect.fail(repositoryRejected("GitFailed", failure.detail)),
          ),
        ),
      ),
      route(PullRequestsApi.find, ({ repositoryId, number }) =>
        access.repository(repositoryId).pipe(
          Effect.flatMap((repository) =>
            hostedRepository(git, sourceControl, repository.path),
          ),
          Effect.flatMap((found) =>
            found === undefined
              ? Effect.fail(unavailable)
              : found.repository.pullRequest(number).pipe(
                  Effect.map((pullRequest) => ({
                    kind: pullRequestKind(found.host.kind),
                    pullRequest:
                      pullRequest !== undefined &&
                      isPullRequestLink(pullRequest.url, found.host.kind)
                        ? shown(pullRequest)
                        : null,
                  })),
                ),
          ),
          Effect.catchTag("GitFailed", (failure) =>
            Effect.fail(repositoryRejected("GitFailed", failure.detail)),
          ),
        ),
      ),
      command(
        PullRequestsApi.link,
        settlePolicy,
        ({ branch, linked, number, repositoryId, worktreePath }, runner) =>
          Effect.gen(function* () {
            const exists = yield* runRepositoryGitOutput(
              runner,
              worktreePath,
              ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
              { exitCodes: [0, 1] },
            );
            if (exists.exitCode !== 0)
              return yield* Effect.fail(
                repositoryRejected("Missing", `${branch} no longer exists.`),
              );
            const [added, removed] = linked
              ? [linkedKey, unlinkedKey]
              : [unlinkedKey, linkedKey];
            const value = `^${number}$`;
            yield* runRepositoryGit(
              runner,
              worktreePath,
              [
                "config",
                "--local",
                "--unset-all",
                `branch.${branch}.${removed}`,
                value,
              ],
              { exitCodes: [0, 5] },
            );
            yield* runRepositoryGit(runner, worktreePath, [
              "config",
              "--local",
              "--replace-all",
              `branch.${branch}.${added}`,
              String(number),
              value,
            ]);
            events.publishChanged([repositoryId], "Refs");
            return {};
          }),
      ),
    ],
  } satisfies EnvironmentFeature;
}

export interface PullRequestBranch {
  readonly branch: string;
  readonly default: boolean;
}

export function listPullRequests(
  git: GitCommandRunner,
  sourceControl: SourceControl,
  directory: string,
  wanted: (branch: PullRequestBranch) => boolean = () => true,
) {
  return Effect.gen(function* () {
    const found = yield* hostedRepository(git, sourceControl, directory);
    if (found === undefined) return undefined;
    const { host, repository, urls } = found;
    const branches = (yield* readLocalBranches(git, directory)).filter(wanted);
    const links = yield* readLinks(git, directory);
    const automatic = branches.flatMap(({ upstream, ...branch }) => {
      const url = upstream && urls.get(upstream.remote);
      return upstream === undefined ||
        branch.default ||
        url === undefined ||
        host.repositoryId(url) !== repository.id
        ? []
        : [{ branch: branch.branch, head: upstream.head }];
    });
    const byHead =
      automatic.length === 0
        ? new Map<string, readonly HostedPullRequest[]>()
        : yield* repository.pullRequests([
            ...new Set(automatic.map(({ head }) => head)),
          ]);
    const heads = new Map(automatic.map(({ branch, head }) => [branch, head]));
    const numbers = new Set(
      branches.flatMap(({ branch }) => [...(links.get(branch)?.linked ?? [])]),
    );
    const linked = new Map(
      (yield* Effect.forEach(
        numbers,
        (number) => repository.pullRequest(number),
        { concurrency: linkedAtOnce },
      )).flatMap((pullRequest) =>
        pullRequest === undefined
          ? []
          : [[pullRequest.number, pullRequest] as const],
      ),
    );
    const listed = branches.flatMap(({ branch }) => {
      const head = heads.get(branch);
      const matched = head === undefined ? undefined : byHead.get(head);
      const link = links.get(branch);
      const added = [...(link?.linked ?? [])].flatMap(
        (number) => linked.get(number) ?? [],
      );
      if (matched === undefined && added.length === 0) return [];
      const pullRequests = new Map(
        [...(matched ?? []), ...added]
          .filter(
            ({ number, url }) =>
              !link?.unlinked.has(number) && isPullRequestLink(url, host.kind),
          )
          .map((pullRequest) => [pullRequest.number, pullRequest] as const),
      );
      return [
        {
          branch,
          pullRequests: [...pullRequests.values()]
            .sort((left, right) => openFirst(left) - openFirst(right))
            .slice(0, pullRequestsPerBranch),
        },
      ];
    });
    return { kind: pullRequestKind(host.kind), branches: listed };
  });
}

function pullRequestKind(kind: GitHostKind): PullRequestKind {
  return kind === "gitlab" ? "MergeRequest" : "PullRequest";
}

function hostedRepository(
  git: GitCommandRunner,
  sourceControl: SourceControl,
  directory: string,
) {
  return Effect.gen(function* () {
    const remotes = yield* runRepositoryGit(
      git,
      directory,
      ["config", "--get-regexp", "^remote\\..*\\.url$"],
      { exitCodes: [0, 1], maxOutputBytes: 65_536 },
    );
    const remoteUrl = primaryRemoteUrl(remotes);
    const found =
      remoteUrl === undefined
        ? undefined
        : yield* repositoryFor(yield* sourceControl.enabledHosts, remoteUrl);
    return found && { ...found, urls: remoteUrls(remotes) };
  });
}

function shown({ headCommit: _, ...pullRequest }: HostedPullRequest) {
  return pullRequest;
}

function openFirst(pullRequest: PullRequest) {
  return pullRequest.state === "Open" || pullRequest.state === "Draft" ? 0 : 1;
}

interface LocalBranch extends PullRequestBranch {
  readonly upstream?: { readonly remote: string; readonly head: string };
}

function readLocalBranches(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    [
      "for-each-ref",
      "--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(symref)",
      "refs/heads",
      "refs/remotes/**/HEAD",
    ],
    { maxOutputBytes: 16 * 1_048_576 },
  ).pipe(
    Effect.map((output) => {
      const lines = output
        .split("\n")
        .map((line) => line.split("\0"))
        .map(([ref = "", remote = "", head = "", target = ""]) => ({
          ref,
          remote,
          head,
          target,
        }));
      const defaults = new Map(
        lines.flatMap(({ ref, target }) => {
          const name = ref.slice("refs/remotes/".length, -"/HEAD".length);
          return ref.startsWith("refs/remotes/") &&
            target.startsWith(`refs/remotes/${name}/`)
            ? [[name, target.slice(`refs/remotes/${name}/`.length)] as const]
            : [];
        }),
      );
      return lines.flatMap(({ ref, remote, head }): LocalBranch[] => {
        if (!ref.startsWith("refs/heads/")) return [];
        const branch = ref.slice("refs/heads/".length);
        if (remote === "" || !head.startsWith("refs/heads/"))
          return [{ branch, default: false }];
        const upstream = { remote, head: head.slice("refs/heads/".length) };
        return [
          {
            branch,
            default: defaults.get(remote) === upstream.head,
            upstream,
          },
        ];
      });
    }),
  );
}

interface BranchLinks {
  readonly linked: Set<number>;
  readonly unlinked: Set<number>;
}

function readLinks(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    [
      "config",
      "--local",
      "--get-regexp",
      `^branch\\..*\\.(${linkedKey}|${unlinkedKey})$`.toLowerCase(),
    ],
    { exitCodes: [0, 1], maxOutputBytes: 4 * 1_048_576 },
  ).pipe(
    Effect.map((output) => {
      const links = new Map<string, BranchLinks>();
      for (const line of output.split("\n")) {
        const [key = "", value = ""] = line.split(" ");
        const number = Number(value);
        const dot = key.lastIndexOf(".");
        if (
          !key.startsWith("branch.") ||
          !(Number.isInteger(number) && number > 0)
        )
          continue;
        const branch = key.slice("branch.".length, dot);
        const link = links.get(branch) ?? {
          linked: new Set<number>(),
          unlinked: new Set<number>(),
        };
        (key.slice(dot + 1) === linkedKey.toLowerCase()
          ? link.linked
          : link.unlinked
        ).add(number);
        links.set(branch, link);
      }
      return links;
    }),
  );
}
