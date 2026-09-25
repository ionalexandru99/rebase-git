import type { BranchUpstream, RepositoryRefTarget } from "@rebase/contracts";

export const localBranchesSectionId = "branches";
export const tagsSectionId = "tags";

export type BranchesSidebarScope = "all" | "local" | "remote" | "tags";
export type BranchesSidebarView = "linear" | "tree";

export interface BranchesSidebarTreeOptions {
  readonly view: BranchesSidebarView;
  readonly folders: ReadonlyMap<string, boolean>;
}

interface RowHierarchy {
  readonly level: number;
  readonly position: number;
  readonly setSize: number;
}

export interface BranchesSidebarSectionRow extends RowHierarchy {
  readonly expanded: boolean;
  readonly id: string;
  readonly kind: "section";
  readonly sectionId: string;
  readonly title: string;
  readonly truncated: boolean;
  readonly separator: boolean;
}

export interface BranchesSidebarFolderRow extends RowHierarchy {
  readonly kind: "folder";
  readonly id: string;
  readonly sectionId: string;
  readonly parentId: string;
  readonly path: string;
  readonly label: string;
  readonly expanded: boolean;
}

export interface BranchesSidebarRefRow extends RowHierarchy {
  readonly current: boolean;
  readonly id: string;
  readonly kind: "ref";
  readonly name: string;
  readonly label: string;
  readonly parentId: string;
  readonly sectionId: string;
  readonly target: RepositoryRefTarget;
  readonly upstream?: BranchUpstream;
  readonly checkout?: {
    readonly kind: "repository" | "worktree";
    readonly path: string;
  };
}

export type BranchesSidebarRow =
  | BranchesSidebarRefRow
  | BranchesSidebarFolderRow
  | BranchesSidebarSectionRow;
