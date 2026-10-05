import { Effect } from "effect";
import type { AzureDevOpsClient } from "#server/features/source-control/hosts/azure-devops-client.ts";

interface AzureDevOpsPullRequestNode {
  readonly id: number;
  readonly status?: "active" | "completed" | "abandoned";
  readonly isDraft?: boolean;
  readonly fork?: boolean;
  readonly checks?: readonly string[];
}

interface AzureDevOpsRepository {
  readonly project: string;
  readonly name: string;
  readonly public?: boolean;
  readonly disabled?: boolean;
  readonly ssh?: boolean;
}

export function fakeAzureDevOps(
  byHead: Readonly<
    Record<string, readonly AzureDevOpsPullRequestNode[]>
  > | null,
  {
    organizations = {},
  }: {
    readonly organizations?: Readonly<
      Record<string, readonly AzureDevOpsRepository[]>
    >;
  } = {},
) {
  const requests: string[] = [];
  const nodes = Object.values(byHead ?? {}).flat();
  const listing = (url: URL): unknown => {
    if (url.pathname === "/_apis/profile/profiles/me")
      return { id: "member-id", displayName: "Octo" };
    if (url.pathname === "/_apis/accounts")
      return listOf(
        Object.keys(organizations).map((accountName) => ({
          accountId: `${accountName}-id`,
          accountUri: `https://vssps.dev.azure.com/${accountName}/`,
          accountName,
        })),
      );
    const organization = /^\/([^/]+)\/_apis\/git\/repositories$/.exec(
      url.pathname,
    )?.[1];
    const repositories =
      organization === undefined ? undefined : organizations[organization];
    return (
      repositories &&
      listOf(
        repositories.map((repository) =>
          azureRepository(organization ?? "", repository),
        ),
      )
    );
  };
  const azureDevOps: AzureDevOpsClient = {
    version: Effect.succeed("azure-cli 2.78.0"),
    account: Effect.succeed("octo@example.com"),
    accessToken:
      byHead === null
        ? Effect.fail({ _tag: "PullRequestsUnavailable" })
        : Effect.succeed("token"),
    get: (url) => {
      requests.push(url);
      const listed = listing(new URL(url));
      if (listed !== undefined) return Effect.succeed(JSON.stringify(listed));
      const asNode = (node: AzureDevOpsPullRequestNode) => ({
        pullRequestId: node.id,
        title: `Pull request ${node.id}`,
        status: node.status ?? "active",
        isDraft: node.isDraft ?? false,
        ...(node.fork === true ? { forkSource: {} } : {}),
        repository: {
          name: decodeURIComponent(
            /\/_apis\/git\/repositories\/([^/]+)\//.exec(
              new URL(url).pathname,
            )?.[1] ?? "",
          ),
          project: { id: "project-id" },
        },
      });
      const wanted = /\/pullrequests\/(\d+)$/.exec(new URL(url).pathname)?.[1];
      if (wanted !== undefined) {
        const node = nodes.find(({ id }) => String(id) === wanted);
        return node === undefined
          ? Effect.fail({ _tag: "PullRequestsUnavailable" })
          : Effect.succeed(JSON.stringify(asNode(node)));
      }
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
          : (byHead?.[source.slice("refs/heads/".length)] ?? []).map(asNode);
      return Effect.succeed(JSON.stringify({ value }));
    },
  };
  return { azureDevOps, requests };
}

function listOf(value: readonly unknown[]) {
  return { count: value.length, value };
}

function azureRepository(
  organization: string,
  repository: AzureDevOpsRepository,
) {
  const project = encodeURIComponent(repository.project);
  const name = encodeURIComponent(repository.name);
  return {
    id: `${repository.name}-id`,
    name: repository.name,
    project: {
      id: `${repository.project}-id`,
      name: repository.project,
      state: "wellFormed",
      visibility: repository.public === true ? "public" : "private",
    },
    remoteUrl: `https://${organization}@dev.azure.com/${organization}/${project}/_git/${name}`,
    ...(repository.ssh === false
      ? {}
      : {
          sshUrl: `git@ssh.dev.azure.com:v3/${organization}/${project}/${name}`,
        }),
    isDisabled: repository.disabled ?? false,
  };
}
