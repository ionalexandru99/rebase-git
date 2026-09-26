import type { RepositoryChanges, ViewedChange } from "@rebase/contracts";
import { useState } from "react";

export interface ConflictSelection {
  readonly section: "conflicts";
  readonly path: string;
}

export type SelectedChange = ViewedChange | ConflictSelection;

export function useChangeSelection(
  changes: RepositoryChanges | undefined,
  conflicted: readonly string[],
) {
  const [selection, setSelection] = useState<SelectedChange | null>(null);
  const shown =
    selection === null
      ? changes === undefined
        ? null
        : firstChange(changes, conflicted)
      : settled(selection, changes, conflicted);
  if (selection === null && shown !== null) setSelection(shown);
  return [shown, setSelection] as const;
}

function firstChange(
  changes: RepositoryChanges,
  conflicted: readonly string[],
): SelectedChange | null {
  const conflict = conflicted[0];
  if (conflict !== undefined) return { section: "conflicts", path: conflict };
  const file = changes.unstaged[0] ?? changes.staged[0];
  if (file === undefined) return null;
  return {
    path: file.path,
    section: changes.unstaged.length > 0 ? "unstaged" : "staged",
  };
}

function settled(
  selection: SelectedChange,
  changes: RepositoryChanges | undefined,
  conflicted: readonly string[],
): SelectedChange {
  if (changes === undefined) return selection;
  const { path } = selection;
  if (selection.section !== "conflicts")
    return conflicted.includes(path)
      ? { section: "conflicts", path }
      : selection;
  if (conflicted.includes(path)) return selection;
  if (changes.staged.some((file) => file.path === path))
    return { section: "staged", path };
  if (changes.unstaged.some((file) => file.path === path))
    return { section: "unstaged", path };
  return selection;
}
