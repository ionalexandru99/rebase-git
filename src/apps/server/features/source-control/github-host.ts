import { execFile } from "node:child_process";
import { Effect, Schema } from "effect";
import type {
  BranchPullRequests,
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import { hostedRepositoryFromUrl } from "#server/features/repository-refs/git/read-repository-refs.ts";
import type {
  GitHost,
  TrackedBranch,
} from "#server/features/source-control/git-host.ts";

export interface GitHubCli {
  readonly version: Effect.Effect<string | undefined>;
  readonly account: Effect.Effect<string | undefined>;
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
    version: gh(["--version"]).pipe(
      Effect.map((output) => output.split("\n")[0]?.trim() || undefined),
      Effect.orElseSucceed(() => undefined),
    ),
    account: gh([
      "auth",
      "status",
      "--hostname",
      "github.com",
      "--json",
      "hosts",
    ]).pipe(
      Effect.flatMap(decodeAuthStatus),
      Effect.map(
        ({ hosts }) =>
          hosts["github.com"]?.find(
            ({ active, state }) => active && state === "success",
          )?.login,
      ),
      Effect.orElseSucceed(() => undefined),
    ),
    graphql: (query, variables) =>
      gh([
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        ...Object.entries(variables).flatMap(([name, value]) => [
          "-f",
          `${name}=${value}`,
        ]),
      ]),
  };
}

function gh(args: readonly string[]) {
  return Effect.callback<string, PullRequestsUnavailable>((resume, signal) => {
    execFile(
      "gh",
      args,
      {
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
        maxBuffer: 16 * 1_048_576,
        signal,
        timeout: 30_000,
        windowsHide: true,
      },
      (error, stdout) =>
        resume(
          error === null ? Effect.succeed(stdout) : Effect.fail(unavailable),
        ),
    );
  });
}

const decodeAuthStatus = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      hosts: Schema.Record(
        Schema.String,
        Schema.Array(
          Schema.Struct({
            active: Schema.Boolean,
            state: Schema.String,
            login: Schema.String,
          }),
        ),
      ),
    }),
  ),
);

export function createGitHubHost(cli: GitHubCli): GitHost {
  return {
    kind: "github",
    serves: (remoteUrl) => githubRepository(remoteUrl) !== undefined,
    tool: Effect.gen(function* () {
      const version = yield* cli.version;
      if (version === undefined) return { _tag: "Missing" } as const;
      const account = yield* cli.account;
      return account === undefined
        ? ({ _tag: "SignedOut", version } as const)
        : ({ _tag: "SignedIn", version, account } as const);
    }),
    pullRequests: (remoteUrl, branches) =>
      listPullRequests(cli, remoteUrl, branches),
  };
}

function listPullRequests(
  cli: GitHubCli,
  remoteUrl: string,
  branches: readonly TrackedBranch[],
) {
  const repository = githubRepository(remoteUrl);
  if (repository === undefined) return Effect.succeed([]);
  const tracked = branches.filter(({ remoteUrl }) => {
    const candidate = githubRepository(remoteUrl);
    return (
      candidate !== undefined &&
      candidate.owner.toLowerCase() === repository.owner.toLowerCase() &&
      candidate.name.toLowerCase() === repository.name.toLowerCase()
    );
  });
  return Effect.forEach(
    chunks(tracked, branchesPerRequest),
    (chunk) =>
      cli
        .graphql(pullRequestsQuery(chunk.length), {
          owner: repository.owner,
          name: repository.name,
          ...Object.fromEntries(
            chunk.map(({ head }, index) => [`b${index}`, head]),
          ),
        })
        .pipe(
          Effect.flatMap(decodeResponse),
          Effect.map((response) =>
            chunk.map((branch, index) =>
              branchPullRequests(
                branch,
                response.data.repository?.[`b${index}`]?.nodes ?? [],
                repository.owner,
              ),
            ),
          ),
        ),
    { concurrency: 4 },
  ).pipe(
    Effect.map((answers) =>
      answers.flat().filter(({ pullRequests }) => pullRequests.length > 0),
    ),
  );
}

function githubRepository(remoteUrl: string) {
  const repository = hostedRepositoryFromUrl(remoteUrl);
  return repository?.provider === "github" ? repository : undefined;
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
  { branch }: TrackedBranch,
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
