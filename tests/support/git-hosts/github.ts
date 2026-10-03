import { Effect } from "effect";
import type { GitHubCli } from "#server/features/source-control/hosts/github-host.ts";

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
