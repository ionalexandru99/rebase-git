import { z } from "zod";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import type { HostRepositories } from "#contracts/source-control/source-control.contract.ts";
import { remotePath } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  avatarUrl,
  cloneableRepository,
  decodeHostJson,
  foundAvatar,
  type GitHost,
  type GitHostAccount,
  graphqlArguments,
  gravatarHosts,
  type HostedPullRequest,
  hostCommandOutput,
  hostCommandText,
  inAliasedBatches,
  pullRequest,
  readRepositoryPages,
  repositoriesPerPage,
  runHostCommand,
  signedInTool,
} from "#server/features/source-control/git-host.ts";

export interface GitLabCli {
  readonly version: () => Promise<string | undefined>;
  readonly authStatus: (hostname?: string) => Promise<string>;
  readonly protocol: (hostname: string) => Promise<string | undefined>;
  readonly repositories: (hostname: string, page: number) => Promise<string>;
  readonly graphql: (
    hostname: string,
    query: string,
    variables: Readonly<Record<string, string>>,
  ) => Promise<string>;
  readonly avatar: (hostname: string, email: string) => Promise<string>;
}

interface GitLabProject {
  readonly id: string;
  readonly host: string;
  readonly path: string;
}

const branchesPerRequest = 12;
const mergeRequestsPerBranch = 10;
const env = { GLAB_CHECK_UPDATE: "false", NO_PROMPT: "true" };

export function createGitLabCli(): GitLabCli {
  const glab = (args: readonly string[]) =>
    runHostCommand("glab", args, { env });
  return {
    version: async () =>
      (await hostCommandText("glab", ["--version"], { env }))
        ?.split("\n")[0]
        ?.trim(),
    authStatus: async (hostname) => {
      if (hostname !== undefined)
        return (await glab(["auth", "status", "--hostname", hostname])).output;
      const { output } = await glab(["auth", "status", "--all"]);
      return output.includes("unknown flag: --all")
        ? (await glab(["auth", "status"])).output
        : output;
    },
    protocol: (hostname) =>
      hostCommandText(
        "glab",
        ["config", "get", "git_protocol", "--host", hostname],
        { env },
      ),
    repositories: (hostname, page) =>
      hostCommandOutput(
        "glab",
        [
          "api",
          "--hostname",
          hostname,
          `projects?membership=true&order_by=last_activity_at&sort=desc&per_page=${repositoriesPerPage}&page=${page}`,
        ],
        { env },
      ),
    graphql: (hostname, query, variables) =>
      hostCommandOutput(
        "glab",
        [
          "api",
          "graphql",
          "--hostname",
          hostname,
          ...graphqlArguments(query, variables),
        ],
        { env },
      ),
    avatar: (hostname, email) =>
      hostCommandOutput(
        "glab",
        [
          "api",
          "--hostname",
          hostname,
          `avatar?${new URLSearchParams({ email, size: "40" })}`,
        ],
        { env },
      ),
  };
}

export function createGitLabHost(cli: GitLabCli): GitHost {
  return {
    kind: "gitlab",
    tool: signedInTool(cli.version, async () =>
      signedInAccounts(await cli.authStatus()),
    ),
    repositoryId: (remoteUrl) => gitlabProject(remoteUrl)?.id,
    cloneable: async () => {
      const lists = await Promise.all(
        signedInAccounts(await cli.authStatus()).map((account) =>
          accountRepositories(cli, account).catch(() => []),
        ),
      );
      return lists.flat();
    },
    repository: async (remoteUrl) => {
      const project = gitlabProject(remoteUrl);
      if (project === undefined) return undefined;
      const signedIn = signedInAccounts(
        await cli.authStatus(project.host),
      ).some(({ host }) => host.toLowerCase() === project.host);
      if (!signedIn) return undefined;
      return {
        id: project.id,
        pullRequests: (heads) =>
          inAliasedBatches(
            heads,
            { size: branchesPerRequest, perHead: mergeRequestsPerBranch },
            async (aliases) =>
              decodeResponse(
                await cli.graphql(
                  project.host,
                  mergeRequestsQuery(Object.keys(aliases)),
                  { fullPath: project.path, ...aliases },
                ),
              ).data.project,
            (nodes) => mergeRequests(nodes, project),
          ),
        pullRequest: async (number) => {
          try {
            const answer = decodeMergeRequestResponse(
              await cli.graphql(project.host, mergeRequestQuery(number), {
                fullPath: project.path,
              }),
            ).data.project;
            return answer === null ||
              answer.mergeRequest === null ||
              !isProjectLink(answer.mergeRequest.webUrl, project.host)
              ? undefined
              : gitlabMergeRequest(answer.mergeRequest);
          } catch {
            return undefined;
          }
        },
        avatar: async (author) => {
          const { avatar_url } = decodeAvatar(
            await cli.avatar(project.host, author.email),
          );
          return foundAvatar(
            avatarUrl(avatar_url, [project.host, ...gravatarHosts], {
              width: "40",
            }),
          );
        },
      };
    },
  };
}

async function accountRepositories(
  cli: GitLabCli,
  { host, account }: GitHostAccount,
): Promise<readonly HostRepositories[]> {
  const ssh = (await cli.protocol(host)) !== "https";
  const projects = await readRepositoryPages(async (page) =>
    decodeProjectPage(await cli.repositories(host, page)),
  );
  return [
    {
      kind: "gitlab" as const,
      host,
      account,
      repositories: projects.map((project) =>
        cloneableRepository({
          name: project.path_with_namespace,
          url: ssh ? project.ssh_url_to_repo : project.http_url_to_repo,
          private: project.visibility !== "public",
          description: project.description,
          updatedAt: project.last_activity_at,
        }),
      ),
    },
  ];
}

const decodeAvatar = decodeHostJson(
  z.object({ avatar_url: z.string().nullable() }),
);

const decodeProjectPage = decodeHostJson(
  z.array(
    z.object({
      path_with_namespace: z.string(),
      visibility: z.string(),
      description: z.string().nullable(),
      last_activity_at: z.string().nullable(),
      ssh_url_to_repo: z.string(),
      http_url_to_repo: z.string(),
    }),
  ),
);

function signedInAccounts(output: string): readonly GitHostAccount[] {
  return Array.from(
    output.matchAll(/Logged in to (\S+) as (\S+)/g),
    ([, host = "", account = ""]) => ({ host, account }),
  );
}

function gitlabProject(remoteUrl: string): GitLabProject | undefined {
  const remote = remotePath(remoteUrl);
  if (remote === undefined || remote.host === "" || remote.parts.length < 2)
    return undefined;
  const path = remote.parts.join("/");
  return {
    id: `${remote.host}/${path}`.toLowerCase(),
    host: remote.host,
    path,
  };
}

function mergeRequestsQuery(aliases: readonly string[]) {
  return `query($fullPath: ID!${aliases.map((alias) => `, $${alias}: String!`).join("")}) {
  project(fullPath: $fullPath) {
${aliases.map((alias) => `    ${alias}: mergeRequests(sourceBranches: [$${alias}], first: ${mergeRequestsPerBranch}, sort: CREATED_DESC) { nodes { ...mergeRequest } }`).join("\n")}
  }
}
${mergeRequestFragment}`;
}

function mergeRequestQuery(number: number) {
  return `query($fullPath: ID!) {
  project(fullPath: $fullPath) {
    mergeRequest(iid: "${number}") { ...mergeRequest }
  }
}
${mergeRequestFragment}`;
}

const mergeRequestFragment = `fragment mergeRequest on MergeRequest {
  iid webUrl title state draft diffHeadSha
  sourceProject { fullPath }
  headPipeline { status }
}`;

const MergeRequestNode = z.object({
  iid: z.string(),
  webUrl: z.string(),
  title: z.string(),
  state: z.enum(["opened", "closed", "locked", "merged"]),
  draft: z.boolean(),
  diffHeadSha: z.string().nullable().optional(),
  sourceProject: z.object({ fullPath: z.string() }).nullable(),
  headPipeline: z.object({ status: z.string() }).nullable(),
});
type MergeRequestNode = z.infer<typeof MergeRequestNode>;

const MergeRequests = z.object({ nodes: z.array(MergeRequestNode) });

const decodeResponse = decodeHostJson(
  z.object({
    data: z.object({
      project: z.record(z.string(), MergeRequests).nullable(),
    }),
  }),
);

const decodeMergeRequestResponse = decodeHostJson(
  z.object({
    data: z.object({
      project: z
        .object({ mergeRequest: MergeRequestNode.nullable() })
        .nullable(),
    }),
  }),
);

function mergeRequests(
  nodes: readonly MergeRequestNode[],
  project: GitLabProject,
): readonly HostedPullRequest[] {
  return nodes
    .filter(
      (node) =>
        node.sourceProject?.fullPath.toLowerCase() ===
          project.path.toLowerCase() &&
        isProjectLink(node.webUrl, project.host),
    )
    .map(gitlabMergeRequest);
}

function gitlabMergeRequest(node: MergeRequestNode): HostedPullRequest {
  return pullRequest(
    {
      kind: "MergeRequest",
      number: Number(node.iid),
      url: node.webUrl,
      title: node.title,
      state:
        node.state === "merged"
          ? "Merged"
          : node.state === "closed"
            ? "Closed"
            : node.draft
              ? "Draft"
              : "Open",
    },
    pipelineState(node.headPipeline?.status),
    node.diffHeadSha,
  );
}

function isProjectLink(url: string, host: string) {
  const link = URL.parse(url);
  return link?.protocol === "https:" && link.hostname.toLowerCase() === host;
}

function pipelineState(status: string | undefined): PullRequest["checks"] {
  if (status === "SUCCESS") return "Passing";
  if (status === "FAILED") return "Failing";
  if (
    status === "CREATED" ||
    status === "WAITING_FOR_RESOURCE" ||
    status === "PREPARING" ||
    status === "WAITING_FOR_CALLBACK" ||
    status === "PENDING" ||
    status === "RUNNING" ||
    status === "SCHEDULED"
  )
    return "Pending";
  return undefined;
}
