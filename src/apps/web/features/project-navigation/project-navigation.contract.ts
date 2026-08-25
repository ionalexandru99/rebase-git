export type EnvironmentAvailability =
  | "available"
  | "connecting"
  | "unavailable";

export interface ProjectNavigationRepository {
  readonly id: string;
  readonly name: string;
}

export interface ProjectNavigationEnvironment {
  readonly availability: EnvironmentAvailability;
  readonly expanded: boolean;
  readonly id: string;
  readonly name: string;
  readonly repositories: readonly ProjectNavigationRepository[];
}

export interface ProjectNavigationState {
  readonly environments: readonly ProjectNavigationEnvironment[];
  readonly selectedRepositoryId: string | undefined;
  readonly sidebarCollapsed: boolean;
  readonly workspaceView: ProjectWorkspaceView;
}

export type ProjectWorkspaceView = "open-project" | "repository";

export interface ProjectNavigationRepositoryItem
  extends ProjectNavigationRepository {
  readonly disabled: boolean;
}
