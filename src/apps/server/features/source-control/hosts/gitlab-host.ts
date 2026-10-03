import { Effect, Schema } from "effect";
import type {
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  type GitHost,
  type GitHostAccount,
  hostCommandOutput,
  inBatches,
  pullRequest,
  runHostCommand,
  signedInTool,
  unavailable,
} from "#server/features/source-control/git-host.ts";

export interface GitLabCli {
  readonly version: Effect.Effect<string | undefined>;
  readonly authStatus: (hostname?: string) => Effect.Effect<string>;
  readonly graphql: (
    hostname: string,
    query: string,
    variables: Readonly<Record<string, string>>,
  ) => Effect.Effect<string, PullRequestsUnavailable>;
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
    version: glab(["--version"]).pipe(
      Effect.map(({ succeeded, stdout }) =>
        succeeded ? stdout.split("\n")[0]?.trim() || undefined : undefined,
      ),
    ),
    authStatus: (hostname) =>
      hostname === undefined
        ? glab(["auth", "status", "--all"]).pipe(
            Effect.flatMap(({ output }) =>
              output.includes("unknown flag: --all")
                ? glab(["auth", "status"])
                : Effect.succeed({ output }),
            ),
            Effect.map(({ output }) => output),
          )
        : glab(["auth", "status", "--hostname", hostname]).pipe(
            Effect.map(({ output }) => output),
          ),
    graphql: (hostname, query, variables) =>
      hostCommandOutput(
        "glab",
        [
          "api",
          "graphql",
          "--hostname",
          hostname,
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

export function createGitLabHost(cli: GitLabCli): GitHost {
  return {
    kind: "gitlab",
    tool: signedInTool(
      cli.version,
      cli.authStatus().pipe(Effect.map(signedInAccounts)),
    ),
    repositoryId: (remoteUrl) => gitlabProject(remoteUrl)?.id,
    repository: (remoteUrl) => {
      const project = gitlabProject(remoteUrl);
      if (project === undefined) return Effect.succeed(undefined);
      return cli.authStatus(project.host).pipe(
        Effect.map((output) =>
          signedInAccounts(output).some(
            ({ host }) => host.toLowerCase() === project.host,
          )
            ? {
                id: project.id,
                pullRequests: (heads: readonly string[]) =>
                  inBatches(heads, branchesPerRequest, (batch) =>
                    cli
                      .graphql(project.host, mergeRequestsQuery(batch.length), {
                        fullPath: project.path,
                        ...Object.fromEntries(
                          batch.map((head, index) => [`b${index}`, head]),
                        ),
                      })
                      .pipe(
                        Effect.flatMap(decodeResponse),
                        Effect.map(({ data }) =>
                          batch.map((_, index) =>
                            mergeRequests(
                              data.project?.[`b${index}`]?.nodes ?? [],
                              project,
                            ),
                          ),
                        ),
                      ),
                  ),
              }
            : undefined,
        ),
      );
    },
  };
}

function signedInAccounts(output: string): readonly GitHostAccount[] {
  return Array.from(
    output.matchAll(/Logged in to (\S+) as (\S+)/g),
    ([, host = "", account = ""]) => ({ host, account }),
  );
}

function gitlabProject(remoteUrl: string): GitLabProject | undefined {
  const location = remoteLocation(remoteUrl);
  const path = location?.path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return location === undefined ||
    location.host === "" ||
    path === undefined ||
    !path.includes("/")
    ? undefined
    : {
        id: `${location.host}/${path}`.toLowerCase(),
        host: location.host,
        path,
      };
}

function mergeRequestsQuery(branches: number) {
  const indexes = Array.from({ length: branches }, (_, index) => index);
  return `query($fullPath: ID!${indexes.map((index) => `, $b${index}: String!`).join("")}) {
  project(fullPath: $fullPath) {
${indexes.map((index) => `    b${index}: mergeRequests(sourceBranches: [$b${index}], first: ${mergeRequestsPerBranch}, sort: CREATED_DESC) { nodes { ...mergeRequest } }`).join("\n")}
  }
}
fragment mergeRequest on MergeRequest {
  iid webUrl title state draft
  sourceProject { fullPath }
  headPipeline { status }
}`;
}

const MergeRequestNode = Schema.Struct({
  iid: Schema.String,
  webUrl: Schema.String,
  title: Schema.String,
  state: Schema.Literals(["opened", "closed", "locked", "merged"]),
  draft: Schema.Boolean,
  sourceProject: Schema.NullOr(Schema.Struct({ fullPath: Schema.String })),
  headPipeline: Schema.NullOr(Schema.Struct({ status: Schema.String })),
});
type MergeRequestNode = typeof MergeRequestNode.Type;

const MergeRequests = Schema.Struct({
  nodes: Schema.Array(MergeRequestNode),
});

const decodeResponse = (output: string) =>
  Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({
        data: Schema.Struct({
          project: Schema.NullOr(Schema.Record(Schema.String, MergeRequests)),
        }),
      }),
    ),
  )(output).pipe(Effect.mapError(() => unavailable));

function mergeRequests(
  nodes: readonly MergeRequestNode[],
  project: GitLabProject,
): readonly PullRequest[] {
  return nodes
    .filter(
      (node) =>
        node.sourceProject?.fullPath.toLowerCase() ===
          project.path.toLowerCase() &&
        isProjectLink(node.webUrl, project.host),
    )
    .map((node) =>
      pullRequest(
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
      ),
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
