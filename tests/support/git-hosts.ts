import { Effect } from "effect";
import type { AzureDevOpsClient } from "#server/features/source-control/azure-devops-host.ts";
import type { GitHubCli } from "#server/features/source-control/github-host.ts";

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
