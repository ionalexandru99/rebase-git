export interface RepositoryHistorySearchActions {
  readonly open: () => void;
  readonly close: () => void;
  readonly next: () => void;
  readonly previous: () => void;
}

export interface RepositoryHistorySearchBinding {
  readonly shortcut?: string;
  readonly ariaKeyShortcuts?: string;
}

export interface RepositoryHistorySearchBindings {
  readonly open?: RepositoryHistorySearchBinding;
  readonly next?: RepositoryHistorySearchBinding;
  readonly previous?: RepositoryHistorySearchBinding;
}
