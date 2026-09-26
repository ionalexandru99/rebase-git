import type { RepositoryChanges, ViewedChange } from "@rebase/contracts";
import { useState } from "react";

export function useChangeSelection(changes: RepositoryChanges | undefined) {
  const [selection, setSelection] = useState<ViewedChange | null>(null);
  const shown =
    selection ?? (changes === undefined ? null : firstChange(changes));
  if (selection === null && shown !== null) setSelection(shown);
  return [shown, setSelection] as const;
}

function firstChange(changes: RepositoryChanges): ViewedChange | null {
  const file =
    changes.unstaged.find((candidate) => candidate.status === "U") ??
    changes.unstaged[0] ??
    changes.staged[0];
  if (file === undefined) return null;
  return {
    path: file.path,
    section: changes.unstaged.length > 0 ? "unstaged" : "staged",
  };
}
