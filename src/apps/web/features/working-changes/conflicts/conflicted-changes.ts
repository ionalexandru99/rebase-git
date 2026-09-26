import type { ChangedFile, RepositoryChanges } from "@rebase/contracts";

export interface ConflictedChanges {
  readonly changes: RepositoryChanges | undefined;
  readonly conflicted: readonly string[];
}

export function splitConflicts(
  changes: RepositoryChanges | undefined,
): ConflictedChanges {
  if (changes === undefined) return { changes, conflicted: [] };
  const conflicted = [
    ...new Set(
      [...changes.unstaged, ...changes.staged]
        .filter(isConflicted)
        .map((file) => file.path),
    ),
  ];
  if (conflicted.length === 0) return { changes, conflicted };
  return {
    changes: {
      ...changes,
      unstaged: changes.unstaged.filter((file) => !isConflicted(file)),
      staged: changes.staged.filter((file) => !isConflicted(file)),
    },
    conflicted,
  };
}

function isConflicted(file: ChangedFile) {
  return file.status === "U";
}
