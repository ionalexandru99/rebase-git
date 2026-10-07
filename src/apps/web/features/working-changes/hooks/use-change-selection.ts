import { useState } from "react";
import type {
  ChangeSection,
  RepositoryChanges,
  ViewedChange,
} from "#contracts/repository-changes/repository-changes.contract.ts";

export interface ConflictSelection {
  readonly section: "conflicts";
  readonly path: string;
}

export interface FolderSelection {
  readonly section: ChangeSection;
  readonly folder: string;
}

export type SelectedChange = ViewedChange | ConflictSelection | FolderSelection;

export function viewedChange(
  selection: SelectedChange | null,
): ViewedChange | null {
  return selection === null ||
    selection.section === "conflicts" ||
    "folder" in selection
    ? null
    : selection;
}

export function inFolder(folder: string, path: string) {
  return path.startsWith(folder);
}

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
): SelectedChange | null {
  if (changes === undefined) return selection;
  if ("folder" in selection)
    return changes[selection.section].some((file) =>
      inFolder(selection.folder, file.path),
    )
      ? selection
      : firstChange(changes, conflicted);
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
  return firstChange(changes, conflicted);
}
