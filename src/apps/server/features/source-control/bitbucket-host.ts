import { Effect, Schema } from "effect";
import type { RouteInput } from "#contracts/environment-connection/environment-route.contract.ts";
import type {
  BranchPullRequests,
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import type {
  BitbucketToken,
  BitbucketTokenRejected,
  SourceControlApi,
} from "#contracts/source-control/source-control.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import type {
  GitHost,
  TrackedBranch,
} from "#server/features/source-control/git-host.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import { bitbucketTokenTable } from "#server/persistence/environment-state.schema.ts";

export interface BitbucketResponse {
  readonly status: number;
  readonly body: string;
}

export interface BitbucketClient {
  readonly get: (
    url: string,
    authorization: string,
  ) => Effect.Effect<BitbucketResponse, PullRequestsUnavailable>;
}

export type Bitbucket = ReturnType<typeof createBitbucket>;

type SaveBitbucketToken = RouteInput<
  typeof SourceControlApi.saveBitbucketToken
>;

interface BitbucketRepository {
  readonly workspace: string;
  readonly slug: string;
}

interface SavedToken {
  readonly authorization: string;
  readonly token: BitbucketToken;
}

const unavailable: PullRequestsUnavailable = {
  _tag: "PullRequestsUnavailable",
};
const api = "https://api.bitbucket.org/2.0";
const pullRequestsPerBranch = 10;
const branchesAtOnce = 8;

export function createBitbucketClient(): BitbucketClient {
  return {
    get: (url, authorization) =>
      Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(url, {
            headers: { accept: "application/json", authorization },
            redirect: "error",
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          });
          return { status: response.status, body: await response.text() };
        },
        catch: () => unavailable,
      }),
  };
}

export function createBitbucket(
  context: EnvironmentContext,
  client: BitbucketClient,
) {
  const saved = context
    .read("Could not read the Bitbucket token", (database) =>
      database.select().from(bitbucketTokenTable).get(),
    )
    .pipe(
      Effect.map((row): SavedToken | undefined =>
        row === undefined
          ? undefined
          : row.email === null
            ? {
                authorization: bearer(row.token),
                token: { _tag: "AccessToken" },
              }
            : {
                authorization: basic(row.email, row.token),
                token: {
                  _tag: "ApiToken",
                  email: row.email,
                  account: row.account ?? row.email,
                },
              },
      ),
    );

  const host: GitHost = {
    kind: "bitbucket",
    serves: (remoteUrl) =>
      Effect.succeed(bitbucketRepository(remoteUrl) !== undefined),
    tool: saved.pipe(
      Effect.map((current) => ({
        _tag: "Token" as const,
        saved: current?.token ?? null,
      })),
      Effect.orDie,
    ),
    pullRequests: (remoteUrl, branches) =>
      saved.pipe(
        Effect.mapError(() => unavailable),
        Effect.flatMap((current) =>
          current === undefined
            ? Effect.succeed([])
            : listPullRequests(
                client,
                current.authorization,
                remoteUrl,
                branches,
              ),
        ),
      ),
  };

  return {
    host,
    save: (request: SaveBitbucketToken) =>
      verify(client, request).pipe(
        Effect.flatMap((account) =>
          context.write("Could not save the Bitbucket token", (database) => {
            const row = {
              singleton: 1,
              token: request.token,
              email: request._tag === "ApiToken" ? request.email : null,
              account,
            };
            return database
              .insert(bitbucketTokenTable)
              .values(row)
              .onConflictDoUpdate({
                target: bitbucketTokenTable.singleton,
                set: row,
              });
          }),
        ),
        Effect.asVoid,
      ),
    remove: context
      .write("Could not remove the Bitbucket token", (database) =>
        database.delete(bitbucketTokenTable),
      )
      .pipe(Effect.asVoid),
  };
}

function verify(
  client: BitbucketClient,
  request: SaveBitbucketToken,
): Effect.Effect<string | null, BitbucketTokenRejected> {
  if (request._tag === "AccessToken") return Effect.succeed(null);
  const rejected = (reason: BitbucketTokenRejected["reason"]) =>
    Effect.fail<BitbucketTokenRejected>({
      _tag: "BitbucketTokenRejected",
      reason,
    });
  return client.get(`${api}/user`, basic(request.email, request.token)).pipe(
    Effect.catch(() => rejected("Unreachable")),
    Effect.flatMap(({ status, body }) => {
      if (status === 401) return rejected("Invalid");
      if (status === 403) return rejected("MissingScope");
      if (status !== 200) return rejected("Unreachable");
      return decodeUser(body).pipe(
        Effect.map(
          (user) =>
            user.username ??
            user.nickname ??
            user.display_name ??
            request.email,
        ),
        Effect.catch(() => rejected("Unreachable")),
      );
    }),
  );
}

function bearer(token: string) {
  return `Bearer ${token}`;
}

function basic(email: string, token: string) {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

function listPullRequests(
  client: BitbucketClient,
  authorization: string,
  remoteUrl: string,
  branches: readonly TrackedBranch[],
) {
  const repository = bitbucketRepository(remoteUrl);
  if (repository === undefined) return Effect.succeed([]);
  const fullName = `${repository.workspace}/${repository.slug}`.toLowerCase();
  const tracked = branches.filter(({ remoteUrl }) => {
    const candidate = bitbucketRepository(remoteUrl);
    return (
      candidate !== undefined &&
      `${candidate.workspace}/${candidate.slug}`.toLowerCase() === fullName
    );
  });
  const read = <A>(
    url: string,
    decode: (body: string) => Effect.Effect<A, unknown>,
  ) =>
    client.get(url, authorization).pipe(
      Effect.flatMap(({ status, body }) =>
        status === 200 ? decode(body) : Effect.fail(unavailable),
      ),
      Effect.mapError(() => unavailable),
    );
  const checks = (node: PullRequestNode) =>
    node.state === "OPEN"
      ? read(statusesUrl(repository, node), decodeStatuses).pipe(
          Effect.map(({ values }) => checksState(values)),
          Effect.orElseSucceed(() => undefined),
        )
      : Effect.succeed(undefined);
  return Effect.forEach(
    tracked,
    (branch) =>
      read(pullRequestsUrl(repository, branch), decodePullRequests).pipe(
        Effect.flatMap(({ values }) =>
          Effect.forEach(
            values.filter(
              (node) =>
                node.source.repository?.full_name.toLowerCase() === fullName,
            ),
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
}

function bitbucketRepository(
  remoteUrl: string,
): BitbucketRepository | undefined {
  const location = remoteLocation(remoteUrl);
  if (location?.host !== "bitbucket.org") return undefined;
  const parts = location.path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .split("/");
  const [workspace, slug, ...rest] = parts;
  return workspace && slug && rest.length === 0
    ? { workspace, slug }
    : undefined;
}

function repositoryPath({ workspace, slug }: BitbucketRepository) {
  return `${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}`;
}

function pullRequestsUrl(
  repository: BitbucketRepository,
  { head }: TrackedBranch,
) {
  const query = new URLSearchParams({
    q: `source.branch.name = "${head.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    sort: "-updated_on",
    pagelen: String(pullRequestsPerBranch),
    fields:
      "values.id,values.title,values.state,values.draft,values.source.repository.full_name",
  });
  for (const state of ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"])
    query.append("state", state);
  return `${api}/repositories/${repositoryPath(repository)}/pullrequests?${query}`;
}

function statusesUrl(repository: BitbucketRepository, node: PullRequestNode) {
  return `${api}/repositories/${repositoryPath(repository)}/pullrequests/${node.id}/statuses?${new URLSearchParams(
    { pagelen: "50", fields: "values.state" },
  )}`;
}

const decodeUser = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      username: Schema.optionalKey(Schema.String),
      nickname: Schema.optionalKey(Schema.String),
      display_name: Schema.optionalKey(Schema.String),
    }),
  ),
);

const PullRequestNode = Schema.Struct({
  id: Schema.Int,
  title: Schema.String,
  state: Schema.String,
  draft: Schema.optionalKey(Schema.Boolean),
  source: Schema.Struct({
    repository: Schema.optionalKey(
      Schema.NullOr(Schema.Struct({ full_name: Schema.String })),
    ),
  }),
});
type PullRequestNode = typeof PullRequestNode.Type;

const decodePullRequests = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ values: Schema.Array(PullRequestNode) }),
  ),
);

const decodeStatuses = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      values: Schema.Array(Schema.Struct({ state: Schema.String })),
    }),
  ),
);

function pullRequest(
  repository: BitbucketRepository,
  node: PullRequestNode,
  checks: PullRequest["checks"],
): PullRequest {
  return {
    kind: "PullRequest",
    number: node.id,
    url: `https://bitbucket.org/${repositoryPath(repository)}/pull-requests/${node.id}`,
    title: node.title,
    state:
      node.state === "OPEN"
        ? node.draft === true
          ? "Draft"
          : "Open"
        : node.state === "MERGED"
          ? "Merged"
          : "Closed",
    ...(checks === undefined ? {} : { checks }),
  };
}

function checksState(
  statuses: readonly { readonly state: string }[],
): PullRequest["checks"] {
  const states = statuses.map(({ state }) => state);
  if (states.some((state) => state === "FAILED" || state === "STOPPED"))
    return "Failing";
  if (states.includes("INPROGRESS")) return "Pending";
  if (states.includes("SUCCESSFUL")) return "Passing";
  return undefined;
}
