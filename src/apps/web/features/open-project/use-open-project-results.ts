import { IconDeviceLaptop } from "@tabler/icons-react";
import { useMemo } from "react";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import type { OpenProjectEnvironment } from "#web/features/open-project/open-project-model.ts";
import {
  catalogRepositoryItems,
  cloneGroups,
  filterOpenProjectEnvironments,
  keyboardRepositoryItems,
  type OpenProjectKeyboardItem,
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
  const groups = useMemo(
    () => cloneGroups(hosts.data ?? noHosts, query),
    [hosts.data, query],
  );
  const pastedUrl = useMemo(() => urlSource(query), [query]);
  const filteredEnvironments = useMemo(
    () => filterOpenProjectEnvironments(environments, query),
    [environments, query],
  );
  const recentItems = useMemo(
    () => recentRepositoryItems(filteredEnvironments),
    [filteredEnvironments],
  );
  const catalogItems = useMemo(
    () => catalogRepositoryItems(filteredEnvironments, expandedEnvironmentIds),
    [expandedEnvironmentIds, filteredEnvironments],
  );
  const keyboardItems = useMemo(
    (): readonly OpenProjectKeyboardItem[] => [
      ...(pastedUrl === undefined
        ? []
        : [{ key: pastedUrl.key, source: pastedUrl }]),
      ...keyboardRepositoryItems(recentItems, catalogItems),
      ...groups
        .filter(({ id }) => !collapsedGroupIds.has(id))
        .flatMap(({ sources }) =>
          sources.map((source) => ({ key: source.key, source })),
        ),
    ],
    [catalogItems, collapsedGroupIds, groups, pastedUrl, recentItems],
  );
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
  return useMemo(
    () =>
      connectionState === "PairingRequired"
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
          ],
    [availability, connectionState, repositories, status],
  );
}
