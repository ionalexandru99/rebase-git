import { Effect } from "effect";
import type { GitHubCli } from "#server/features/source-control/hosts/github-host.ts";

interface GitHubPullRequestNode {
  readonly number: number;
  readonly state?: "OPEN" | "CLOSED" | "MERGED";
  readonly isDraft?: boolean;
  readonly owner?: string;
  readonly checks?: string;
  readonly head?: string;
}

interface GitHubRepository {
  readonly name: string;
  readonly private?: boolean;
}

export function fakeGitHub(
  byHead: Readonly<Record<string, readonly GitHubPullRequestNode[]>> | null,
  {
    version = "gh version 2.101.0 (2026-09-15)",
    account = "octo",
    protocol = "https",
    repositories = [],
  }: {
    readonly version?: string | null;
    readonly account?: string | null;
    readonly protocol?: "https" | "ssh";
    readonly repositories?: readonly GitHubRepository[];
  } = {},
) {
  const requests: Readonly<Record<string, string>>[] = [];
  const github: GitHubCli = {
    version: Effect.succeed(version ?? undefined),
    account: Effect.succeed(account ?? undefined),
    protocol: Effect.succeed(protocol),
    repositories: (page) =>
      Effect.succeed(
        JSON.stringify(
          repositories
            .slice((page - 1) * 100, page * 100)
            .map((repository) => ({
              full_name: repository.name,
              private: repository.private ?? false,
              description: null,
              pushed_at: "2026-10-01T10:00:00Z",
              clone_url: `https://github.com/${repository.name}.git`,
              ssh_url: `git@github.com:${repository.name}.git`,
            })),
        ),
      ),
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
                ...(node.head === undefined ? {} : { headRefOid: node.head }),
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
