import { execFile } from "node:child_process";
import { Effect, Schema } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type BranchPullRequests,
  type PullRequest,
  PullRequestsApi,
  type PullRequestsUnavailable,
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
  hostedRepositoryFromRemotes,
  hostedRepositoryFromUrl,
} from "#server/features/repository-refs/git/read-repository-refs.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

export interface GitHubCli {
  readonly graphql: (
    query: string,
    variables: Readonly<Record<string, string>>,
  ) => Effect.Effect<string, PullRequestsUnavailable>;
}

const unavailable: PullRequestsUnavailable = {
  _tag: "PullRequestsUnavailable",
};
const branchesPerRequest = 50;
const pullRequestsPerBranch = 10;

export function createGitHubCli(): GitHubCli {
  return {
    graphql: (query, variables) =>
      Effect.callback<string, PullRequestsUnavailable>((resume, signal) => {
        execFile(
          "gh",
          [
            "api",
            "graphql",
            "-f",
            `query=${query}`,
            ...Object.entries(variables).flatMap(([name, value]) => [
              "-f",
              `${name}=${value}`,
            ]),
          ],
          {
            env: { ...process.env, GH_PROMPT_DISABLED: "1" },
            maxBuffer: 16 * 1_048_576,
            signal,
            timeout: 30_000,
            windowsHide: true,
          },
          (error, stdout) =>
            resume(
              error === null
                ? Effect.succeed(stdout)
                : Effect.fail(unavailable),
            ),
        );
      }),
  };
}

export function pullRequestsFeature({
  access,
  git,
  github,
}: {
  readonly access: RepositoryAccess;
  readonly git: GitCommandRunner;
  readonly github: GitHubCli;
}) {
  return {
    routes: [
      route(PullRequestsApi.list, ({ repositoryId }) =>
        access.repository(repositoryId).pipe(
          Effect.flatMap((repository) =>
            listPullRequests(git, github, repository.path),
          ),
          Effect.catchTag("GitFailed", (failure) =>
            Effect.fail(repositoryRejected("GitFailed", failure.detail)),
          ),
        ),
      ),
    ],
  } satisfies EnvironmentFeature;
}

function listPullRequests(
  git: GitCommandRunner,
  github: GitHubCli,
  directory: string,
) {
  return Effect.gen(function* () {
    const remotes = yield* runRepositoryGit(
      git,
      directory,
      ["config", "--get-regexp", "^remote\\..*\\.url$"],
      { exitCodes: [0, 1], maxOutputBytes: 65_536 },
    );
    const repository = githubRepository(hostedRepositoryFromRemotes(remotes));
    if (repository === undefined) return [];
    const urls = new Map(
      remotes.split("\n").flatMap((line) => {
        const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim());
        return match?.[1] === undefined || match[2] === undefined
          ? []
          : [[match[1], match[2]] as const];
      }),
    );
    const sameRepository = (remote: string) => {
      const url = urls.get(remote);
      const candidate =
        url === undefined
          ? undefined
          : githubRepository(hostedRepositoryFromUrl(url));
      return (
        candidate !== undefined &&
        candidate.owner.toLowerCase() === repository.owner.toLowerCase() &&
        candidate.name.toLowerCase() === repository.name.toLowerCase()
      );
    };
    const tracked = (yield* readTrackedBranches(git, directory)).filter(
      ({ remote }) => sameRepository(remote),
    );
    const answers = yield* Effect.forEach(
      chunks(tracked, branchesPerRequest),
      (branches) =>
        github
          .graphql(pullRequestsQuery(branches.length), {
            owner: repository.owner,
            name: repository.name,
            ...Object.fromEntries(
              branches.map(({ head }, index) => [`b${index}`, head]),
            ),
          })
          .pipe(
            Effect.flatMap(decodeResponse),
            Effect.map((response) =>
              branches.map((branch, index) =>
                branchPullRequests(
                  branch,
                  response.data.repository?.[`b${index}`]?.nodes ?? [],
                  repository.owner,
                ),
              ),
            ),
          ),
      { concurrency: 4 },
    );
    return answers.flat().filter(({ pullRequests }) => pullRequests.length > 0);
  });
}

function githubRepository(
  repository: ReturnType<typeof hostedRepositoryFromUrl>,
) {
  return repository?.provider === "github" ? repository : undefined;
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

function pullRequestsQuery(branches: number) {
  const indexes = Array.from({ length: branches }, (_, index) => index);
  return `query($owner: String!, $name: String!${indexes.map((index) => `, $b${index}: String!`).join("")}) {
  repository(owner: $owner, name: $name) {
${indexes.map((index) => `    b${index}: pullRequests(headRefName: $b${index}, first: ${pullRequestsPerBranch}, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ...pullRequest } }`).join("\n")}
  }
}
fragment pullRequest on PullRequest {
  number url title state isDraft
  headRepositoryOwner { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;
}

const PullRequestNode = Schema.Struct({
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Schema.Boolean,
  headRepositoryOwner: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  commits: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          statusCheckRollup: Schema.NullOr(
            Schema.Struct({ state: Schema.String }),
          ),
        }),
      }),
    ),
  }),
});
type PullRequestNode = typeof PullRequestNode.Type;

const decodeResponse = (output: string) =>
  Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({
        data: Schema.Struct({
          repository: Schema.NullOr(
            Schema.Record(
              Schema.String,
              Schema.Struct({ nodes: Schema.Array(PullRequestNode) }),
            ),
          ),
        }),
      }),
    ),
  )(output).pipe(Effect.mapError(() => unavailable));

function branchPullRequests(
  { branch }: { readonly branch: string },
  nodes: readonly PullRequestNode[],
  owner: string,
): BranchPullRequests {
  return {
    branch,
    pullRequests: nodes
      .filter(
        (node) =>
          node.headRepositoryOwner?.login.toLowerCase() === owner.toLowerCase(),
      )
      .map(pullRequest)
      .sort((left, right) => openFirst(left) - openFirst(right)),
  };
}

function pullRequest(node: PullRequestNode): PullRequest {
  const checks = checksState(
    node.commits.nodes[0]?.commit.statusCheckRollup?.state,
  );
  return {
    number: node.number,
    url: node.url,
    title: node.title,
    state:
      node.state === "OPEN"
        ? node.isDraft
          ? "Draft"
          : "Open"
        : node.state === "MERGED"
          ? "Merged"
          : "Closed",
    ...(checks === undefined ? {} : { checks }),
  };
}

function checksState(state: string | undefined): PullRequest["checks"] {
  if (state === "SUCCESS") return "Passing";
  if (state === "FAILURE" || state === "ERROR") return "Failing";
  if (state === "PENDING" || state === "EXPECTED") return "Pending";
  return undefined;
}

function openFirst(pullRequest: PullRequest) {
  return pullRequest.state === "Open" || pullRequest.state === "Draft" ? 0 : 1;
}

function chunks<Item>(items: readonly Item[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );
}
