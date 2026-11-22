import { z } from "zod";
import {
  cloneableRepository,
  mapConcurrently,
} from "#server/features/source-control/git-host.ts";
import {
  type AzureDevOpsClient,
  reader,
} from "#server/features/source-control/hosts/azure-devops-client.ts";

const organizationsAtOnce = 4;
const repositoriesListed = 1_000;

export async function cloneableRepositories(client: AzureDevOpsClient) {
  try {
    const account = await client.account();
    if (account === undefined) return [];
    const read = reader(client, await client.accessToken());
    const { id } = await read(profileUrl, Profile);
    const { value: organizations } = await read(
      organizationsUrl(id),
      Organizations,
    );
    const repositories = await mapConcurrently(
      organizations,
      organizationsAtOnce,
      async ({ accountName }) => {
        try {
          const { value } = await read(
            repositoriesUrl(accountName),
            Repositories,
          );
          return value
            .filter(({ isDisabled }) => isDisabled !== true)
            .map((repository) =>
              cloneableRepository({
                name: `${accountName}/${repository.project.name}/${repository.name}`,
                url: repository.sshUrl ?? repository.remoteUrl,
                private: repository.project.visibility !== "public",
                description: null,
                updatedAt: null,
              }),
            );
        } catch {
          return [];
        }
      },
    );
    return [
      {
        kind: "azure-devops" as const,
        host: "dev.azure.com",
        account,
        repositories: repositories
          .flat()
          .sort((left, right) => left.name.localeCompare(right.name))
          .slice(0, repositoriesListed),
      },
    ];
  } catch {
    return [];
  }
}

const profileUrl =
  "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1";

function organizationsUrl(memberId: string) {
  return `https://app.vssps.visualstudio.com/_apis/accounts?${new URLSearchParams(
    { memberId, "api-version": "7.1" },
  )}`;
}

function repositoriesUrl(organization: string) {
  return `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/repositories?api-version=7.1`;
}

const Profile = z.object({ id: z.string() });

const Organizations = z.object({
  value: z.array(z.object({ accountName: z.string() })),
});

const Repositories = z.object({
  value: z.array(
    z.object({
      name: z.string(),
      remoteUrl: z.string(),
      sshUrl: z.string().optional(),
      isDisabled: z.boolean().optional(),
      project: z.object({
        name: z.string(),
        visibility: z.string().optional(),
      }),
    }),
  ),
});
