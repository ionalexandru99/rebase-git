import type { IconCode } from "@tabler/icons-react";
import type { ComponentType } from "react";
import type {
  WorkspacePanelInputAction,
  WorkspacePanelOpenAction,
} from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import type { ReadableStore } from "#web/platform/store/store.ts";

export interface WorkspacePanelInstance {
  readonly key: string;
  readonly title: string;
  readonly context: string;
}

export type WorkspacePanelDefinition = {
  readonly acceptsInput?: (input: unknown) => boolean;
  readonly instance?: (input: unknown) => WorkspacePanelInstance | undefined;
  readonly Content: ComponentType;
  readonly label: string;
  readonly icon: typeof IconCode;
} & (
  | { readonly launchable: true; readonly description: string }
  | { readonly launchable: false }
);

export type WorkspacePanelTab = string;

export interface WorkspacePanelState {
  readonly inputs?: Partial<Record<WorkspacePanelTab, unknown>>;
  readonly tabs: readonly WorkspacePanelTab[];
  readonly active: WorkspacePanelTab | null;
  readonly open: boolean;
  readonly width: number;
  readonly expanded?: boolean;
}

export type WorkspacePanelAction =
  | WorkspacePanelInputAction
  | WorkspacePanelOpenAction
  | { readonly type: "select"; readonly tab: WorkspacePanelTab }
  | { readonly type: "close"; readonly tab: WorkspacePanelTab }
  | { readonly type: "visibility"; readonly open: boolean }
  | { readonly type: "resize"; readonly width: number }
  | { readonly type: "expand"; readonly expanded: boolean };

export interface WorkspacePanelStore
  extends ReadableStore<WorkspacePanelState> {
  readonly dispatch: (action: WorkspacePanelAction) => void;
}
