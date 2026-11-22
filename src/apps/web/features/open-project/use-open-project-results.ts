import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import {
  cloneGroups,
  projectItems,
  urlSource,
} from "#web/features/open-project/open-project-state.ts";
import { useRepositoryCatalog } from "#web/features/repository-catalog/use-repository-catalog.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";

const noHosts = [] as const;
const noProjects = [] as const;
const projectsShownWithoutQuery = 10;

export function useOpenProjectResults(
  query: string,
  showAllProjects: boolean,
  collapsedGroupIds: ReadonlySet<string>,
) {
  const { repositories } = useRepositoryCatalog();
  const { availability, connectionState } = useEnvironment().status;
  const hosts = useEnvironmentQuery(SourceControlApi.cloneable, undefined, {
    changes: "none",
    refetchOnWindowFocus: false,
  });
  const groups = cloneGroups(hosts.data ?? noHosts, query);
  const pastedUrl = urlSource(query);
  const matchingProjects =
    connectionState === "PairingRequired"
      ? noProjects
      : projectItems(repositories, query);
  const projects =
    showAllProjects || query.trim().length > 0
      ? matchingProjects
      : matchingProjects.slice(0, projectsShownWithoutQuery);
  const keyboardItems = [
    ...(pastedUrl === undefined
      ? []
      : [{ key: pastedUrl.key, source: pastedUrl }]),
    ...(availability === "available" ? projects : []),
    ...groups
      .filter(({ id }) => !collapsedGroupIds.has(id))
      .flatMap(({ sources }) =>
        sources.map((source) => ({ key: source.key, source })),
      ),
  ];
  const hasCloneSources = groups.some(({ sources }) => sources.length > 0);

  return {
    projects,
    hiddenProjectCount: matchingProjects.length - projects.length,
    groups,
    pastedUrl,
    keyboardItems,
    hasCloneSources,
  };
}
