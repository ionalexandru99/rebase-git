import { execFile } from "node:child_process";
import { Effect, Schema } from "effect";
import type {
  BranchPullRequests,
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  type GitHost,
  hostTool,
  type TrackedBranch,
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
  readonly organization: string;
  readonly project: string;
  readonly name: string;
}

const unavailable: PullRequestsUnavailable = {
  _tag: "PullRequestsUnavailable",
};
const azureDevOpsResource = "499b84ac-1321-427f-aa17-267ca6975798";
const pullRequestsPerBranch = 10;
const branchesAtOnce = 8;
const checkPolicyTypes = new Set([
  "0609b952-1397-4640-95ec-e00a01b2c241",
  "cbdc66da-9728-4af8-aada-9a5a32e4a226",
]);

export function createAzureDevOpsClient(): AzureDevOpsClient {
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
      Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(url, {
            headers: {
              accept: "application/json",
              authorization: `Bearer ${accessToken}`,
            },
            redirect: "error",
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        },
        catch: () => unavailable,
      }),
  };
}

function az(args: readonly string[]) {
  const [command, prefix] =
    process.platform === "win32"
      ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "az"]]
      : ["az", []];
  return Effect.callback<string, PullRequestsUnavailable>((resume, signal) => {
    execFile(
      command,
      [...prefix, ...args],
      { signal, timeout: 30_000, windowsHide: true },
      (error, stdout) =>
        resume(
          error === null ? Effect.succeed(stdout) : Effect.fail(unavailable),
        ),
    );
  });
}

export function createAzureDevOpsHost(client: AzureDevOpsClient): GitHost {
  return {
    kind: "azure-devops",
    serves: (remoteUrl) => azureRepository(remoteUrl) !== undefined,
    tool: hostTool(client.version, client.account),
    pullRequests: (remoteUrl, branches) =>
      listPullRequests(client, remoteUrl, branches),
  };
}

function listPullRequests(
  client: AzureDevOpsClient,
  remoteUrl: string,
  branches: readonly TrackedBranch[],
) {
  const repository = azureRepository(remoteUrl);
  const tracked = branches.filter(({ remoteUrl }) =>
    sameRepository(azureRepository(remoteUrl), repository),
  );
  if (repository === undefined || tracked.length === 0)
    return Effect.succeed([]);
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
    return yield* Effect.forEach(
      tracked,
      (branch) =>
        read(pullRequestsUrl(repository, branch), decodePullRequestList).pipe(
          Effect.flatMap(({ value }) =>
            Effect.forEach(
              value.filter((node) => node.forkSource === undefined),
              (node) =>
                checks(node).pipe(
                  Effect.map((state) => pullRequest(repository, node, state)),
                ),
              { concurrency: "unbounded" },
            ),
          ),
          Effect.map(
            (pullRequests): BranchPullRequests => ({
              branch: branch.branch,
              pullRequests,
            }),
          ),
        ),
      { concurrency: branchesAtOnce },
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
    ? { organization, project, name }
    : undefined;
}

function sameRepository(
  candidate: AzureRepository | undefined,
  repository: AzureRepository | undefined,
) {
  return (
    candidate !== undefined &&
    repository !== undefined &&
    candidate.organization.toLowerCase() ===
      repository.organization.toLowerCase() &&
    candidate.project.toLowerCase() === repository.project.toLowerCase() &&
    candidate.name.toLowerCase() === repository.name.toLowerCase()
  );
}

function projectUrl({ organization, project }: AzureRepository) {
  return `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}`;
}

function pullRequestsUrl(repository: AzureRepository, { head }: TrackedBranch) {
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

function pullRequest(
  repository: AzureRepository,
  node: PullRequestNode,
  checks: PullRequest["checks"],
): PullRequest {
  return {
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
    ...(checks === undefined ? {} : { checks }),
  };
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
