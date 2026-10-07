import { IconDeviceLaptop } from "@tabler/icons-react";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import type { OpenProjectEnvironment } from "#web/features/open-project/open-project-model.ts";
import {
  cloneGroups,
  projectItems,
  urlSource,
} from "#web/features/open-project/open-project-state.ts";
import { localEnvironment } from "#web/features/project-navigation/local-environment.ts";
import { useRepositoryCatalog } from "#web/features/repository-catalog/use-repository-catalog.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";

const noHosts = [] as const;
const projectsShownWithoutQuery = 10;

export function useOpenProjectResults(
  query: string,
  showAllProjects: boolean,
  collapsedGroupIds: ReadonlySet<string>,
) {
  const environments = useOpenProjectEnvironments();
  const hosts = useEnvironmentQuery(SourceControlApi.cloneable, undefined, {
    changes: "none",
    refetchOnWindowFocus: false,
  });
  const groups = cloneGroups(hosts.data ?? noHosts, query);
  const pastedUrl = urlSource(query);
  const matchingProjects = projectItems(environments, query);
  const projects =
    showAllProjects || query.trim().length > 0
      ? matchingProjects
      : matchingProjects.slice(0, projectsShownWithoutQuery);
  const keyboardItems = [
    ...(pastedUrl === undefined
      ? []
      : [{ key: pastedUrl.key, source: pastedUrl }]),
    ...projects.filter((item) => !item.disabled),
    ...groups
      .filter(({ id }) => !collapsedGroupIds.has(id))
      .flatMap(({ sources }) =>
        sources.map((source) => ({ key: source.key, source })),
      ),
  ];
  const hasCloneSources = groups.some(({ sources }) => sources.length > 0);

  return {
    environments,
    projects,
    hiddenProjectCount: matchingProjects.length - projects.length,
    groups,
    pastedUrl,
    keyboardItems,
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
