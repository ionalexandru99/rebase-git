import type { GitLabCli } from "#server/features/source-control/hosts/gitlab-host.ts";

interface GitLabMergeRequestNode {
  readonly iid: number;
  readonly state?: "opened" | "closed" | "locked" | "merged";
  readonly draft?: boolean;
  readonly project?: string;
  readonly pipeline?: string;
}

interface GitLabRepository {
  readonly name: string;
  readonly private?: boolean;
}

export function fakeGitLab(
  bySourceBranch: Readonly<
    Record<string, readonly GitLabMergeRequestNode[]>
  > | null,
  {
    version = "glab 1.120.0 (78790114c)",
    accounts = { "gitlab.com": "tanuki" },
    visible = true,
    protocols = {},
    repositories = {},
  }: {
    readonly version?: string | null;
    readonly accounts?: Readonly<Record<string, string>>;
    readonly visible?: boolean;
    readonly protocols?: Readonly<Record<string, "ssh" | "https">>;
    readonly repositories?: Readonly<
      Record<string, readonly GitLabRepository[]>
    >;
  } = {},
) {
  const requests: Readonly<Record<string, string>>[] = [];
  const statusOf = (host: string) =>
    accounts[host] === undefined
      ? `${host}\n  x ${host}: API call failed: 401 Unauthorized`
      : `${host}\n  ✓ Logged in to ${host} as ${accounts[host]} (/home/tanuki/.config/glab-cli/config.yml)`;
  const gitlab: GitLabCli = {
    version: async () => version ?? undefined,
    authStatus: (hostname) =>
      Promise.resolve(
        hostname === undefined
          ? Object.keys(accounts).map(statusOf).join("\n")
          : statusOf(hostname),
      ),
    protocol: (hostname) => Promise.resolve(protocols[hostname] ?? "ssh"),
    repositories: (hostname, page) => {
      const listed = repositories[hostname];
      if (listed === undefined)
        return Promise.reject({ _tag: "PullRequestsUnavailable" });
      return Promise.resolve(
        JSON.stringify(
          listed.slice((page - 1) * 100, page * 100).map((repository) => ({
            path_with_namespace: repository.name,
            visibility: repository.private ? "private" : "public",
            description: null,
            last_activity_at: "2026-10-01T10:00:00.000Z",
            ssh_url_to_repo: `git@${hostname}:${repository.name}.git`,
            http_url_to_repo: `https://${hostname}/${repository.name}.git`,
          })),
        ),
      );
    },
    avatar: () => Promise.resolve(JSON.stringify({ avatar_url: null })),
    graphql: (hostname, query, variables) => {
      requests.push({ hostname, ...variables });
      if (bySourceBranch === null)
        return Promise.reject({ _tag: "PullRequestsUnavailable" });
      const fullPath = variables.fullPath ?? "";
      const asNode = (node: GitLabMergeRequestNode) => ({
        iid: String(node.iid),
        webUrl: `https://${hostname}/${fullPath}/-/merge_requests/${node.iid}`,
        title: `Merge request ${node.iid}`,
        state: node.state ?? "opened",
        draft: node.draft ?? false,
        sourceProject: { fullPath: node.project ?? fullPath },
        headPipeline:
          node.pipeline === undefined ? null : { status: node.pipeline },
      });
      const wanted = /mergeRequest\(iid: "(\d+)"\)/.exec(query)?.[1];
      if (wanted !== undefined) {
        const node = Object.values(bySourceBranch)
          .flat()
          .find(({ iid }) => String(iid) === wanted);
        return Promise.resolve(
          JSON.stringify({
            data: {
              project: {
                mergeRequest: node === undefined ? null : asNode(node),
              },
            },
          }),
        );
      }
      const project = Object.fromEntries(
        Object.entries(variables)
          .filter(([alias]) => /^b\d+$/.test(alias))
          .map(([alias, sourceBranch]) => [
            alias,
            { nodes: (bySourceBranch[sourceBranch] ?? []).map(asNode) },
          ]),
      );
      return Promise.resolve(
        JSON.stringify({ data: { project: visible ? project : null } }),
      );
    },
  };
  return { gitlab, requests };
}
