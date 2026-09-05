export const repositorySelectionPositions = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
] as const;

export type RepositorySelectionPosition =
  (typeof repositorySelectionPositions)[number];

export const keyboardShortcutCommandIds = [
  "projects.showOpenProject",
  "projects.browseRepository",
  "projects.closeActiveRepository",
  "projects.toggleSidebar",
  "projects.focusFilter",
  "projects.selectPreviousRepository",
  "projects.selectNextRepository",
  "projects.selectRepository1",
  "projects.selectRepository2",
  "projects.selectRepository3",
  "projects.selectRepository4",
  "projects.selectRepository5",
  "projects.selectRepository6",
  "projects.selectRepository7",
  "projects.selectRepository8",
  "projects.selectRepository9",
  "branches.focusSidebar",
  "graph.focus",
  "graph.search",
  "graph.previousMatch",
  "graph.nextMatch",
  "graph.previousInLane",
  "graph.nextInLane",
  "graph.fetch",
  "settings.open",
  "repository.openSettings",
  "search.focus",
  "repositoryPicker.openSelectedRepository",
] as const;

export type KeyboardShortcutCommandId =
  (typeof keyboardShortcutCommandIds)[number];

export type KeyboardShortcutContext =
  | "application"
  | "repository-picker"
  | "commit-graph";

export type KeyboardShortcutGroup =
  | "Navigation"
  | "Branches"
  | "Commit graph"
  | "Search and lists"
  | "Folder picker";

export type KeyboardShortcutModifier =
  | "Mod"
  | "Control"
  | "Meta"
  | "Alt"
  | "Shift";

export interface KeyboardShortcutBinding {
  readonly key: string;
  readonly modifiers: readonly KeyboardShortcutModifier[];
}

export type KeyboardShortcutBindings = Readonly<
  Record<KeyboardShortcutCommandId, KeyboardShortcutBinding | null>
>;

export interface KeyboardShortcutCommand {
  readonly contexts: readonly KeyboardShortcutContext[];
  readonly defaultBinding: KeyboardShortcutBinding;
  readonly group: KeyboardShortcutGroup;
  readonly id: KeyboardShortcutCommandId;
  readonly label: string;
}

export type KeyboardShortcutPlatform = "mac" | "other";

export type KeyboardShortcutClient = "browser" | "desktop";

export interface KeyboardShortcutInput {
  readonly code?: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export interface KeyboardShortcutSnapshot {
  readonly bindings: KeyboardShortcutBindings;
  readonly modifiedCommandIds: readonly KeyboardShortcutCommandId[];
}

export interface KeyboardShortcutHost {
  readonly client: KeyboardShortcutClient;
  readonly platform: KeyboardShortcutPlatform;
}

export interface KeyboardShortcutStorage {
  readonly getItem: (key: string) => string | null;
  readonly removeItem: (key: string) => unknown;
  readonly setItem: (key: string, value: string) => unknown;
}

export interface KeyboardShortcutStore {
  readonly getSnapshot: () => KeyboardShortcutSnapshot;
  readonly resetAll: () => void;
  readonly resetBinding: (commandId: KeyboardShortcutCommandId) => void;
  readonly setBinding: (
    commandId: KeyboardShortcutCommandId,
    binding: KeyboardShortcutBinding | null,
    replacedCommandId?: KeyboardShortcutCommandId,
  ) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface KeyboardShortcutRuntime {
  readonly host: KeyboardShortcutHost;
  readonly store: KeyboardShortcutStore;
}
