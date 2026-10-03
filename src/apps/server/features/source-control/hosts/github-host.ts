import { Effect, Schema } from "effect";
import type {
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import { hostedRepositoryFromUrl } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  type GitHost,
  hostCommandOutput,
  inBatches,
  pullRequest,
  runHostCommand,
  signedInTool,
  singleAccount,
  unavailable,
} from "#server/features/source-control/git-host.ts";

export interface GitHubCli {
  readonly version: Effect.Effect<string | undefined>;
  readonly account: Effect.Effect<string | undefined>;
  readonly graphql: (
    query: string,
    variables: Readonly<Record<string, string>>,
  ) => Effect.Effect<string, PullRequestsUnavailable>;
}

const branchesPerRequest = 50;
const pullRequestsPerBranch = 10;
const env = { GH_PROMPT_DISABLED: "1" };

export function createGitHubCli(): GitHubCli {
  return {
    version: runHostCommand("gh", ["--version"], { env }).pipe(
      Effect.map(({ succeeded, stdout }) =>
        succeeded ? stdout.split("\n")[0]?.trim() || undefined : undefined,
      ),
    ),
    account: runHostCommand("gh", ["api", "user", "--jq", ".login"], {
      env,
    }).pipe(
      Effect.map(({ succeeded, stdout }) =>
        succeeded ? stdout.trim() || undefined : undefined,
      ),
    ),
    graphql: (query, variables) =>
      hostCommandOutput(
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
        { env },
      ),
  };
}

export function createGitHubHost(cli: GitHubCli): GitHost {
  return {
    kind: "github",
    tool: signedInTool(cli.version, singleAccount("github.com", cli.account)),
    repositoryId: (remoteUrl) => githubRepository(remoteUrl)?.id,
    repository: (remoteUrl) => {
      const repository = githubRepository(remoteUrl);
      return Effect.succeed(
        repository && {
          id: repository.id,
          pullRequests: (heads) =>
            inBatches(heads, branchesPerRequest, (batch) =>
              cli
                .graphql(pullRequestsQuery(batch.length), {
                  owner: repository.owner,
                  name: repository.name,
                  ...Object.fromEntries(
                    batch.map((head, index) => [`b${index}`, head]),
                  ),
                })
                .pipe(
                  Effect.flatMap(decodeResponse),
                  Effect.map(({ data }) =>
                    batch.map((_, index) =>
                      pullRequests(
                        data.repository?.[`b${index}`]?.nodes ?? [],
                        repository.owner,
                      ),
                    ),
                  ),
                ),
            ),
        },
      );
    },
  };
}

function githubRepository(remoteUrl: string) {
  const repository = hostedRepositoryFromUrl(remoteUrl);
  return repository?.provider === "github"
    ? {
        owner: repository.owner,
        name: repository.name,
        id: `${repository.owner}/${repository.name}`.toLowerCase(),
      }
    : undefined;
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

function pullRequests(
  nodes: readonly PullRequestNode[],
  owner: string,
): readonly PullRequest[] {
  return nodes
    .filter(
      (node) =>
        node.headRepositoryOwner?.login.toLowerCase() === owner.toLowerCase(),
    )
    .map((node) =>
      pullRequest(
        {
          kind: "PullRequest",
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
        },
        checksState(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
      ),
    );
}

function checksState(state: string | undefined): PullRequest["checks"] {
  if (state === "SUCCESS") return "Passing";
  if (state === "FAILURE" || state === "ERROR") return "Failing";
  if (state === "PENDING" || state === "EXPECTED") return "Pending";
  return undefined;
}
