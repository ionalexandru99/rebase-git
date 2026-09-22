import type { EnvironmentRequestClient } from "@rebase/environment-client";
import type { ReactNode } from "react";
import type { WorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel.contract";

export interface WorkspacePanelScope {
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly logicalRepositoryId: string;
  readonly worktreePath: string;
}

export interface WorkspacePanelEnvironment {
  readonly environmentId: string | undefined;
  readonly visible?: boolean;
  readonly requests?: EnvironmentRequestClient | undefined;
  readonly connected: boolean;
  readonly writable: boolean;
  readonly invalidate: (repositoryId: string) => void;
}

export interface PanelViewState {
  readonly mounted: boolean;
  readonly targets: Partial<Record<WorkspacePanelKind, HTMLElement>>;
  readonly contents: Partial<Record<WorkspacePanelKind, ReactNode>>;
}
