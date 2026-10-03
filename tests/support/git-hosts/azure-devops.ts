import { Effect } from "effect";
import type { AzureDevOpsClient } from "#server/features/source-control/hosts/azure-devops-host.ts";

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
