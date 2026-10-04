import { Effect, Schema } from "effect";
import { cloneableRepository } from "#server/features/source-control/git-host.ts";
import {
  type AzureDevOpsClient,
  reader,
} from "#server/features/source-control/hosts/azure-devops-client.ts";

const organizationsAtOnce = 4;
const repositoriesListed = 1_000;

export function cloneableRepositories(client: AzureDevOpsClient) {
  return Effect.gen(function* () {
    const account = yield* client.account;
    if (account === undefined) return [];
    const read = reader(client, yield* client.accessToken);
    const { id } = yield* read(profileUrl, decodeProfile);
    const { value: organizations } = yield* read(
      organizationsUrl(id),
      decodeOrganizations,
    );
    const repositories = yield* Effect.forEach(
      organizations,
      ({ accountName }) =>
        read(repositoriesUrl(accountName), decodeRepositories).pipe(
          Effect.map(({ value }) =>
            value
              .filter(({ isDisabled }) => isDisabled !== true)
              .map((repository) =>
                cloneableRepository({
                  name: `${accountName}/${repository.project.name}/${repository.name}`,
                  url: repository.sshUrl ?? repository.remoteUrl,
                  private: repository.project.visibility !== "public",
                  description: null,
                  updatedAt: null,
                }),
              ),
          ),
          Effect.orElseSucceed(() => []),
        ),
      { concurrency: organizationsAtOnce },
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
  }).pipe(Effect.orElseSucceed(() => []));
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

const decodeProfile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String })),
);

const decodeOrganizations = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      value: Schema.Array(Schema.Struct({ accountName: Schema.String })),
    }),
  ),
);

const RepositoryNode = Schema.Struct({
  name: Schema.String,
  remoteUrl: Schema.String,
  sshUrl: Schema.optionalKey(Schema.String),
  isDisabled: Schema.optionalKey(Schema.Boolean),
  project: Schema.Struct({
    name: Schema.String,
    visibility: Schema.optionalKey(Schema.String),
  }),
});

const decodeRepositories = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ value: Schema.Array(RepositoryNode) })),
);
