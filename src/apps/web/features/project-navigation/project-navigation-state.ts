import type {
  EnvironmentAvailability,
  ProjectNavigationEnvironment,
  ProjectNavigationRepository,
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

export function showOpenProject(
  state: ProjectNavigationState,
): ProjectNavigationState {
  return state.workspaceView === "open-project"
    ? state
    : { ...state, workspaceView: "open-project" };
}

export function openProjectRepository(
  state: ProjectNavigationState,
  environmentId: string,
  repository: ProjectNavigationRepository,
): ProjectNavigationState {
  const environment = state.environments.find(
    (environment) => environment.id === environmentId,
  );
  if (environment?.availability !== "available") return state;

  return {
    ...state,
    environments: state.environments.map((environment) =>
      environment.id === environmentId
        ? addRepositoryOnce(environment, repository)
        : environment,
    ),
    selectedRepositoryId: repository.id,
    workspaceView: "repository",
  };
}

export function removeProjectRepository(
  state: ProjectNavigationState,
  environmentId: string,
  repositoryId: string,
): ProjectNavigationState {
  const environment = state.environments.find(
    (current) => current.id === environmentId,
  );
  if (
    environment === undefined ||
    !environment.repositories.some(
      (repository) => repository.id === repositoryId,
    )
  ) {
    return state;
  }

  const selectedRepositoryRemoved = state.selectedRepositoryId === repositoryId;
  return {
    ...state,
    environments: state.environments.map((current) =>
      current.id === environmentId
        ? {
            ...current,
            repositories: current.repositories.filter(
              (repository) => repository.id !== repositoryId,
            ),
          }
        : current,
    ),
    selectedRepositoryId: selectedRepositoryRemoved
      ? undefined
      : state.selectedRepositoryId,
    workspaceView: selectedRepositoryRemoved
      ? "open-project"
      : state.workspaceView,
  };
}

function addRepositoryOnce(
  environment: ProjectNavigationEnvironment,
  repository: ProjectNavigationRepository,
): ProjectNavigationEnvironment {
  return environment.repositories.some(
    (current) => current.id === repository.id,
  )
    ? environment
    : {
        ...environment,
        repositories: [...environment.repositories, repository],
      };
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
