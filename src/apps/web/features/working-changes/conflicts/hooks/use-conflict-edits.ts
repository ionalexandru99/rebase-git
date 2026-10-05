import type {
  MergeConflictRegion,
  MergeConflictResolution,
} from "@pierre/diffs";
import { useRef } from "react";
import {
  type ConflictExcerpt,
  type ConflictPath,
  RepositoryConflictsApi,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { conflictReason } from "#web/features/working-changes/conflicts/hooks/use-conflicts.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

export interface ConflictEdit {
  readonly line: number;
  readonly count: number;
  readonly text: string;
}

export function useConflictEdits(input: ConflictPath, reload: () => void) {
  const edit = useCommand(RepositoryConflictsApi.edit, {
    target: input,
    answers: (edited, { repositoryId, worktreePath, path }) => [
      answer(
        RepositoryConflictsApi.document,
        { repositoryId, worktreePath, path },
        edited,
      ),
    ],
  });
  const errorToast = useErrorToast();
  const busy = useRef(false);
  const run = async (revision: string, change: ConflictEdit) => {
    const result = await edit
      .run({ path: input.path, revision, ...change })
      .finally(() => {
        busy.current = false;
      });
    if (result._tag === "Ok") return true;
    if (conflictReason(result) === "Stale") reload();
    else errorToast.failure("resolveConflict", result);
    return false;
  };
  return {
    running: edit.running,
    apply: (revision: string, change: ConflictEdit) => {
      if (busy.current) return null;
      busy.current = true;
      return run(revision, change);
    },
  };
}

export function resolutionEdit(
  excerpt: ConflictExcerpt,
  conflict: MergeConflictRegion,
  resolution: MergeConflictResolution,
) {
  const lines = excerpt.text.split(/(?<=\n)/);
  const block = lines.slice(conflict.startLineIndex, conflict.endLineIndex + 1);
  const current = lines.slice(
    conflict.startLineIndex + 1,
    conflict.baseMarkerLineIndex ?? conflict.separatorLineIndex,
  );
  const incoming = lines.slice(
    conflict.separatorLineIndex + 1,
    conflict.endLineIndex,
  );
  const kept =
    resolution === "current"
      ? current
      : resolution === "incoming"
        ? incoming
        : [...current, ...incoming];
  const line = excerpt.line + conflict.startLineIndex;
  return {
    edit: { line, count: block.length, text: kept.join("") },
    undo: { line, count: kept.length, text: block.join("") },
  };
}
