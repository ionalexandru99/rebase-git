import type { RepositoryRefTarget } from "@rebase/contracts";

export type RepositoryRefActivation =
  | { readonly _tag: "AlreadyCurrent" }
  | { readonly _tag: "Checkout"; readonly target: RepositoryRefTarget }
  | { readonly _tag: "SwitchWorktree"; readonly worktreePath: string };
