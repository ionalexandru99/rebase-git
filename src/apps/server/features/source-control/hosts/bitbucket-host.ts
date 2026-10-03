import { Effect, Schema } from "effect";
import type { RouteInput } from "#contracts/environment-connection/environment-route.contract.ts";
import type {
  PullRequest,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import type {
  BitbucketToken,
  BitbucketTokenRejected,
  SourceControlApi,
} from "#contracts/source-control/source-control.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  eachHead,
  type GitHost,
  type HostedPullRequest,
  type HostResponse,
  hostGet,
  type PullRequestsByHead,
  pullRequest,
  unavailable,
} from "#server/features/source-control/git-host.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import { bitbucketTokenTable } from "#server/persistence/environment-state.schema.ts";
import { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation.ts";

export interface BitbucketClient {
  readonly get: (
    url: string,
    authorization: string,
  ) => Effect.Effect<HostResponse, PullRequestsUnavailable>;
}

export type Bitbucket = ReturnType<typeof createBitbucket>;

type SaveBitbucketToken = RouteInput<
  typeof SourceControlApi.saveBitbucketToken
>;

interface BitbucketRepository {
  readonly id: string;
  readonly workspace: string;
  readonly slug: string;
}

interface SavedToken {
  readonly authorization: string;
  readonly token: BitbucketToken;
}

const api = "https://api.bitbucket.org/2.0";
const pullRequestsPerBranch = 10;
const branchesAtOnce = 8;

export function createBitbucketClient(): BitbucketClient {
  return { get: (url, authorization) => hostGet(url, { authorization }) };
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
    tool: saved.pipe(
      Effect.map((current) => ({
        _tag: "Token" as const,
        saved: current?.token ?? null,
      })),
      Effect.orDie,
    ),
    repositoryId: (remoteUrl) => bitbucketRepository(remoteUrl)?.id,
    repository: (remoteUrl) => {
      const repository = bitbucketRepository(remoteUrl);
      return Effect.succeed(
        repository && {
          id: repository.id,
          pullRequests: (heads) =>
            saved.pipe(
              Effect.mapError(() => unavailable),
              Effect.flatMap((current) =>
                current === undefined
                  ? Effect.succeed<PullRequestsByHead>(new Map())
                  : listPullRequests(
                      client,
                      current.authorization,
                      repository,
                      heads,
                    ),
              ),
            ),
        },
      );
    },
  };

  return {
    host,
    save: (request: SaveBitbucketToken) =>
      verify(client, request).pipe(
        Effect.flatMap((account) =>
          context
            .write("Could not save the Bitbucket token", (database) => {
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
            })
            .pipe(
              Effect.mapError(
                () =>
                  new EnvironmentStorageError({
                    cause: undefined,
                    message: "Could not save the Bitbucket token",
                  }),
              ),
            ),
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
  repository: BitbucketRepository,
  heads: readonly string[],
) {
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
    node.state === "OPEN" && node.source.commit?.hash !== undefined
      ? read(
          statusesUrl(repository, node.source.commit.hash),
          decodeStatuses,
        ).pipe(
          Effect.map(({ values }) => checksState(values)),
          Effect.orElseSucceed(() => undefined),
        )
      : Effect.succeed(undefined);
  return eachHead(heads, branchesAtOnce, (head) =>
    read(pullRequestsUrl(repository, head), decodePullRequests).pipe(
      Effect.flatMap(({ values }) =>
        Effect.forEach(
          values.filter(
            (node) =>
              node.source.repository?.full_name.toLowerCase() === repository.id,
          ),
          (node) =>
            checks(node).pipe(
              Effect.map((state) =>
                bitbucketPullRequest(repository, node, state),
              ),
            ),
          { concurrency: "unbounded" },
        ),
      ),
    ),
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
    ? { id: `${workspace}/${slug}`.toLowerCase(), workspace, slug }
    : undefined;
}

function repositoryPath({ workspace, slug }: BitbucketRepository) {
  return `${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}`;
}

function pullRequestsUrl(repository: BitbucketRepository, head: string) {
  const query = new URLSearchParams({
    q: `source.repository.full_name = ${bbqlString(repository.id)} AND source.branch.name = ${bbqlString(head)}`,
    sort: "-updated_on",
    pagelen: String(pullRequestsPerBranch),
    fields:
      "values.id,values.title,values.state,values.draft,values.source.repository.full_name,values.source.commit.hash",
  });
  for (const state of ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"])
    query.append("state", state);
  return `${api}/repositories/${repositoryPath(repository)}/pullrequests?${query}`;
}

function bbqlString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function statusesUrl(repository: BitbucketRepository, hash: string) {
  return `${api}/repositories/${repositoryPath(repository)}/commit/${encodeURIComponent(hash)}/statuses?${new URLSearchParams(
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
    commit: Schema.optionalKey(
      Schema.NullOr(Schema.Struct({ hash: Schema.String })),
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

function bitbucketPullRequest(
  repository: BitbucketRepository,
  node: PullRequestNode,
  checks: PullRequest["checks"],
): HostedPullRequest {
  return pullRequest(
    {
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
    },
    checks,
    node.source.commit?.hash,
  );
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
