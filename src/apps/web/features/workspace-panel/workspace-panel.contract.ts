export const workspacePanelKinds = ["changes", "code", "pull-request"] as const;

export type WorkspacePanelKind = (typeof workspacePanelKinds)[number];

export const workspacePanelAvailability: Readonly<
  Record<WorkspacePanelKind, boolean>
> = {
  changes: false,
  code: false,
  "pull-request": false,
};

export interface WorkspacePanelState {
  readonly tabs: readonly WorkspacePanelKind[];
  readonly active: WorkspacePanelKind | null;
  readonly open: boolean;
  readonly width: number;
}

export type WorkspacePanelAction =
  | { readonly type: "open"; readonly kind: WorkspacePanelKind }
  | { readonly type: "close"; readonly kind: WorkspacePanelKind }
  | { readonly type: "visibility"; readonly open: boolean }
  | { readonly type: "resize"; readonly width: number };

export interface WorkspacePanelStore {
  readonly getSnapshot: () => WorkspacePanelState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (action: WorkspacePanelAction) => void;
}
