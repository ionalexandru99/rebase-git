import { z } from "zod";
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
  type AvatarAuthor,
  avatarUrl,
  decodeHostJson,
  eachHead,
  foundAvatar,
  type GitHost,
  type HostedPullRequest,
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
  const saved = async (): Promise<SavedToken | undefined> => {
    const row = await context.read(
      "Could not read the Bitbucket token",
      (database) => database.select().from(bitbucketTokenTable).get(),
    );
    return row === undefined
      ? undefined
      : row.email === null
        ? { _tag: "AccessToken", authorization: bearer(row.token) }
        : {
            _tag: "ApiToken",
            authorization: basic(row.email, row.token),
            email: row.email,
            account: row.account ?? row.email,
          };
  };
  const savedOrUnavailable = () =>
    saved().catch(() => {
      throw unavailable;
    });

  const host: GitHost = {
    kind: "bitbucket",
    tool: async () => {
      const current = await saved();
      return {
        _tag: "Token",
        saved: current === undefined ? null : await savedToken(client, current),
      };
    },
    repositoryId: (remoteUrl) => bitbucketRepository(remoteUrl)?.id,
    cloneable: async () => {
      try {
        const current = await saved();
        if (current?._tag !== "ApiToken") return [];
        const repositories = await listCloneable(client, current.authorization);
        return [
          {
            kind: "bitbucket" as const,
            host: "bitbucket.org",
            account: current.account,
            repositories,
          },
        ];
      } catch {
        return [];
      }
    },
    repository: async (remoteUrl) => {
      const repository = bitbucketRepository(remoteUrl);
      return (
        repository && {
          id: repository.id,
          pullRequests: async (heads) => {
            const current = await savedOrUnavailable();
            return current === undefined
              ? new Map()
              : listPullRequests(
                  client,
                  current.authorization,
                  repository,
                  heads,
                );
          },
          pullRequest: async (number) => {
            try {
              const current = await saved();
              return current === undefined
                ? undefined
                : await readPullRequest(
                    client,
                    current.authorization,
                    repository,
                    number,
                  );
            } catch {
              return undefined;
            }
          },
          avatar: async (author) => {
            const current = await savedOrUnavailable();
            return current === undefined
              ? { answered: false }
              : readAvatar(client, current.authorization, repository, author);
          },
        }
      );
    },
  };

  return {
    host,
    save: async (request: SaveBitbucketToken) => {
      const account = await verify(client, request);
      await context.write("Could not save the Bitbucket token", (database) => {
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
      });
    },
    remove: async () => {
      await context.write("Could not remove the Bitbucket token", (database) =>
        database.delete(bitbucketTokenTable),
      );
    },
  };
}

async function savedToken(
  client: BitbucketClient,
  current: SavedToken,
): Promise<BitbucketToken> {
  if (current._tag === "AccessToken") return { _tag: "AccessToken" };
  const missingScopes = await client
    .get(`${bitbucketApi}/user`, current.authorization, 5_000)
    .then(({ scopes = [] }) =>
      scopes.some((scope) => scope.endsWith(":bitbucket"))
        ? bitbucketApiTokenScopes.filter((scope) => !scopes.includes(scope))
        : [],
    )
    .catch(() => []);
  return {
    _tag: "ApiToken",
    email: current.email,
    account: current.account,
    missingScopes,
  };
}

async function verify(
  client: BitbucketClient,
  request: SaveBitbucketToken,
): Promise<string | null> {
  if (request._tag === "AccessToken") return null;
  const rejected = (
    reason: BitbucketTokenRejected["reason"],
  ): BitbucketTokenRejected => ({ _tag: "BitbucketTokenRejected", reason });
  const authorization = basic(request.email, request.token);
  const check = async (url: string) => {
    const { status, body } = await client.get(url, authorization).catch(() => {
      throw rejected("Unreachable");
    });
    if (status === 401) throw rejected("Invalid");
    if (status === 403) throw rejected("MissingScope");
    if (status !== 200) throw rejected("Unreachable");
    return body;
  };
  const body = await check(`${bitbucketApi}/user`);
  let user: z.infer<typeof User>;
  try {
    user = decodeHostJson(User)(body);
  } catch {
    throw rejected("Unreachable");
  }
  await check(workspacesUrl(1));
  return user.username ?? user.nickname ?? user.display_name ?? request.email;
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
  return eachHead(heads, branchesAtOnce, async (head) => {
    const { values } = await readJson(
      client,
      authorization,
      pullRequestsUrl(repository, head),
      PullRequests,
    );
    return Promise.all(
      values
        .filter(
          (node) =>
            node.source.repository?.full_name.toLowerCase() === repository.id,
        )
        .map((node) => withChecks(client, authorization, repository, node)),
    );
  });
}

async function readPullRequest(
  client: BitbucketClient,
  authorization: string,
  repository: BitbucketRepository,
  number: number,
) {
  const node = await readJson(
    client,
    authorization,
    pullRequestUrl(repository, number),
    PullRequestNode,
  );
  return withChecks(client, authorization, repository, node);
}

async function readAvatar(
  client: BitbucketClient,
  authorization: string,
  repository: BitbucketRepository,
  author: AvatarAuthor,
) {
  const { author: found } = await readJson(
    client,
    authorization,
    `${bitbucketApi}/repositories/${repositoryPath(repository)}/commit/${encodeURIComponent(author.commit)}?${new URLSearchParams(
      { fields: "author.raw,author.user.links.avatar.href" },
    )}`,
    CommitAuthor,
  );
  const url = found.raw
    ?.toLowerCase()
    .endsWith(`<${author.email.toLowerCase()}>`)
    ? avatarUrl(found.user?.links.avatar.href, [
        "avatar-management--avatars.us-west-2.prod.public.atl-paas.net",
      ])
    : undefined;
  return foundAvatar(
    URL.parse(url ?? "")?.pathname.startsWith("/initials/") ? undefined : url,
  );
}

async function withChecks(
  client: BitbucketClient,
  authorization: string,
  repository: BitbucketRepository,
  node: PullRequestNode,
) {
  const hash = node.source.commit?.hash;
  const checks =
    node.state === "OPEN" && hash !== undefined
      ? await readJson(
          client,
          authorization,
          statusesUrl(repository, hash),
          Statuses,
        ).then(
          ({ values }) => checksState(values),
          () => undefined,
        )
      : undefined;
  return bitbucketPullRequest(repository, node, checks);
}

function bitbucketRepository(
  remoteUrl: string,
): BitbucketRepository | undefined {
  const location = remoteLocation(remoteUrl);
  if (
    location?.host !== "bitbucket.org" &&
    location?.host !== "ssh.bitbucket.org"
  )
    return undefined;
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

const User = z.object({
  username: z.string().optional(),
  nickname: z.string().optional(),
  display_name: z.string().optional(),
});

const PullRequestNode = z.object({
  id: z.number().int(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  source: z.object({
    repository: z.object({ full_name: z.string() }).nullable().optional(),
    commit: z.object({ hash: z.string() }).nullable().optional(),
  }),
});
type PullRequestNode = z.infer<typeof PullRequestNode>;

const PullRequests = z.object({ values: z.array(PullRequestNode) });

const CommitAuthor = z.object({
  author: z.object({
    raw: z.string().optional(),
    user: z
      .object({
        links: z.object({ avatar: z.object({ href: z.string() }) }),
      })
      .nullable()
      .optional(),
  }),
});

const Statuses = z.object({
  values: z.array(z.object({ state: z.string() })),
});

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
