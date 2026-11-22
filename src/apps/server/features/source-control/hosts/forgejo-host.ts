import { z } from "zod";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import { remoteLocation } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  type AvatarAuthor,
  avatarUrl,
  decodeHostJson,
  foundAvatar,
  type GitHost,
  gravatarHosts,
  type HostedPullRequest,
  hostCommandOutput,
  mapConcurrently,
  pullRequest,
  sameEmail,
  signedInTool,
} from "#server/features/source-control/git-host.ts";
import { forgejoCloneable } from "#server/features/source-control/hosts/forgejo-repositories.ts";

export interface TeaCli {
  readonly version: () => Promise<string | undefined>;
  readonly logins: () => Promise<string>;
  readonly login: (name: string) => Promise<string>;
  readonly api: (login: string, endpoint: string) => Promise<string>;
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
    version: async () => {
      const version = await tea(["--version"]).then(
        (output) => /(\d+)\.(\d+)\.\d+/.exec(output),
        () => null,
      );
      return version === null ||
        (Number(version[1]) === 0 && Number(version[2]) < 12)
        ? undefined
        : `tea ${version[0]}`;
    },
    logins: () => tea(["logins", "list", "--output", "json"]).catch(() => "[]"),
    login: (name) => tea(["logins", name]),
    api: (login, endpoint) => tea(["api", "--login", login, endpoint]),
  };
}

export function createForgejoHost(cli: TeaCli): GitHost {
  return {
    kind: "forgejo",
    tool: signedInTool(cli.version, async () =>
      (await readLogins(cli)).map(({ server, account }) => ({
        host: server,
        account,
      })),
    ),
    repositoryId: (remoteUrl) => forgejoRepository(remoteUrl)?.id,
    cloneable: async () => forgejoCloneable(cli, await readLogins(cli)),
    repository: async (remoteUrl) => {
      const repository = forgejoRepository(remoteUrl);
      if (repository === undefined) return undefined;
      const login = loginFor(await readLogins(cli), repository);
      return (
        login && {
          id: repository.id,
          pullRequests: (heads) =>
            listPullRequests(cli, login, repository, heads),
          pullRequest: (number) =>
            readPullRequest(cli, login, repository, number),
          avatar: (author) => readAvatar(cli, login, repository, author),
        }
      );
    },
  };
}

const decodeTeaLogins = decodeHostJson(
  z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      ssh_host: z.string().optional(),
      user: z.string().optional(),
    }),
  ),
);

async function readLogins(cli: TeaCli): Promise<readonly TeaLogin[]> {
  try {
    return decodeTeaLogins(await cli.logins()).flatMap(
      ({ name, url, ssh_host, user }) => {
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
      },
    );
  } catch {
    return [];
  }
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

async function listPullRequests(
  cli: TeaCli,
  login: TeaLogin,
  repository: ForgejoRepository,
  heads: readonly string[],
) {
  const wanted = new Set(heads);
  const read = await readPullRequests(cli, login.name, repository);
  const nodes = read.nodes.filter(
    (node) =>
      wanted.has(node.head.ref) &&
      node.head.repo?.full_name.toLowerCase() === fullName(repository) &&
      isServerLink(node.html_url, login.server),
  );
  const found = await mapConcurrently(nodes, checksAtOnce, async (node) => ({
    head: node.head.ref,
    pullRequest: forgejoPullRequest(
      node,
      await checksOf(cli, login.name, repository, node),
    ),
  }));
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
}

async function readPullRequest(
  cli: TeaCli,
  login: TeaLogin,
  repository: ForgejoRepository,
  number: number,
) {
  try {
    const node = decodePullRequest(
      await cli.api(
        login.name,
        `${repositoryEndpoint(repository)}/pulls/${number}`,
      ),
    );
    return isServerLink(node.html_url, login.server)
      ? forgejoPullRequest(
          node,
          await checksOf(cli, login.name, repository, node),
        )
      : undefined;
  } catch {
    return undefined;
  }
}

async function readAvatar(
  cli: TeaCli,
  login: TeaLogin,
  repository: ForgejoRepository,
  author: AvatarAuthor,
) {
  const commit = decodeCommit(
    await cli.api(
      login.name,
      `${repositoryEndpoint(repository)}/git/commits/${encodeURIComponent(author.commit)}?stat=false&verification=false&files=false`,
    ),
  );
  const url = sameEmail(commit.commit.author?.email, author)
    ? avatarUrl(commit.author?.avatar_url, [login.host, ...gravatarHosts], {
        size: "40",
      })
    : undefined;
  return foundAvatar(url);
}

async function readPullRequests(
  cli: TeaCli,
  login: string,
  repository: ForgejoRepository,
) {
  const nodes: PullRequestNode[] = [];
  for (let page = 1; ; page += 1) {
    const read = decodePullRequests(
      await cli.api(
        login,
        `${repositoryEndpoint(repository)}/pulls?${new URLSearchParams({
          state: "all",
          sort: "recentupdate",
          limit: String(pageSize),
          page: String(page),
        })}`,
      ),
    );
    nodes.push(...read);
    if (read.length < pageSize || page === pagesRead)
      return { nodes, complete: read.length < pageSize };
  }
}

async function checksOf(
  cli: TeaCli,
  login: string,
  repository: ForgejoRepository,
  node: PullRequestNode,
): Promise<PullRequest["checks"]> {
  if (node.state !== "open") return undefined;
  try {
    return checksState(
      decodeStatus(
        await cli.api(
          login,
          `${repositoryEndpoint(repository)}/commits/${encodeURIComponent(node.head.sha)}/status`,
        ),
      ),
    );
  } catch {
    return undefined;
  }
}

function repositoryEndpoint({ owner, name }: ForgejoRepository) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function isServerLink(url: string, server: string) {
  const link = URL.parse(url);
  return link?.protocol === "https:" && link.host === server;
}

const PullRequestNode = z.object({
  number: z.number().int(),
  html_url: z.string(),
  title: z.string(),
  state: z.string(),
  merged: z.boolean(),
  draft: z.boolean().optional(),
  head: z.object({
    ref: z.string(),
    sha: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
});
type PullRequestNode = z.infer<typeof PullRequestNode>;

const decodePullRequests = decodeHostJson(z.array(PullRequestNode));

const decodePullRequest = decodeHostJson(PullRequestNode);

const decodeCommit = decodeHostJson(
  z.object({
    commit: z.object({
      author: z.object({ email: z.string() }).nullable().optional(),
    }),
    author: z.object({ avatar_url: z.string() }).nullable().optional(),
  }),
);

const decodeStatus = decodeHostJson(
  z.object({ state: z.string(), total_count: z.number().int() }),
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
