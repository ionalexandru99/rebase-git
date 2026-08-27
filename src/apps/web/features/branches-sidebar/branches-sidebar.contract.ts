import type { BranchUpstream, RepositoryRefTarget } from "@rebase/contracts";

export const localBranchesSectionId = "branches";
export const tagsSectionId = "tags";

export function remoteSectionId(remote: string): string {
  return `remote:${remote}`;
}

export interface BranchesSidebarSectionRow {
  readonly count: number;
  readonly expanded: boolean;
  readonly id: string;
  readonly kind: "section";
  readonly sectionId: string;
  readonly title: string;
  readonly truncated: boolean;
}

export interface BranchesSidebarRefRow {
  readonly current: boolean;
  readonly id: string;
  readonly kind: "ref";
  readonly name: string;
  readonly sectionId: string;
  readonly target: RepositoryRefTarget;
  readonly upstream?: BranchUpstream;
  readonly worktreePath?: string;
}

export type BranchesSidebarRow =
  | BranchesSidebarRefRow
  | BranchesSidebarSectionRow;

export type RefSelection =
  | { readonly _tag: "AlreadyCurrent" }
  | { readonly _tag: "Checkout"; readonly target: RepositoryRefTarget }
  | { readonly _tag: "SwitchWorktree"; readonly worktreePath: string };
