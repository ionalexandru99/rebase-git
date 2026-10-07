import type { RepositoryColor } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type { EnvironmentAvailability } from "#web/platform/query/environment-context.tsx";

export interface ProjectNavigationRepository {
  readonly color: RepositoryColor;
  readonly id: string;
  readonly name: string;
}

export interface ProjectNavigationEnvironment {
  readonly availability: EnvironmentAvailability;
  readonly id: string;
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
