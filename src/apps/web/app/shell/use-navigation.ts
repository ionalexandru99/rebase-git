import { useReducer } from "react";
import type {
  OpenRepository,
  ProjectsNavigation,
} from "#web/features/project-navigation/projects-sidebar.tsx";
import type { SettingsSectionId } from "#web/features/settings/settings-sections.ts";

export interface Navigation extends ProjectsNavigation {
  readonly settingsSection: SettingsSectionId | undefined;
  readonly repositorySettingsId: string | undefined;
  readonly openProjectRequest: number;
  readonly worktreePaths: ReadonlyMap<string, string>;
}

export type NavigationAction =
  | { readonly type: "show-open-project" }
  | { readonly type: "open-repository"; readonly repository: OpenRepository }
  | { readonly type: "close-repository"; readonly repositoryId: string }
  | {
      readonly type: "switch-worktree";
      readonly repositoryId: string;
      readonly worktreePath: string;
    }
  | { readonly type: "collapse-sidebar"; readonly collapsed: boolean }
  | {
      readonly type: "show-settings";
      readonly section: SettingsSectionId | undefined;
    }
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

export function reduceNavigation(
  navigation: Navigation,
  action: NavigationAction,
): Navigation {
  switch (action.type) {
    case "show-open-project":
      return {
        ...navigation,
        workspaceView: "open-project",
        repositorySettingsId: undefined,
        openProjectRequest: navigation.openProjectRequest + 1,
      };
    case "open-repository":
      return openRepository(navigation, action.repository);
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
    case "collapse-sidebar":
      return navigation.sidebarCollapsed === action.collapsed
        ? navigation
        : { ...navigation, sidebarCollapsed: action.collapsed };
    case "show-settings":
      return { ...navigation, settingsSection: action.section };
    case "show-repository-settings":
      return { ...navigation, repositorySettingsId: action.repositoryId };
  }
}

function openRepository(
  navigation: Navigation,
  repository: OpenRepository,
): Navigation {
  const alreadyOpen = navigation.openRepositories.some(
    ({ id }) => id === repository.id,
  );
  return {
    ...navigation,
    openRepositories: alreadyOpen
      ? navigation.openRepositories
      : [...navigation.openRepositories, repository],
    selectedRepositoryId: repository.id,
    workspaceView: "repository",
    repositorySettingsId: undefined,
  };
}

function closeRepository(
  navigation: Navigation,
  repositoryId: string,
): Navigation {
  const selectedRepositoryClosed =
    navigation.selectedRepositoryId === repositoryId;
  return {
    ...navigation,
    openRepositories: navigation.openRepositories.filter(
      ({ id }) => id !== repositoryId,
    ),
    selectedRepositoryId: selectedRepositoryClosed
      ? undefined
      : navigation.selectedRepositoryId,
    workspaceView: selectedRepositoryClosed
      ? "open-project"
      : navigation.workspaceView,
    repositorySettingsId:
      navigation.repositorySettingsId === repositoryId
        ? undefined
        : navigation.repositorySettingsId,
  };
}

export function initialNavigation(): Navigation {
  return {
    openRepositories: [],
    selectedRepositoryId: undefined,
    sidebarCollapsed: false,
    workspaceView: "open-project",
    settingsSection: undefined,
    repositorySettingsId: undefined,
    openProjectRequest: 0,
    worktreePaths: new Map(),
  };
}
