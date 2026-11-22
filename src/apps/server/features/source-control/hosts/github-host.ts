import { z } from "zod";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import { remotePath } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  avatarUrl,
  cloneableRepository,
  decodeHostJson,
  foundAvatar,
  type GitHost,
  graphqlArguments,
  type HostedPullRequest,
  hostCommandOutput,
  hostCommandText,
  inAliasedBatches,
  pullRequest,
  readRepositoryPages,
  repositoriesPerPage,
  sameEmail,
  signedInTool,
  singleAccount,
} from "#server/features/source-control/git-host.ts";

export interface GitHubCli {
  readonly version: () => Promise<string | undefined>;
  readonly account: () => Promise<string | undefined>;
  readonly protocol: () => Promise<string | undefined>;
  readonly repositories: (page: number) => Promise<string>;
  readonly graphql: (
    query: string,
    variables: Readonly<Record<string, string>>,
  ) => Promise<string>;
}

const branchesPerRequest = 50;
const pullRequestsPerBranch = 10;
const env = { GH_PROMPT_DISABLED: "1" };

export function createGitHubCli(): GitHubCli {
  const gh = (args: readonly string[]) => hostCommandText("gh", args, { env });
  return {
    version: async () => (await gh(["--version"]))?.split("\n")[0]?.trim(),
    account: () => gh(["api", "user", "--jq", ".login"]),
    protocol: () =>
      gh(["config", "get", "git_protocol", "--host", "github.com"]),
    repositories: (page) =>
      hostCommandOutput(
        "gh",
        [
          "api",
          `user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=${repositoriesPerPage}&page=${page}`,
        ],
        { env },
      ),
    graphql: (query, variables) =>
      hostCommandOutput(
        "gh",
        ["api", "graphql", ...graphqlArguments(query, variables)],
        { env },
      ),
  };
}

export function createGitHubHost(cli: GitHubCli): GitHost {
  return {
    kind: "github",
    tool: signedInTool(cli.version, singleAccount("github.com", cli.account)),
    repositoryId: (remoteUrl) => githubRepository(remoteUrl)?.id,
    cloneable: async () => {
      try {
        const account = await cli.account();
        if (account === undefined) return [];
        const ssh = (await cli.protocol()) === "ssh";
        const repositories = await readRepositoryPages(async (page) =>
          decodeRepositoryPage(await cli.repositories(page)),
        );
        return [
          {
            kind: "github" as const,
            host: "github.com",
            account,
            repositories: repositories.map((repository) =>
              cloneableRepository({
                name: repository.full_name,
                url: ssh ? repository.ssh_url : repository.clone_url,
                private: repository.private,
                description: repository.description,
                updatedAt: repository.pushed_at,
              }),
            ),
          },
        ];
      } catch {
        return [];
      }
    },
    repository: async (remoteUrl) => {
      const repository = githubRepository(remoteUrl);
      return (
        repository && {
          id: repository.id,
          pullRequests: (heads) =>
            inAliasedBatches(
              heads,
              { size: branchesPerRequest, perHead: pullRequestsPerBranch },
              async (aliases) =>
                decodeResponse(
                  await cli.graphql(pullRequestsQuery(Object.keys(aliases)), {
                    owner: repository.owner,
                    name: repository.name,
                    ...aliases,
                  }),
                ).data.repository,
              (nodes) => pullRequests(nodes, repository.owner),
            ),
          pullRequest: async (number) => {
            try {
              const answer = decodePullRequestResponse(
                await cli.graphql(pullRequestQuery(number), {
                  owner: repository.owner,
                  name: repository.name,
                }),
              ).data.repository;
              return answer === null || answer.pullRequest === null
                ? undefined
                : githubPullRequest(answer.pullRequest);
            } catch {
              return undefined;
            }
          },
          avatar: async (author) => {
            const { data } = decodeAvatarResponse(
              await cli.graphql(avatarQuery, {
                owner: repository.owner,
                name: repository.name,
                oid: author.commit,
              }),
            );
            const found = data.repository?.object?.author;
            const url =
              found !== undefined &&
              found !== null &&
              sameEmail(found.email, author)
                ? avatarUrl(found.user?.avatarUrl, [
                    "avatars.githubusercontent.com",
                  ])
                : undefined;
            return foundAvatar(url);
          },
        }
      );
    },
  };
}

const avatarQuery = `query($owner: String!, $name: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) { ... on Commit { author { email user { avatarUrl(size: 40) } } } }
  }
}`;

const decodeAvatarResponse = decodeHostJson(
  z.object({
    data: z.object({
      repository: z
        .object({
          object: z
            .object({
              author: z
                .object({
                  email: z.string().nullable(),
                  user: z.object({ avatarUrl: z.string() }).nullable(),
                })
                .nullable()
                .optional(),
            })
            .nullable(),
        })
        .nullable(),
    }),
  }),
);

const decodeRepositoryPage = decodeHostJson(
  z.array(
    z.object({
      full_name: z.string(),
      private: z.boolean(),
      description: z.string().nullable(),
      pushed_at: z.string().nullable(),
      clone_url: z.string(),
      ssh_url: z.string(),
    }),
  ),
);

function githubRepository(remoteUrl: string) {
  const remote = remotePath(remoteUrl);
  if (remote?.host !== "github.com") return undefined;
  const [owner, name, ...rest] = remote.parts;
  return owner === undefined ||
    name === undefined ||
    rest.length > 0 ||
    !isGitHubName(owner) ||
    !isGitHubName(name)
    ? undefined
    : { owner, name, id: `${owner}/${name}`.toLowerCase() };
}

function isGitHubName(value: string) {
  return /^(?!\.{1,2}$)[\w.-]{1,100}$/.test(value);
}

function pullRequestsQuery(aliases: readonly string[]) {
  return `query($owner: String!, $name: String!${aliases.map((alias) => `, $${alias}: String!`).join("")}) {
  repository(owner: $owner, name: $name) {
${aliases.map((alias) => `    ${alias}: pullRequests(headRefName: $${alias}, first: ${pullRequestsPerBranch}, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ...pullRequest } }`).join("\n")}
  }
}
${pullRequestFragment}`;
}

function pullRequestQuery(number: number) {
  return `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: ${number}) { ...pullRequest }
  }
}
${pullRequestFragment}`;
}

const pullRequestFragment = `fragment pullRequest on PullRequest {
  number url title state isDraft headRefOid
  headRepositoryOwner { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

const PullRequestNode = z.object({
  number: z.number().int(),
  url: z.string(),
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  headRefOid: z.string().optional(),
  headRepositoryOwner: z.object({ login: z.string() }).nullable(),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z.object({ state: z.string() }).nullable(),
        }),
      }),
    ),
  }),
});
type PullRequestNode = z.infer<typeof PullRequestNode>;

const decodeResponse = decodeHostJson(
  z.object({
    data: z.object({
      repository: z
        .record(z.string(), z.object({ nodes: z.array(PullRequestNode) }))
        .nullable(),
    }),
  }),
);

const decodePullRequestResponse = decodeHostJson(
  z.object({
    data: z.object({
      repository: z
        .object({ pullRequest: PullRequestNode.nullable() })
        .nullable(),
    }),
  }),
);

function pullRequests(
  nodes: readonly PullRequestNode[],
  owner: string,
): readonly HostedPullRequest[] {
  return nodes
    .filter(
      (node) =>
        node.headRepositoryOwner?.login.toLowerCase() === owner.toLowerCase(),
    )
    .map(githubPullRequest);
}

function githubPullRequest(node: PullRequestNode): HostedPullRequest {
  return pullRequest(
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
    node.headRefOid,
  );
}

function checksState(state: string | undefined): PullRequest["checks"] {
  if (state === "SUCCESS") return "Passing";
  if (state === "FAILURE" || state === "ERROR") return "Failing";
  if (state === "PENDING" || state === "EXPECTED") return "Pending";
  return undefined;
}
