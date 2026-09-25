import type { MutateChanges } from "@rebase/contracts";
import type { RepositoryWritePolicy } from "#server/domain/repository-coordination.contract";

export const changesWritePolicies = {
  stage: {
    name: "stage",
    locks: { worktree: "wait" },
    duringOperation: { allowWhen: (operation) => operation.kind !== "unknown" },
  },
  unstage: {
    name: "unstage",
    locks: { worktree: "wait" },
    duringOperation: { allowWhen: (operation) => operation.kind !== "unknown" },
  },
  discard: {
    name: "discard",
    locks: { worktree: "wait" },
    duringOperation: "block",
  },
  commit: {
    name: "commit",
    locks: { refs: "wait", worktree: "wait" },
    duringOperation: "block",
  },
  amend: {
    name: "amend",
    locks: { refs: "wait", worktree: "wait" },
    duringOperation: {
      allowWhen: (operation) =>
        operation.kind === "rebase" && operation.phase === "edit",
    },
  },
} satisfies Record<
  MutateChanges["action"] | "commit" | "amend",
  RepositoryWritePolicy
>;
