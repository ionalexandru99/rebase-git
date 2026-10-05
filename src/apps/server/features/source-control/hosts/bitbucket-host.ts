import { Effect, Schema } from "effect";
import type { RouteInput } from "#contracts/environment-connection/environment-route.contract.ts";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import {
  type BitbucketToken,
  type BitbucketTokenRejected,
  bitbucketApiTokenScopes,
  type SourceControlApi,
} from "#contracts/source-control/source-control.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  eachHead,
  type GitHost,
  type HostedPullRequest,
  type PullRequestsByHead,
  pullRequest,
  unavailable,
} from "#server/features/source-control/git-host.ts";
import {
  type BitbucketClient,
  bitbucketApi,
  readJson,
} from "#server/features/source-control/hosts/bitbucket-client.ts";
import {
  listCloneable,
  workspacesUrl,
} from "#server/features/source-control/hosts/bitbucket-repositories.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import { bitbucketTokenTable } from "#server/persistence/environment-state.schema.ts";
import { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation.ts";

export type Bitbucket = ReturnType<typeof createBitbucket>;

type SaveBitbucketToken = RouteInput<
  typeof SourceControlApi.saveBitbucketToken
>;

interface BitbucketRepository {
  readonly id: string;
  readonly workspace: string;
  readonly slug: string;
}

type SavedToken =
  | { readonly _tag: "AccessToken"; readonly authorization: string }
  | {
      readonly _tag: "ApiToken";
      readonly authorization: string;
      readonly email: string;
      readonly account: string;
    };

const pullRequestsPerBranch = 10;
const branchesAtOnce = 8;

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
            ? { _tag: "AccessToken", authorization: bearer(row.token) }
            : {
                _tag: "ApiToken",
                authorization: basic(row.email, row.token),
                email: row.email,
                account: row.account ?? row.email,
              },
      ),
    );

  const host: GitHost = {
    kind: "bitbucket",
    tool: saved.pipe(
      Effect.flatMap((current) =>
        current === undefined
          ? Effect.succeed(null)
          : savedToken(client, current),
      ),
      Effect.map((token) => ({ _tag: "Token" as const, saved: token })),
      Effect.orDie,
    ),
    repositoryId: (remoteUrl) => bitbucketRepository(remoteUrl)?.id,
    cloneable: Effect.gen(function* () {
      const current = yield* saved;
      if (current?._tag !== "ApiToken") return [];
      const repositories = yield* listCloneable(client, current.authorization);
      return [
        {
          kind: "bitbucket" as const,
          host: "bitbucket.org",
          account: current.account,
          repositories,
        },
      ];
    }).pipe(Effect.orElseSucceed(() => [])),
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
          pullRequest: (number) =>
            saved.pipe(
              Effect.flatMap((current) =>
                current === undefined
                  ? Effect.succeed(undefined)
                  : readPullRequest(
                      client,
                      current.authorization,
                      repository,
                      number,
                    ),
              ),
              Effect.orElseSucceed(() => undefined),
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

function savedToken(
  client: BitbucketClient,
  current: SavedToken,
): Effect.Effect<BitbucketToken> {
  if (current._tag === "AccessToken")
    return Effect.succeed({ _tag: "AccessToken" });
  return client.get(`${bitbucketApi}/user`, current.authorization).pipe(
    Effect.timeout("5 seconds"),
    Effect.map(({ scopes = [] }) =>
      scopes.some((scope) => scope.endsWith(":bitbucket"))
        ? bitbucketApiTokenScopes.filter((scope) => !scopes.includes(scope))
        : [],
    ),
    Effect.orElseSucceed(() => []),
    Effect.map((missingScopes) => ({
      _tag: "ApiToken",
      email: current.email,
      account: current.account,
      missingScopes,
    })),
  );
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
  const authorization = basic(request.email, request.token);
  const check = (url: string) =>
    client.get(url, authorization).pipe(
      Effect.catch(() => rejected("Unreachable")),
      Effect.flatMap(({ status, body }) => {
        if (status === 401) return rejected("Invalid");
        if (status === 403) return rejected("MissingScope");
        if (status !== 200) return rejected("Unreachable");
        return Effect.succeed(body);
      }),
    );
  return check(`${bitbucketApi}/user`).pipe(
    Effect.flatMap((body) =>
      decodeUser(body).pipe(Effect.catch(() => rejected("Unreachable"))),
    ),
    Effect.tap(() => check(workspacesUrl(1))),
    Effect.map(
      (user) =>
        user.username ?? user.nickname ?? user.display_name ?? request.email,
    ),
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
  return eachHead(heads, branchesAtOnce, (head) =>
    readJson(
      client,
      authorization,
      pullRequestsUrl(repository, head),
      decodePullRequests,
    ).pipe(
      Effect.flatMap(({ values }) =>
        Effect.forEach(
          values.filter(
            (node) =>
              node.source.repository?.full_name.toLowerCase() === repository.id,
          ),
          (node) => withChecks(client, authorization, repository, node),
          { concurrency: "unbounded" },
        ),
      ),
    ),
  );
}

function readPullRequest(
  client: BitbucketClient,
  authorization: string,
  repository: BitbucketRepository,
  number: number,
) {
  return readJson(
    client,
    authorization,
    pullRequestUrl(repository, number),
    decodePullRequest,
  ).pipe(
    Effect.flatMap((node) =>
      withChecks(client, authorization, repository, node),
    ),
  );
}

function withChecks(
  client: BitbucketClient,
  authorization: string,
  repository: BitbucketRepository,
  node: PullRequestNode,
) {
  const hash = node.source.commit?.hash;
  return (
    node.state === "OPEN" && hash !== undefined
      ? readJson(
          client,
          authorization,
          statusesUrl(repository, hash),
          decodeStatuses,
        ).pipe(
          Effect.map(({ values }) => checksState(values)),
          Effect.orElseSucceed(() => undefined),
        )
      : Effect.succeed(undefined)
  ).pipe(
    Effect.map((checks) => bitbucketPullRequest(repository, node, checks)),
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

const pullRequestFields = [
  "id",
  "title",
  "state",
  "draft",
  "source.repository.full_name",
  "source.commit.hash",
];

function repositoryPath({ workspace, slug }: BitbucketRepository) {
  return `${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}`;
}

function pullRequestsUrl(repository: BitbucketRepository, head: string) {
  const query = new URLSearchParams({
    q: `source.branch.name = ${bbqlString(head)}`,
    sort: "-updated_on",
    pagelen: String(pullRequestsPerBranch),
    fields: pullRequestFields.map((field) => `values.${field}`).join(","),
  });
  for (const state of ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"])
    query.append("state", state);
  return `${bitbucketApi}/repositories/${repositoryPath(repository)}/pullrequests?${query}`;
}

function pullRequestUrl(repository: BitbucketRepository, number: number) {
  return `${bitbucketApi}/repositories/${repositoryPath(repository)}/pullrequests/${number}?${new URLSearchParams(
    { fields: pullRequestFields.join(",") },
  )}`;
}

function bbqlString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function statusesUrl(repository: BitbucketRepository, hash: string) {
  return `${bitbucketApi}/repositories/${repositoryPath(repository)}/commit/${encodeURIComponent(hash)}/statuses?${new URLSearchParams(
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

const decodePullRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PullRequestNode),
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
