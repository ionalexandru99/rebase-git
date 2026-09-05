export type CommitGraphToolbarDialog = "fetch" | "cache";

export interface CommitGraphToolbarModel {
  readonly dialog: CommitGraphToolbarDialog | undefined;
  readonly showDialog: (dialog: CommitGraphToolbarDialog) => void;
  readonly closeDialog: () => void;
}
