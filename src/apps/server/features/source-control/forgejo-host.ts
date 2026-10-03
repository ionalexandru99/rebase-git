import { execFile } from "node:child_process";
import { Effect, Schema } from "effect";
import type {
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import type {
  GitHost,
  TrackedBranch,
} from "#server/features/source-control/git-host.ts";

export interface TeaCli {
  readonly version: Effect.Effect<string | undefined>;
  readonly logins: Effect.Effect<string>;
  readonly api: (
    login: string,
    endpoint: string,
  ) => Effect.Effect<string, PullRequestsUnavailable>;
}

interface TeaLogin {
  readonly name: string;
  readonly server: string;
  readonly host: string;
  readonly sshHost: string;
  readonly account: string;
}

interface ForgejoRepository {
  readonly host: string;
  readonly owner: string;
  readonly name: string;
}

const unavailable: PullRequestsUnavailable = {
  _tag: "PullRequestsUnavailable",
};
const pageSize = 50;
const pagesRead = 4;
const checksAtOnce = 8;
const accountsShown = 16;

export function createTeaCli(): TeaCli {
  return {
    version: tea(["--version"]).pipe(
      Effect.map((output) => /\d+\.\d+\.\d+/.exec(output)?.[0]),
      Effect.map((version) =>
        version === undefined ? undefined : `tea ${version}`,
      ),
      Effect.orElseSucceed(() => undefined),
    ),
    logins: tea(["logins", "list", "--output", "json"]).pipe(
      Effect.orElseSucceed(() => "[]"),
    ),
    api: (login, endpoint) => tea(["api", "--login", login, endpoint]),
  };
}

function tea(args: readonly string[]) {
  return Effect.callback<string, PullRequestsUnavailable>((resume, signal) => {
    execFile(
      "tea",
      args,
      {
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

export function createForgejoHost(cli: TeaCli): GitHost {
  return {
    kind: "forgejo",
    serves: (remoteUrl) => {
      const repository = forgejoRepository(remoteUrl);
      if (repository === undefined) return Effect.succeed(false);
      return readLogins(cli).pipe(
        Effect.map((logins) => loginFor(logins, repository.host) !== undefined),
      );
    },
    tool: Effect.gen(function* () {
      const version = yield* cli.version;
      if (version === undefined) return { _tag: "Missing" } as const;
      const accounts = (yield* readLogins(cli))
        .map(({ server, account }) => ({ host: server, account }))
        .slice(0, accountsShown);
      return accounts.length === 0
        ? ({ _tag: "SignedOut", version } as const)
        : ({ _tag: "SignedIn", version, accounts } as const);
    }),
    pullRequests: (remoteUrl, branches) =>
      listPullRequests(cli, remoteUrl, branches),
  };
}

const TeaLogins = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      url: Schema.String,
      ssh_host: Schema.optionalKey(Schema.String),
      user: Schema.optionalKey(Schema.String),
    }),
  ),
);

function readLogins(cli: TeaCli): Effect.Effect<readonly TeaLogin[]> {
  return cli.logins.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(TeaLogins)),
    Effect.map((logins) =>
      logins.flatMap(({ name, url, ssh_host, user }) => {
        const server = URL.parse(url);
        return server === null || server.hostname === ""
          ? []
          : [
              {
                name,
                server: server.host,
                host: server.hostname.toLowerCase(),
                sshHost: (ssh_host ?? "").split(":")[0]?.toLowerCase() ?? "",
                account: user || name,
              },
            ];
      }),
    ),
    Effect.orElseSucceed(() => []),
  );
}

function loginFor(logins: readonly TeaLogin[], host: string) {
  return logins.find((login) => login.host === host || login.sshHost === host);
}

function forgejoRepository(remoteUrl: string): ForgejoRepository | undefined {
  const location = remoteLocation(remoteUrl);
  const parts = location?.path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .split("/");
  const name = parts?.at(-1);
  const owner = parts?.at(-2);
  return location === undefined || location.host === "" || !owner || !name
    ? undefined
    : { host: location.host, owner, name };
}

function fullName({ owner, name }: ForgejoRepository) {
  return `${owner}/${name}`.toLowerCase();
}

function listPullRequests(
  cli: TeaCli,
  remoteUrl: string,
  branches: readonly TrackedBranch[],
) {
  return Effect.gen(function* () {
    const repository = forgejoRepository(remoteUrl);
    if (repository === undefined) return [];
    const tracked = branches.filter(({ remoteUrl }) => {
      const candidate = forgejoRepository(remoteUrl);
      return (
        candidate?.host === repository.host &&
        fullName(candidate) === fullName(repository)
      );
    });
    const login = loginFor(yield* readLogins(cli), repository.host);
    if (login === undefined || tracked.length === 0) return [];
    const heads = new Set(tracked.map(({ head }) => head));
    const nodes = (yield* readPullRequests(cli, login.name, repository)).filter(
      (node) =>
        heads.has(node.head.ref) &&
        node.head.repo?.full_name.toLowerCase() === fullName(repository) &&
        isServerLink(node.html_url, login.host),
    );
    const found = yield* Effect.forEach(
      nodes,
      (node) =>
        checksOf(cli, login.name, repository, node).pipe(
          Effect.map((checks) => ({
            head: node.head.ref,
            pullRequest: pullRequest(node, checks),
          })),
        ),
      { concurrency: checksAtOnce },
    );
    return tracked.map(({ branch, head }) => ({
      branch,
      pullRequests: found
        .filter((candidate) => candidate.head === head)
        .map(({ pullRequest }) => pullRequest),
    }));
  });
}

function readPullRequests(
  cli: TeaCli,
  login: string,
  repository: ForgejoRepository,
  page = 1,
): Effect.Effect<readonly PullRequestNode[], PullRequestsUnavailable> {
  return cli
    .api(
      login,
      `${repositoryEndpoint(repository)}/pulls?${new URLSearchParams({
        state: "all",
        sort: "recentupdate",
        limit: String(pageSize),
        page: String(page),
      })}`,
    )
    .pipe(
      Effect.flatMap(decodePullRequests),
      Effect.mapError(() => unavailable),
      Effect.flatMap((nodes) =>
        nodes.length < pageSize || page === pagesRead
          ? Effect.succeed(nodes)
          : readPullRequests(cli, login, repository, page + 1).pipe(
              Effect.map((rest) => [...nodes, ...rest]),
            ),
      ),
    );
}

function checksOf(
  cli: TeaCli,
  login: string,
  repository: ForgejoRepository,
  node: PullRequestNode,
): Effect.Effect<PullRequest["checks"]> {
  if (node.state !== "open") return Effect.succeed(undefined);
  return cli
    .api(
      login,
      `${repositoryEndpoint(repository)}/commits/${encodeURIComponent(node.head.sha)}/status`,
    )
    .pipe(
      Effect.flatMap(decodeStatus),
      Effect.map(checksState),
      Effect.orElseSucceed(() => undefined),
    );
}

function repositoryEndpoint({ owner, name }: ForgejoRepository) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function isServerLink(url: string, host: string) {
  const link = URL.parse(url);
  return link?.protocol === "https:" && link.hostname.toLowerCase() === host;
}

const PullRequestNode = Schema.Struct({
  number: Schema.Int,
  html_url: Schema.String,
  title: Schema.String,
  state: Schema.String,
  merged: Schema.Boolean,
  draft: Schema.optionalKey(Schema.Boolean),
  head: Schema.Struct({
    ref: Schema.String,
    sha: Schema.String,
    repo: Schema.NullOr(Schema.Struct({ full_name: Schema.String })),
  }),
});
type PullRequestNode = typeof PullRequestNode.Type;

const decodePullRequests = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(PullRequestNode)),
);

const decodeStatus = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ state: Schema.String, total_count: Schema.Int }),
  ),
);

function pullRequest(
  node: PullRequestNode,
  checks: PullRequest["checks"],
): PullRequest {
  return {
    kind: "PullRequest",
    number: node.number,
    url: node.html_url,
    title: node.title,
    state: node.merged
      ? "Merged"
      : node.state !== "open"
        ? "Closed"
        : node.draft === true
          ? "Draft"
          : "Open",
    ...(checks === undefined ? {} : { checks }),
  };
}

function checksState({
  state,
  total_count,
}: {
  readonly state: string;
  readonly total_count: number;
}): PullRequest["checks"] {
  if (total_count === 0) return undefined;
  if (state === "success") return "Passing";
  if (state === "failure" || state === "error") return "Failing";
  if (state === "pending") return "Pending";
  return undefined;
}
