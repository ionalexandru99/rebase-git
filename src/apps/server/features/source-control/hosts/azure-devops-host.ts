import { z } from "zod";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  type AvatarAuthor,
  avatarUrl,
  eachHead,
  foundAvatar,
  type GitHost,
  type HostedPullRequest,
  type HostJsonReader,
  pageAnswer,
  pullRequest,
  sameEmail,
  signedInTool,
  singleAccount,
} from "#server/features/source-control/git-host.ts";
import {
  type AzureDevOpsClient,
  reader,
} from "#server/features/source-control/hosts/azure-devops-client.ts";
import { cloneableRepositories } from "#server/features/source-control/hosts/azure-devops-repositories.ts";

interface AzureRepository {
  readonly id: string;
  readonly organization: string;
  readonly project: string;
  readonly name: string;
}

const pullRequestsPerBranch = 10;
const branchesAtOnce = 8;
const checkPolicyTypes = new Set([
  "0609b952-1397-4640-95ec-e00a01b2c241",
  "cbdc66da-9728-4af8-aada-9a5a32e4a226",
]);

export function createAzureDevOpsHost(client: AzureDevOpsClient): GitHost {
  return {
    kind: "azure-devops",
    tool: signedInTool(
      client.version,
      singleAccount("dev.azure.com", client.account),
    ),
    repositoryId: (remoteUrl) => azureRepository(remoteUrl)?.id,
    cloneable: () => cloneableRepositories(client),
    repository: async (remoteUrl) => {
      const repository = azureRepository(remoteUrl);
      return (
        repository && {
          id: repository.id,
          pullRequests: (heads) => listPullRequests(client, repository, heads),
          pullRequest: async (number) => {
            try {
              const read = reader(client, await client.accessToken());
              const node = await read(
                pullRequestUrl(repository, number),
                PullRequestNode,
              );
              if (
                node.repository.name.toLowerCase() !==
                repository.name.toLowerCase()
              )
                return undefined;
              return azurePullRequest(
                repository,
                node,
                await checksOf(read, repository, node),
              );
            } catch {
              return undefined;
            }
          },
          avatar: (author) => readAvatar(client, repository, author),
        }
      );
    },
  };
}

async function listPullRequests(
  client: AzureDevOpsClient,
  repository: AzureRepository,
  heads: readonly string[],
) {
  const read = reader(client, await client.accessToken());
  return eachHead(heads, branchesAtOnce, async (head) => {
    const { value } = await read(
      pullRequestsUrl(repository, head),
      PullRequestList,
    );
    const found = await Promise.all(
      value
        .filter((node) => node.forkSource === undefined)
        .map(async (node) =>
          azurePullRequest(
            repository,
            node,
            await checksOf(read, repository, node),
          ),
        ),
    );
    return pageAnswer(value.length, pullRequestsPerBranch, found);
  });
}

async function readAvatar(
  client: AzureDevOpsClient,
  repository: AzureRepository,
  author: AvatarAuthor,
) {
  const accessToken = await client.accessToken();
  const { value } = await reader(client, accessToken)(
    commitsUrl(repository, author.commit),
    Commits,
  );
  const commit = value[0];
  const url =
    commit?.commitId === author.commit && sameEmail(commit.author.email, author)
      ? avatarUrl(commit.author.imageUrl, ["dev.azure.com", "visualstudio.com"])
      : undefined;
  return foundAvatar(url, `Bearer ${accessToken}`);
}

async function checksOf(
  read: HostJsonReader,
  repository: AzureRepository,
  node: PullRequestNode,
) {
  if (node.status !== "active") return undefined;
  try {
    const { value } = await read(evaluationsUrl(repository, node), Evaluations);
    return checksState(value);
  } catch {
    return undefined;
  }
}

function azureRepository(remoteUrl: string): AzureRepository | undefined {
  const location = remoteLocation(remoteUrl);
  const parts = location === undefined ? undefined : pathParts(location.path);
  if (location === undefined || parts === undefined) return undefined;
  if (
    location.host === "ssh.dev.azure.com" ||
    location.host === "vs-ssh.visualstudio.com"
  ) {
    const [version, organization, project, name, ...rest] = parts;
    return version === "v3" && rest.length === 0
      ? repositoryOf(organization, project, name)
      : undefined;
  }
  if (location.host === "dev.azure.com")
    return gitRepository(parts[0], parts.slice(1));
  const organization = /^([\w-]+)\.visualstudio\.com$/.exec(location.host)?.[1];
  return organization === undefined
    ? undefined
    : gitRepository(
        organization,
        parts[0]?.toLowerCase() === "defaultcollection"
          ? parts.slice(1)
          : parts,
      );
}

function pathParts(path: string) {
  try {
    return path
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .map((part) => decodeURIComponent(part));
  } catch {
    return undefined;
  }
}

function gitRepository(
  organization: string | undefined,
  parts: readonly string[],
) {
  const [first, second, third, ...rest] = parts;
  if (first === "_git" && third === undefined)
    return repositoryOf(organization, second, second);
  if (second === "_git" && rest.length === 0)
    return repositoryOf(organization, first, third);
  return undefined;
}

function repositoryOf(
  organization: string | undefined,
  project: string | undefined,
  name: string | undefined,
): AzureRepository | undefined {
  return organization && project && name
    ? {
        id: `${organization}/${project}/${name}`.toLowerCase(),
        organization,
        project,
        name,
      }
    : undefined;
}

function projectUrl({ organization, project }: AzureRepository) {
  return `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}`;
}

function pullRequestsUrl(repository: AzureRepository, head: string) {
  return `${projectUrl(repository)}/_apis/git/repositories/${encodeURIComponent(repository.name)}/pullrequests?${new URLSearchParams(
    {
      "searchCriteria.sourceRefName": `refs/heads/${head}`,
      "searchCriteria.status": "all",
      $top: String(pullRequestsPerBranch),
      "api-version": "7.1",
    },
  )}`;
}

function pullRequestUrl(repository: AzureRepository, number: number) {
  return `${projectUrl(repository)}/_apis/git/repositories/${encodeURIComponent(repository.name)}/pullrequests/${number}?${new URLSearchParams(
    { "api-version": "7.1" },
  )}`;
}

function commitsUrl(repository: AzureRepository, commit: string) {
  return `${projectUrl(repository)}/_apis/git/repositories/${encodeURIComponent(repository.name)}/commits?${new URLSearchParams(
    {
      "searchCriteria.itemVersion.version": commit,
      "searchCriteria.itemVersion.versionType": "commit",
      "searchCriteria.$top": "1",
      "searchCriteria.includeUserImageUrl": "true",
      "api-version": "7.1",
    },
  )}`;
}

function evaluationsUrl(repository: AzureRepository, node: PullRequestNode) {
  return `${projectUrl(repository)}/_apis/policy/evaluations?${new URLSearchParams(
    {
      artifactId: `vstfs:///CodeReview/CodeReviewId/${node.repository.project.id}/${node.pullRequestId}`,
      "api-version": "7.1-preview.1",
    },
  )}`;
}

const PullRequestNode = z.object({
  pullRequestId: z.number().int(),
  title: z.string(),
  status: z.string(),
  isDraft: z.boolean().optional(),
  forkSource: z.unknown().optional(),
  lastMergeSourceCommit: z
    .object({ commitId: z.string() })
    .nullable()
    .optional(),
  repository: z.object({
    name: z.string(),
    project: z.object({ id: z.string() }),
  }),
});
type PullRequestNode = z.infer<typeof PullRequestNode>;

const PullRequestList = z.object({ value: z.array(PullRequestNode) });

const Commits = z.object({
  value: z.array(
    z.object({
      commitId: z.string(),
      author: z.object({
        email: z.string().optional(),
        imageUrl: z.string().optional(),
      }),
    }),
  ),
});

const Evaluation = z.object({
  status: z.string(),
  configuration: z.object({ type: z.object({ id: z.string() }) }),
});

const Evaluations = z.object({ value: z.array(Evaluation) });

function azurePullRequest(
  repository: AzureRepository,
  node: PullRequestNode,
  checks: PullRequest["checks"],
): HostedPullRequest {
  return pullRequest(
    {
      kind: "PullRequest",
      number: node.pullRequestId,
      url: `${projectUrl(repository)}/_git/${encodeURIComponent(repository.name)}/pullrequest/${node.pullRequestId}`,
      title: node.title,
      state:
        node.status === "active"
          ? node.isDraft === true
            ? "Draft"
            : "Open"
          : node.status === "completed"
            ? "Merged"
            : "Closed",
    },
    checks,
    node.lastMergeSourceCommit?.commitId,
  );
}

function checksState(
  evaluations: readonly z.infer<typeof Evaluation>[],
): PullRequest["checks"] {
  const statuses = evaluations
    .filter(({ configuration }) => checkPolicyTypes.has(configuration.type.id))
    .map(({ status }) => status);
  if (statuses.some((status) => status === "rejected" || status === "broken"))
    return "Failing";
  if (statuses.some((status) => status === "queued" || status === "running"))
    return "Pending";
  if (statuses.includes("approved")) return "Passing";
  return undefined;
}
