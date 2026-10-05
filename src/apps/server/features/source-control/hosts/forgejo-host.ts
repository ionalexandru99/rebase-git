import { Effect, Schema } from "effect";
import type {
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  type GitHost,
  type HostedPullRequest,
  hostCommandOutput,
  pullRequest,
  signedInTool,
  unavailable,
} from "#server/features/source-control/git-host.ts";
import { forgejoCloneable } from "#server/features/source-control/hosts/forgejo-repositories.ts";

export interface TeaCli {
  readonly version: Effect.Effect<string | undefined>;
  readonly logins: Effect.Effect<string>;
  readonly login: (
    name: string,
  ) => Effect.Effect<string, PullRequestsUnavailable>;
  readonly api: (
    login: string,
    endpoint: string,
  ) => Effect.Effect<string, PullRequestsUnavailable>;
}

export interface TeaLogin {
  readonly name: string;
  readonly server: string;
  readonly host: string;
  readonly sshHost: string;
  readonly account: string;
}

interface ForgejoRepository {
  readonly id: string;
  readonly host: string;
  readonly server: string | undefined;
  readonly owner: string;
  readonly name: string;
}

const pageSize = 50;
const pagesRead = 4;
const checksAtOnce = 8;

export function createTeaCli(): TeaCli {
  const tea = (args: readonly string[]) => hostCommandOutput("tea", args);
  return {
    version: tea(["--version"]).pipe(
      Effect.map((output) => /(\d+)\.(\d+)\.\d+/.exec(output)),
      Effect.map((version) =>
        version === null ||
        (Number(version[1]) === 0 && Number(version[2]) < 12)
          ? undefined
          : `tea ${version[0]}`,
      ),
      Effect.orElseSucceed(() => undefined),
    ),
    logins: tea(["logins", "list", "--output", "json"]).pipe(
      Effect.orElseSucceed(() => "[]"),
    ),
    login: (name) => tea(["logins", name]),
    api: (login, endpoint) => tea(["api", "--login", login, endpoint]),
  };
}

export function createForgejoHost(cli: TeaCli): GitHost {
  return {
    kind: "forgejo",
    tool: signedInTool(
      cli.version,
      readLogins(cli).pipe(
        Effect.map((logins) =>
          logins.map(({ server, account }) => ({ host: server, account })),
        ),
      ),
    ),
    repositoryId: (remoteUrl) => forgejoRepository(remoteUrl)?.id,
    cloneable: readLogins(cli).pipe(
      Effect.flatMap((logins) => forgejoCloneable(cli, logins)),
    ),
    repository: (remoteUrl) => {
      const repository = forgejoRepository(remoteUrl);
      if (repository === undefined) return Effect.succeed(undefined);
      return readLogins(cli).pipe(
        Effect.map((logins) => {
          const login = loginFor(logins, repository);
          return (
            login && {
              id: repository.id,
              pullRequests: (heads: readonly string[]) =>
                listPullRequests(cli, login, repository, heads),
              pullRequest: (number: number) =>
                readPullRequest(cli, login, repository, number),
            }
          );
        }),
      );
    },
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

function loginFor(
  logins: readonly TeaLogin[],
  { host, server }: ForgejoRepository,
) {
  return logins.find((login) =>
    server === undefined
      ? login.host === host || login.sshHost === host
      : login.server === server,
  );
}

function forgejoRepository(remoteUrl: string): ForgejoRepository | undefined {
  const location = remoteLocation(remoteUrl);
  const parts = location?.path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .split("/");
  const name = parts?.at(-1);
  const owner = parts?.at(-2);
  const url = URL.parse(remoteUrl);
  return location === undefined || location.host === "" || !owner || !name
    ? undefined
    : {
        id: `${location.host}/${owner}/${name}`.toLowerCase(),
        host: location.host,
        server:
          url?.protocol === "https:" || url?.protocol === "http:"
            ? url.host
            : undefined,
        owner,
        name,
      };
}

function fullName({ owner, name }: ForgejoRepository) {
  return `${owner}/${name}`.toLowerCase();
}

function listPullRequests(
  cli: TeaCli,
  login: TeaLogin,
  repository: ForgejoRepository,
  heads: readonly string[],
) {
  return Effect.gen(function* () {
    const wanted = new Set(heads);
    const read = yield* readPullRequests(cli, login.name, repository);
    const nodes = read.nodes.filter(
      (node) =>
        wanted.has(node.head.ref) &&
        node.head.repo?.full_name.toLowerCase() === fullName(repository) &&
        isServerLink(node.html_url, login.server),
    );
    const found = yield* Effect.forEach(
      nodes,
      (node) =>
        checksOf(cli, login.name, repository, node).pipe(
          Effect.map((checks) => ({
            head: node.head.ref,
            pullRequest: forgejoPullRequest(node, checks),
          })),
        ),
      { concurrency: checksAtOnce },
    );
    return new Map(
      heads.flatMap((head) => {
        const pullRequests = found
          .filter((candidate) => candidate.head === head)
          .map(({ pullRequest }) => pullRequest);
        return read.complete || pullRequests.length > 0
          ? [[head, pullRequests] as const]
          : [];
      }),
    );
  });
}

function readPullRequest(
  cli: TeaCli,
  login: TeaLogin,
  repository: ForgejoRepository,
  number: number,
) {
  return cli
    .api(login.name, `${repositoryEndpoint(repository)}/pulls/${number}`)
    .pipe(
      Effect.flatMap(decodePullRequest),
      Effect.flatMap((node) =>
        isServerLink(node.html_url, login.server)
          ? checksOf(cli, login.name, repository, node).pipe(
              Effect.map((checks) => forgejoPullRequest(node, checks)),
            )
          : Effect.succeed(undefined),
      ),
      Effect.orElseSucceed(() => undefined),
    );
}

function readPullRequests(
  cli: TeaCli,
  login: string,
  repository: ForgejoRepository,
  page = 1,
): Effect.Effect<
  { readonly nodes: readonly PullRequestNode[]; readonly complete: boolean },
  PullRequestsUnavailable
> {
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
          ? Effect.succeed({ nodes, complete: nodes.length < pageSize })
          : readPullRequests(cli, login, repository, page + 1).pipe(
              Effect.map((rest) => ({
                ...rest,
                nodes: [...nodes, ...rest.nodes],
              })),
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

function isServerLink(url: string, server: string) {
  const link = URL.parse(url);
  return link?.protocol === "https:" && link.host === server;
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

const decodePullRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PullRequestNode),
);

const decodeStatus = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ state: Schema.String, total_count: Schema.Int }),
  ),
);

function forgejoPullRequest(
  node: PullRequestNode,
  checks: PullRequest["checks"],
): HostedPullRequest {
  return pullRequest(
    {
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
    },
    checks,
    node.head.sha,
  );
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
