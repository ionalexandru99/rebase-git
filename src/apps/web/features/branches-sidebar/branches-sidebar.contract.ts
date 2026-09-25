import type {
  BranchUpstream,
  BranchUpstreamTarget,
  DeleteRepositoryBranch,
  RepositoryBranchDeleted,
  RepositoryRefTarget,
} from "@rebase/contracts";

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

export interface BranchActions {
  readonly create: (branch: {
    readonly checkout: boolean;
    readonly name: string;
    readonly startPoint: string;
    readonly track?: BranchUpstreamTarget;
  }) => Promise<void>;
  readonly delete: (
    deletion: Omit<DeleteRepositoryBranch, "repositoryId" | "worktreePath">,
  ) => Promise<RepositoryBranchDeleted>;
  readonly rename: (branch: {
    readonly expectedTarget?: string;
    readonly name: string;
    readonly newName: string;
  }) => Promise<void>;
  readonly setUpstream: (branch: {
    readonly name: string;
    readonly upstream: BranchUpstreamTarget | null;
  }) => Promise<void>;
}

export interface BranchCreateRequest {
  readonly oid: string;
  readonly sequence: number;
}
