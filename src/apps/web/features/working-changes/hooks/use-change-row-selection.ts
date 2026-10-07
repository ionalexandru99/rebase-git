import { useRef, useState } from "react";
import type {
  ChangedFile,
  ChangeSection,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import type { ChangeTreeRow } from "#web/features/file-diff/file-tree.ts";
import { viewedChange } from "#web/features/working-changes/hooks/use-change-selection.ts";
import type { WorkingChangesView } from "#web/features/working-changes/hooks/use-working-changes-view.ts";

type Row = ChangeTreeRow<ChangedFile>;

interface Modifiers {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

export function useChangeRowSelection(
  { selection, select }: Pick<WorkingChangesView, "selection" | "select">,
  section: ChangeSection,
) {
  const anchor = useRef<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const viewed = viewedChange(selection);
  const folder =
    selection !== null && "folder" in selection && selection.section === section
      ? selection.folder
      : undefined;
  const current = (row: Row) =>
    row.file === undefined
      ? row.key === folder
      : viewed?.section === section && viewed.path === row.key;
  const selectFolder = (row: Row) => {
    anchor.current = row.key;
    setChecked(new Set());
    select({ section, folder: row.key });
  };
  const extend = (
    row: Row,
    modifiers: Modifiers,
    rows: readonly Row[],
    index: number,
  ) => {
    const start = rows.findIndex((entry) => entry.key === anchor.current);
    const paths =
      modifiers.shiftKey && start >= 0
        ? rows
            .slice(Math.min(start, index), Math.max(start, index) + 1)
            .flatMap((entry) => (entry.file ? entry.paths : []))
        : row.paths;
    setChecked((selected) => {
      const next = modifiers.shiftKey ? new Set<string>() : new Set(selected);
      const remove =
        !modifiers.shiftKey && paths.every((path) => next.has(path));
      for (const path of paths) {
        if (remove) next.delete(path);
        else next.add(path);
      }
      return next;
    });
    if (!modifiers.shiftKey) anchor.current = row.key;
  };
  return {
    checked,
    folder,
    current,
    chosen: (row: Row) => checked.has(row.key) || current(row),
    pressed: (row: Row) =>
      row.file === undefined
        ? row.key === folder
        : row.paths.every((path) => checked.has(path)),
    click: (
      row: Row,
      modifiers: Modifiers,
      rows: readonly Row[],
      index: number,
    ) => {
      if (row.file === undefined) return selectFolder(row);
      if (modifiers.metaKey || modifiers.ctrlKey || modifiers.shiftKey)
        return extend(row, modifiers, rows, index);
      anchor.current = row.key;
      setChecked(new Set(row.paths));
      select({ section, path: row.key });
    },
    menuOpened: (row: Row) => {
      if (row.file === undefined) return selectFolder(row);
      if (row.paths.every((path) => checked.has(path))) return;
      anchor.current = row.key;
      setChecked(new Set(row.paths));
    },
  };
}
