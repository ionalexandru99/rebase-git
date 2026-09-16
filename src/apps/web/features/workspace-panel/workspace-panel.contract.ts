import type { IconCode } from "@tabler/icons-react";
import type { WorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel-definitions";

export type { WorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel-definitions";

export interface WorkspacePanelDefinition {
  readonly label: string;
  readonly icon: typeof IconCode;
  readonly available: boolean;
  readonly lifetime: "persistent" | "selection";
  readonly description: string;
}

export interface WorkspacePanelState {
  readonly tabs: readonly WorkspacePanelKind[];
  readonly active: WorkspacePanelKind | null;
  readonly open: boolean;
  readonly width: number;
  readonly expanded?: boolean;
  readonly returnTo?: {
    readonly kind: WorkspacePanelKind;
    readonly active: WorkspacePanelKind | null;
    readonly open: boolean;
    readonly expanded: boolean;
  };
}

export type WorkspacePanelAction =
  | { readonly type: "open"; readonly kind: WorkspacePanelKind }
  | { readonly type: "close"; readonly kind: WorkspacePanelKind }
  | { readonly type: "visibility"; readonly open: boolean }
  | { readonly type: "resize"; readonly width: number }
  | { readonly type: "expand"; readonly expanded: boolean };

export interface WorkspacePanelStore {
  readonly getSnapshot: () => WorkspacePanelState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (action: WorkspacePanelAction) => void;
}
