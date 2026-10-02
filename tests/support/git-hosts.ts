import { Effect } from "effect";
import type { AzureDevOpsClient } from "#server/features/source-control/azure-devops-host.ts";
import type { GitHubCli } from "#server/features/source-control/github-host.ts";
import type { GitLabCli } from "#server/features/source-control/gitlab-host.ts";

interface GitHubPullRequestNode {
  readonly number: number;
  readonly state?: "OPEN" | "CLOSED" | "MERGED";
  readonly isDraft?: boolean;
  readonly owner?: string;
  readonly checks?: string;
}

export function fakeGitHub(
  byHead: Readonly<Record<string, readonly GitHubPullRequestNode[]>> | null,
  {
    version = "gh version 2.101.0 (2026-09-15)",
    account = "octo",
  }: {
    readonly version?: string | null;
    readonly account?: string | null;
  } = {},
) {
  const requests: Readonly<Record<string, string>>[] = [];
  const github: GitHubCli = {
    version: Effect.succeed(version ?? undefined),
    account: Effect.succeed(account ?? undefined),
    graphql: (_query, variables) => {
      requests.push(variables);
      if (byHead === null)
        return Effect.fail({ _tag: "PullRequestsUnavailable" });
      const repository = Object.fromEntries(
        Object.entries(variables)
          .filter(([alias]) => /^b\d+$/.test(alias))
          .map(([alias, head]) => [
            alias,
            {
              nodes: (byHead[head] ?? []).map((node) => ({
                number: node.number,
                url: `https://github.com/${variables.owner}/${variables.name}/pull/${node.number}`,
                title: `Pull request ${node.number}`,
                state: node.state ?? "OPEN",
                isDraft: node.isDraft ?? false,
                headRepositoryOwner: { login: node.owner ?? variables.owner },
                commits: {
                  nodes: [
                    {
                      commit: {
                        statusCheckRollup:
                          node.checks === undefined
                            ? null
                            : { state: node.checks },
                      },
                    },
                  ],
                },
              })),
            },
          ]),
      );
      return Effect.succeed(JSON.stringify({ data: { repository } }));
    },
  };
  return { github, requests };
}

interface AzureDevOpsPullRequestNode {
  readonly id: number;
  readonly status?: "active" | "completed" | "abandoned";
  readonly isDraft?: boolean;
  readonly fork?: boolean;
  readonly checks?: readonly string[];
}

export function fakeAzureDevOps(
  byHead: Readonly<
    Record<string, readonly AzureDevOpsPullRequestNode[]>
  > | null,
) {
  const requests: string[] = [];
  const nodes = Object.values(byHead ?? {}).flat();
  const azureDevOps: AzureDevOpsClient = {
    version: Effect.succeed("azure-cli 2.78.0"),
    account: Effect.succeed("octo@example.com"),
    accessToken:
      byHead === null
        ? Effect.fail({ _tag: "PullRequestsUnavailable" })
        : Effect.succeed("token"),
    get: (url) => {
      requests.push(url);
      const query = new URL(url).searchParams;
      const source = query.get("searchCriteria.sourceRefName");
      const value =
        source === null
          ? (
              nodes.find(
                ({ id }) =>
                  String(id) === query.get("artifactId")?.split("/").at(-1),
              )?.checks ?? []
            ).map((status) => ({
              status,
              configuration: {
                type: { id: "0609b952-1397-4640-95ec-e00a01b2c241" },
              },
            }))
          : (byHead?.[source.slice("refs/heads/".length)] ?? []).map(
              (node) => ({
                pullRequestId: node.id,
                title: `Pull request ${node.id}`,
                status: node.status ?? "active",
                isDraft: node.isDraft ?? false,
                ...(node.fork === true ? { forkSource: {} } : {}),
                repository: { project: { id: "project-id" } },
              }),
            );
      return Effect.succeed(JSON.stringify({ value }));
    },
  };
  return { azureDevOps, requests };
}

interface GitLabMergeRequestNode {
  readonly iid: number;
  readonly state?: "opened" | "closed" | "locked" | "merged";
  readonly draft?: boolean;
  readonly project?: string;
  readonly pipeline?: string;
}

export function fakeGitLab(
  bySourceBranch: Readonly<
    Record<string, readonly GitLabMergeRequestNode[]>
  > | null,
  {
    version = "glab 1.120.0 (78790114c)",
    accounts = { "gitlab.com": "tanuki" },
  }: {
    readonly version?: string | null;
    readonly accounts?: Readonly<Record<string, string>>;
  } = {},
) {
  const requests: Readonly<Record<string, string>>[] = [];
  const statusOf = (host: string) =>
    accounts[host] === undefined
      ? `${host}\n  x ${host}: API call failed: 401 Unauthorized`
      : `${host}\n  ✓ Logged in to ${host} as ${accounts[host]} (/home/tanuki/.config/glab-cli/config.yml)`;
  const gitlab: GitLabCli = {
    version: Effect.succeed(version ?? undefined),
    authStatus: (hostname) =>
      Effect.succeed(
        hostname === undefined
          ? Object.keys(accounts).map(statusOf).join("\n")
          : statusOf(hostname),
      ),
    graphql: (hostname, _query, variables) => {
      requests.push({ hostname, ...variables });
      if (bySourceBranch === null)
        return Effect.fail({ _tag: "PullRequestsUnavailable" });
      const fullPath = variables.fullPath ?? "";
      const project = Object.fromEntries(
        Object.entries(variables)
          .filter(([alias]) => /^b\d+$/.test(alias))
          .map(([alias, sourceBranch]) => [
            alias,
            {
              nodes: (bySourceBranch[sourceBranch] ?? []).map((node) => ({
                iid: String(node.iid),
                webUrl: `https://${hostname}/${fullPath}/-/merge_requests/${node.iid}`,
                title: `Merge request ${node.iid}`,
                state: node.state ?? "opened",
                draft: node.draft ?? false,
                sourceProject: { fullPath: node.project ?? fullPath },
                headPipeline:
                  node.pipeline === undefined
                    ? null
                    : { status: node.pipeline },
              })),
            },
          ]),
      );
      return Effect.succeed(JSON.stringify({ data: { project } }));
    },
  };
  return { gitlab, requests };
}
