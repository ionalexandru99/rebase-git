import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  isPullRequestLink,
  type PullRequest,
  PullRequestsApi,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import {
  type EnvironmentFeature,
  route,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  primaryRemoteUrl,
  remoteUrls,
} from "#server/features/repository-refs/git/read-repository-refs.ts";
import { repositoryFor } from "#server/features/source-control/git-host.ts";
import type { SourceControl } from "#server/features/source-control/source-control.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const pullRequestsPerBranch = 10;

export function pullRequestsFeature({
  access,
  git,
  sourceControl,
}: {
  readonly access: RepositoryAccess;
  readonly git: GitCommandRunner;
  readonly sourceControl: SourceControl;
}) {
  return {
    routes: [
      route(PullRequestsApi.list, ({ repositoryId }) =>
        access.repository(repositoryId).pipe(
          Effect.flatMap((repository) =>
            listPullRequests(git, sourceControl, repository.path),
          ),
          Effect.catchTag("GitFailed", (failure) =>
            Effect.fail(repositoryRejected("GitFailed", failure.detail)),
          ),
        ),
      ),
    ],
  } satisfies EnvironmentFeature;
}

export function listPullRequests(
  git: GitCommandRunner,
  sourceControl: SourceControl,
  directory: string,
  wanted: (branch: string) => boolean = () => true,
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
    if (found === undefined) return [];
    const { host, repository } = found;
    const urls = remoteUrls(remotes);
    const branches = (yield* readTrackedBranches(git, directory)).filter(
      ({ branch, remote }) => {
        const url = urls.get(remote);
        return (
          wanted(branch) &&
          url !== undefined &&
          host.repositoryId(url) === repository.id
        );
      },
    );
    if (branches.length === 0) return [];
    const byHead = yield* repository.pullRequests([
      ...new Set(branches.map(({ head }) => head)),
    ]);
    return branches.flatMap(({ branch, head }) => {
      const pullRequests = (byHead.get(head) ?? []).filter(({ url }) =>
        isPullRequestLink(url, host.kind),
      );
      return pullRequests.length === 0
        ? []
        : [
            {
              branch,
              pullRequests: pullRequests
                .sort((left, right) => openFirst(left) - openFirst(right))
                .slice(0, pullRequestsPerBranch),
            },
          ];
    });
  });
}

function openFirst(pullRequest: PullRequest) {
  return pullRequest.state === "Open" || pullRequest.state === "Draft" ? 0 : 1;
}

function readTrackedBranches(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    [
      "for-each-ref",
      "--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)",
      "refs/heads",
    ],
    { maxOutputBytes: 16 * 1_048_576 },
  ).pipe(
    Effect.map((output) =>
      output.split("\n").flatMap((line) => {
        const [ref = "", remote = "", head = ""] = line.split("\0");
        return ref.startsWith("refs/heads/") &&
          remote !== "" &&
          head.startsWith("refs/heads/")
          ? [
              {
                branch: ref.slice("refs/heads/".length),
                remote,
                head: head.slice("refs/heads/".length),
              },
            ]
          : [];
      }),
    ),
  );
}
