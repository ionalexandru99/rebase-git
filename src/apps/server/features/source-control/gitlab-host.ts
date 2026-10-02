import { execFile } from "node:child_process";
import { Effect, Schema } from "effect";
import type {
  BranchPullRequests,
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  chunks,
  type GitHost,
  type GitHostAccount,
  type TrackedBranch,
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

const unavailable: PullRequestsUnavailable = {
  _tag: "PullRequestsUnavailable",
};
const branchesPerRequest = 12;
const mergeRequestsPerBranch = 10;
const accountsShown = 16;

export function createGitLabCli(): GitLabCli {
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
      glab([
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
      ]).pipe(
        Effect.flatMap(({ succeeded, stdout }) =>
          succeeded ? Effect.succeed(stdout) : Effect.fail(unavailable),
        ),
      ),
  };
}

function glab(args: readonly string[]) {
  return Effect.callback<{
    readonly succeeded: boolean;
    readonly stdout: string;
    readonly output: string;
  }>((resume, signal) => {
    execFile(
      "glab",
      args,
      {
        env: { ...process.env, GLAB_CHECK_UPDATE: "false", NO_PROMPT: "true" },
        maxBuffer: 16 * 1_048_576,
        signal,
        timeout: 30_000,
        windowsHide: true,
      },
      (error, stdout, stderr) =>
        resume(
          Effect.succeed({
            succeeded: error === null,
            stdout,
            output: `${stdout}\n${stderr}`,
          }),
        ),
    );
  });
}

export function createGitLabHost(cli: GitLabCli): GitHost {
  return {
    kind: "gitlab",
    serves: (remoteUrl) => {
      const project = gitlabProject(remoteUrl);
      if (project === undefined) return Effect.succeed(false);
      return cli
        .authStatus(project.host)
        .pipe(
          Effect.map((output) =>
            signedInAccounts(output).some(
              ({ host }) => host.toLowerCase() === project.host,
            ),
          ),
        );
    },
    tool: Effect.gen(function* () {
      const version = yield* cli.version;
      if (version === undefined) return { _tag: "Missing" } as const;
      const accounts = signedInAccounts(yield* cli.authStatus());
      return accounts.length === 0
        ? ({ _tag: "SignedOut", version } as const)
        : ({ _tag: "SignedIn", version, accounts } as const);
    }),
    pullRequests: (remoteUrl, branches) =>
      listMergeRequests(cli, remoteUrl, branches),
  };
}

function signedInAccounts(output: string): readonly GitHostAccount[] {
  return Array.from(
    output.matchAll(/Logged in to (\S+) as (\S+)/g),
    ([, host = "", account = ""]) => ({ host, account }),
  ).slice(0, accountsShown);
}

function listMergeRequests(
  cli: GitLabCli,
  remoteUrl: string,
  branches: readonly TrackedBranch[],
) {
  const project = gitlabProject(remoteUrl);
  if (project === undefined) return Effect.succeed([]);
  const tracked = branches.filter(({ remoteUrl }) => {
    const candidate = gitlabProject(remoteUrl);
    return (
      candidate?.host === project.host &&
      candidate.path.toLowerCase() === project.path.toLowerCase()
    );
  });
  return Effect.forEach(
    chunks(tracked, branchesPerRequest),
    (chunk) =>
      cli
        .graphql(project.host, mergeRequestsQuery(chunk.length), {
          fullPath: project.path,
          ...Object.fromEntries(
            chunk.map(({ head }, index) => [`b${index}`, head]),
          ),
        })
        .pipe(
          Effect.flatMap(decodeResponse),
          Effect.map(({ data }) =>
            chunk.map((branch, index) =>
              branchMergeRequests(
                branch,
                data.project?.[`b${index}`]?.nodes ?? [],
                project,
              ),
            ),
          ),
        ),
    { concurrency: 4 },
  ).pipe(Effect.map((answers) => answers.flat()));
}

function gitlabProject(remoteUrl: string) {
  const location = remoteLocation(remoteUrl);
  const path = location?.path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return location === undefined ||
    location.host === "" ||
    path === undefined ||
    !path.includes("/")
    ? undefined
    : { host: location.host, path };
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

function branchMergeRequests(
  { branch }: TrackedBranch,
  nodes: readonly MergeRequestNode[],
  project: { readonly host: string; readonly path: string },
): BranchPullRequests {
  return {
    branch,
    pullRequests: nodes
      .filter(
        (node) =>
          node.sourceProject?.fullPath.toLowerCase() ===
            project.path.toLowerCase() &&
          isProjectLink(node.webUrl, project.host),
      )
      .map(mergeRequest),
  };
}

function isProjectLink(url: string, host: string) {
  const link = URL.parse(url);
  return link?.protocol === "https:" && link.hostname.toLowerCase() === host;
}

function mergeRequest(node: MergeRequestNode): PullRequest {
  const checks = pipelineState(node.headPipeline?.status);
  return {
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
    ...(checks === undefined ? {} : { checks }),
  };
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
