import type { ReactNode } from "react";
import type { WorkspacePanelTab } from "#web/features/workspace-panel/workspace-panel-model.ts";

export interface WorkspacePanelScope {
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly logicalRepositoryId: string;
  readonly worktreePath: string;
}

export interface WorkspacePanelEnvironment {
  readonly environmentId: string | undefined;
  readonly visible?: boolean;
  readonly connected: boolean;
  readonly writable: boolean;
}

export interface PanelViewState {
  readonly mounted: boolean;
  readonly targets: Partial<Record<WorkspacePanelTab, PanelViewTarget>>;
  readonly contents: Partial<Record<WorkspacePanelTab, ReactNode>>;
}

export interface PanelViewTarget {
  readonly element: HTMLElement;
  readonly beforeDetach: (listener: () => void) => () => void;
  readonly detach: () => void;
}
