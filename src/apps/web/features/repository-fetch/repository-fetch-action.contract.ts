export interface RepositoryFetchAction {
  readonly execute: () => void;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}
