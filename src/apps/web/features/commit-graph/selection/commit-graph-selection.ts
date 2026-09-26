export interface CommitGraphSelection {
  readonly selectedOids: readonly string[];
  readonly activeOid?: string;
  readonly anchorOid?: string;
  readonly activeIndex: number;
}

export type CommitGraphSelectionMode =
  | "replace"
  | "toggle"
  | "range"
  | "activate";

export const emptyCommitGraphSelection: CommitGraphSelection = {
  selectedOids: [],
  activeIndex: 0,
};
