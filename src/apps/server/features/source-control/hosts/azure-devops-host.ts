import { Effect, Schema } from "effect";
import type {
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  eachHead,
  type GitHost,
  type HostedPullRequest,
  hostCommandOutput,
  hostGet,
  pullRequest,
  signedInTool,
  singleAccount,
  unavailable,
} from "#server/features/source-control/git-host.ts";

export interface AzureDevOpsClient {
  readonly version: Effect.Effect<string | undefined>;
  readonly account: Effect.Effect<string | undefined>;
  readonly accessToken: Effect.Effect<string, PullRequestsUnavailable>;
  readonly get: (
    url: string,
    accessToken: string,
  ) => Effect.Effect<string, PullRequestsUnavailable>;
}

interface AzureRepository {
  readonly id: string;
  readonly organization: string;
  readonly project: string;
  readonly name: string;
}

const azureDevOpsResource = "499b84ac-1321-427f-aa17-267ca6975798";
const pullRequestsPerBranch = 10;
const branchesAtOnce = 8;
const checkPolicyTypes = new Set([
  "0609b952-1397-4640-95ec-e00a01b2c241",
  "cbdc66da-9728-4af8-aada-9a5a32e4a226",
]);

export function createAzureDevOpsClient(): AzureDevOpsClient {
  const az = (args: readonly string[]) =>
    hostCommandOutput("az", args, { shim: true });
  return {
    version: az(["version", "--output", "json"]).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Struct({ "azure-cli": Schema.String })),
        ),
      ),
      Effect.map((version) => `azure-cli ${version["azure-cli"]}`),
      Effect.orElseSucceed(() => undefined),
    ),
    account: az([
      "account",
      "show",
      "--query",
      "user.name",
      "--output",
      "tsv",
    ]).pipe(
      Effect.map((output) => output.trim() || undefined),
      Effect.orElseSucceed(() => undefined),
    ),
    accessToken: az([
      "account",
      "get-access-token",
      "--resource",
      azureDevOpsResource,
      "--query",
      "accessToken",
      "--output",
      "tsv",
    ]).pipe(
      Effect.map((output) => output.trim()),
      Effect.filterOrFail(
        (token) => token !== "",
        () => unavailable,
      ),
    ),
    get: (url, accessToken) =>
      hostGet(url, { authorization: `Bearer ${accessToken}` }).pipe(
        Effect.flatMap(({ status, body }) =>
          status >= 200 && status < 300
            ? Effect.succeed(body)
            : Effect.fail(unavailable),
        ),
      ),
  };
}

export function createAzureDevOpsHost(client: AzureDevOpsClient): GitHost {
  return {
    kind: "azure-devops",
    tool: signedInTool(
      client.version,
      singleAccount("dev.azure.com", client.account),
    ),
    repositoryId: (remoteUrl) => azureRepository(remoteUrl)?.id,
    repository: (remoteUrl) => {
      const repository = azureRepository(remoteUrl);
      return Effect.succeed(
        repository && {
          id: repository.id,
          pullRequests: (heads) => listPullRequests(client, repository, heads),
        },
      );
    },
  };
}

function listPullRequests(
  client: AzureDevOpsClient,
  repository: AzureRepository,
  heads: readonly string[],
) {
  return Effect.gen(function* () {
    const accessToken = yield* client.accessToken;
    const read = <A>(
      url: string,
      decode: (output: string) => Effect.Effect<A, unknown>,
    ) =>
      client.get(url, accessToken).pipe(
        Effect.flatMap(decode),
        Effect.mapError(() => unavailable),
      );
    const checks = (node: PullRequestNode) =>
      node.status === "active"
        ? read(evaluationsUrl(repository, node), decodeEvaluations).pipe(
            Effect.map(({ value }) => checksState(value)),
            Effect.orElseSucceed(() => undefined),
          )
        : Effect.succeed(undefined);
    return yield* eachHead(heads, branchesAtOnce, (head) =>
      read(pullRequestsUrl(repository, head), decodePullRequestList).pipe(
        Effect.flatMap(({ value }) =>
          Effect.forEach(
            value.filter((node) => node.forkSource === undefined),
            (node) =>
              checks(node).pipe(
                Effect.map((state) =>
                  azurePullRequest(repository, node, state),
                ),
              ),
            { concurrency: "unbounded" },
          ),
        ),
      ),
    );
  });
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

function evaluationsUrl(repository: AzureRepository, node: PullRequestNode) {
  return `${projectUrl(repository)}/_apis/policy/evaluations?${new URLSearchParams(
    {
      artifactId: `vstfs:///CodeReview/CodeReviewId/${node.repository.project.id}/${node.pullRequestId}`,
      "api-version": "7.1-preview.1",
    },
  )}`;
}

const PullRequestNode = Schema.Struct({
  pullRequestId: Schema.Int,
  title: Schema.String,
  status: Schema.String,
  isDraft: Schema.optionalKey(Schema.Boolean),
  forkSource: Schema.optionalKey(Schema.Unknown),
  lastMergeSourceCommit: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ commitId: Schema.String })),
  ),
  repository: Schema.Struct({
    project: Schema.Struct({ id: Schema.String }),
  }),
});
type PullRequestNode = typeof PullRequestNode.Type;

const decodePullRequestList = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ value: Schema.Array(PullRequestNode) }),
  ),
);

const Evaluation = Schema.Struct({
  status: Schema.String,
  configuration: Schema.Struct({
    type: Schema.Struct({ id: Schema.String }),
  }),
});

const decodeEvaluations = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ value: Schema.Array(Evaluation) })),
);

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
  evaluations: readonly (typeof Evaluation.Type)[],
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
