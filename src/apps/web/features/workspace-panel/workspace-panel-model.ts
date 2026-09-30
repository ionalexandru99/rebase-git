import type { IconCode } from "@tabler/icons-react";
import type { ComponentType } from "react";
import type {
  WorkspacePanelInputAction,
  WorkspacePanelKind,
} from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import type { ReadableStore } from "#web/platform/store/store.ts";

export type WorkspacePanelDefinition = {
  readonly acceptsInput?: (input: unknown) => boolean;
  readonly Content: ComponentType;
  readonly label: string;
  readonly icon: typeof IconCode;
} & (
  | { readonly launchable: true; readonly description: string }
  | { readonly launchable: false }
);

export interface WorkspacePanelState {
  readonly inputs?: Partial<Record<WorkspacePanelKind, unknown>>;
  readonly tabs: readonly WorkspacePanelKind[];
  readonly active: WorkspacePanelKind | null;
  readonly open: boolean;
  readonly width: number;
  readonly expanded?: boolean;
}

export type WorkspacePanelAction =
  | WorkspacePanelInputAction
  | { readonly type: "open"; readonly kind: WorkspacePanelKind }
  | { readonly type: "close"; readonly kind: WorkspacePanelKind }
  | { readonly type: "visibility"; readonly open: boolean }
  | { readonly type: "resize"; readonly width: number }
  | { readonly type: "expand"; readonly expanded: boolean };

export interface WorkspacePanelStore
  extends ReadableStore<WorkspacePanelState> {
  readonly dispatch: (action: WorkspacePanelAction) => void;
}
