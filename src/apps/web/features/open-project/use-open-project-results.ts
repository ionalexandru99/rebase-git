import { IconDeviceLaptop } from "@tabler/icons-react";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import type { OpenProjectEnvironment } from "#web/features/open-project/open-project-model.ts";
import {
  catalogRepositoryItems,
  cloneGroups,
  filterOpenProjectEnvironments,
  keyboardRepositoryItems,
  recentRepositoryItems,
  urlSource,
} from "#web/features/open-project/open-project-state.ts";
import { localEnvironment } from "#web/features/project-navigation/local-environment.ts";
import { useRepositoryCatalog } from "#web/features/repository-catalog/use-repository-catalog.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";

const noHosts = [] as const;

export function useOpenProjectResults(
  query: string,
  expandedEnvironmentIds: ReadonlySet<string>,
  collapsedGroupIds: ReadonlySet<string>,
) {
  const environments = useOpenProjectEnvironments();
  const hosts = useEnvironmentQuery(SourceControlApi.cloneable, undefined, {
    changes: "none",
    refetchOnWindowFocus: false,
  });
  const groups = cloneGroups(hosts.data ?? noHosts, query);
  const pastedUrl = urlSource(query);
  const filteredEnvironments = filterOpenProjectEnvironments(
    environments,
    query,
  );
  const recentItems = recentRepositoryItems(filteredEnvironments);
  const catalogItems = catalogRepositoryItems(
    filteredEnvironments,
    expandedEnvironmentIds,
  );
  const keyboardItems = [
    ...(pastedUrl === undefined
      ? []
      : [{ key: pastedUrl.key, source: pastedUrl }]),
    ...keyboardRepositoryItems(recentItems, catalogItems),
    ...groups
      .filter(({ id }) => !collapsedGroupIds.has(id))
      .flatMap(({ sources }) =>
        sources.map((source) => ({ key: source.key, source })),
      ),
  ];
  const hasRepositories = environments.some(
    (environment) => environment.repositories.length > 0,
  );
  const hasMatches = filteredEnvironments.some(
    (environment) => environment.repositories.length > 0,
  );
  const hasCloneSources =
    pastedUrl !== undefined || groups.some(({ sources }) => sources.length > 0);

  return {
    environments,
    filteredEnvironments,
    recentItems,
    groups,
    pastedUrl,
    keyboardItems,
    hasRepositories,
    hasMatches,
    hasCloneSources,
  };
}

function useOpenProjectEnvironments(): readonly OpenProjectEnvironment[] {
  const { repositories } = useRepositoryCatalog();
  const { availability, connectionState, status } = useEnvironment().status;
  return connectionState === "PairingRequired"
    ? []
    : [
        {
          availability,
          icon: IconDeviceLaptop,
          iconColor: "var(--primary)",
          id: localEnvironment.id,
          name: localEnvironment.name,
          repositories: repositories.map((repository) => ({
            color: repository.color,
            environmentId: localEnvironment.id,
            id: repository.id,
            lastOpenedAt: repository.lastOpenedAt,
            name: repository.name,
            path: repository.path,
          })),
          status,
        },
      ];
}
