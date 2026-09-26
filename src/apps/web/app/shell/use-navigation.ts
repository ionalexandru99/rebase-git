import { useReducer } from "react";
import { localEnvironment } from "#web/features/project-navigation/local-environment";
import type {
  ProjectNavigationRepository,
  ProjectNavigationState,
} from "#web/features/project-navigation/project-navigation.contract";
import {
  openProjectRepository,
  removeProjectRepository,
  setEnvironmentAvailability,
  setProjectSidebarCollapsed,
  showOpenProject,
  toggleEnvironment,
} from "#web/features/project-navigation/project-navigation-state";
import type { EnvironmentStatus } from "#web/platform/query/environment-context";

export interface Navigation {
  readonly projects: ProjectNavigationState;
  readonly settingsOpen: boolean;
  readonly repositorySettingsId: string | undefined;
  readonly openProjectRequest: number;
  readonly worktreePaths: ReadonlyMap<string, string>;
}

export type NavigationAction =
  | { readonly type: "show-open-project" }
  | {
      readonly type: "open-repository";
      readonly repository: ProjectNavigationRepository;
    }
  | { readonly type: "close-repository"; readonly repositoryId: string }
  | {
      readonly type: "switch-worktree";
      readonly repositoryId: string;
      readonly worktreePath: string;
    }
  | { readonly type: "toggle-environment"; readonly environmentId: string }
  | { readonly type: "collapse-sidebar"; readonly collapsed: boolean }
  | { readonly type: "show-settings"; readonly open: boolean }
  | {
      readonly type: "show-repository-settings";
      readonly repositoryId: string | undefined;
    };

export type Navigate = (action: NavigationAction) => void;

export function useNavigation() {
  const [navigation, navigate] = useReducer(
    reduceNavigation,
    undefined,
    initialNavigation,
  );
  return { navigation, navigate };
}

export function worktreePathFor(
  worktreePaths: Navigation["worktreePaths"],
  repository: { readonly id: string; readonly path: string },
) {
  return worktreePaths.get(repository.id) ?? repository.path;
}

export function visibleProjects(
  projects: ProjectNavigationState,
  status: EnvironmentStatus,
): ProjectNavigationState {
  return status.connectionState === "PairingRequired"
    ? { ...projects, environments: [] }
    : setEnvironmentAvailability(
        projects,
        localEnvironment.id,
        status.availability,
      );
}

export function reduceNavigation(
  navigation: Navigation,
  action: NavigationAction,
): Navigation {
  switch (action.type) {
    case "show-open-project":
      return {
        ...navigation,
        projects: showOpenProject(navigation.projects),
        repositorySettingsId: undefined,
        openProjectRequest: navigation.openProjectRequest + 1,
      };
    case "open-repository":
      return {
        ...navigation,
        projects: openRepository(navigation.projects, action.repository),
        repositorySettingsId: undefined,
      };
    case "close-repository":
      return closeRepository(navigation, action.repositoryId);
    case "switch-worktree":
      return {
        ...navigation,
        worktreePaths: new Map(navigation.worktreePaths).set(
          action.repositoryId,
          action.worktreePath,
        ),
      };
    case "toggle-environment":
      return {
        ...navigation,
        projects: toggleEnvironment(navigation.projects, action.environmentId),
      };
    case "collapse-sidebar":
      return navigation.projects.sidebarCollapsed === action.collapsed
        ? navigation
        : {
            ...navigation,
            projects: setProjectSidebarCollapsed(
              navigation.projects,
              action.collapsed,
            ),
          };
    case "show-settings":
      return { ...navigation, settingsOpen: action.open };
    case "show-repository-settings":
      return { ...navigation, repositorySettingsId: action.repositoryId };
  }
}

function openRepository(
  projects: ProjectNavigationState,
  repository: ProjectNavigationRepository,
) {
  return openProjectRepository(
    setEnvironmentAvailability(projects, localEnvironment.id, "available"),
    localEnvironment.id,
    repository,
  );
}

function closeRepository(
  navigation: Navigation,
  repositoryId: string,
): Navigation {
  return {
    ...navigation,
    projects: removeProjectRepository(
      navigation.projects,
      localEnvironment.id,
      repositoryId,
    ),
    repositorySettingsId:
      navigation.repositorySettingsId === repositoryId
        ? undefined
        : navigation.repositorySettingsId,
  };
}

export function initialNavigation(): Navigation {
  return {
    projects: {
      environments: [
        {
          availability: "connecting",
          expanded: true,
          id: localEnvironment.id,
          name: localEnvironment.name,
          repositories: [],
        },
      ],
      selectedRepositoryId: undefined,
      sidebarCollapsed: false,
      workspaceView: "open-project",
    },
    settingsOpen: false,
    repositorySettingsId: undefined,
    openProjectRequest: 0,
    worktreePaths: new Map(),
  };
}
