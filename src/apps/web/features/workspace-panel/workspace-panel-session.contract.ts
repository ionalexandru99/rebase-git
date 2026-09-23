import type { EnvironmentRequestClient } from "@rebase/environment-client";
import type { ManagedRuntime } from "effect";
import type { ReactNode } from "react";
import type { WorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel.contract";
import type { EnvironmentChanges } from "#web/platform/environment/environment-protocol.contract";

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
  readonly changes?: EnvironmentChanges | undefined;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
  readonly connected: boolean;
  readonly writable: boolean;
  readonly invalidate: (repositoryId: string) => void;
}

export interface PanelViewState {
  readonly mounted: boolean;
  readonly targets: Partial<Record<WorkspacePanelKind, PanelViewTarget>>;
  readonly contents: Partial<Record<WorkspacePanelKind, ReactNode>>;
}

export interface PanelViewTarget {
  readonly element: HTMLElement;
  readonly beforeDetach: (listener: () => void) => () => void;
  readonly detach: () => void;
}
