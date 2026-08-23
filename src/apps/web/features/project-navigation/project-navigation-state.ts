import type {
  EnvironmentAvailability,
  ProjectNavigationEnvironment,
  ProjectNavigationRepositoryItem,
  ProjectNavigationState,
} from "#web/features/project-navigation/project-navigation.contract";

export function environmentRepositories(
  environment: ProjectNavigationEnvironment,
): readonly ProjectNavigationRepositoryItem[] {
  const disabled = environment.availability !== "available";
  return environment.repositories.map((repository) => ({
    ...repository,
    disabled,
  }));
}

export function filterEnvironmentRepositories(
  environment: ProjectNavigationEnvironment,
  query: string,
): readonly ProjectNavigationRepositoryItem[] {
  const repositories = environmentRepositories(environment);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return normalizedQuery.length === 0
    ? repositories
    : repositories.filter((repository) =>
        repository.name.toLocaleLowerCase().includes(normalizedQuery),
      );
}

export function setEnvironmentAvailability(
  state: ProjectNavigationState,
  environmentId: string,
  availability: EnvironmentAvailability,
): ProjectNavigationState {
  return updateEnvironment(state, environmentId, (environment) => ({
    ...environment,
    availability,
  }));
}

export function toggleEnvironment(
  state: ProjectNavigationState,
  environmentId: string,
): ProjectNavigationState {
  return updateEnvironment(state, environmentId, (environment) => ({
    ...environment,
    expanded: !environment.expanded,
  }));
}

export function setProjectSidebarCollapsed(
  state: ProjectNavigationState,
  sidebarCollapsed: boolean,
): ProjectNavigationState {
  return { ...state, sidebarCollapsed };
}

function updateEnvironment(
  state: ProjectNavigationState,
  environmentId: string,
  update: (
    environment: ProjectNavigationEnvironment,
  ) => ProjectNavigationEnvironment,
): ProjectNavigationState {
  return {
    ...state,
    environments: state.environments.map((environment) =>
      environment.id === environmentId ? update(environment) : environment,
    ),
  };
}
