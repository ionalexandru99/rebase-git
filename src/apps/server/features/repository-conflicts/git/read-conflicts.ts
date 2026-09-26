import type { ConflictList } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import { readConflictSnapshots } from "#server/features/repository-conflicts/git/read-conflict-files";
import { readConflictSides } from "#server/features/repository-conflicts/git/read-conflict-sides";
import {
  readResolveUndoEntries,
  readUnmergedEntries,
} from "#server/features/repository-conflicts/git/stage-entries";
import { runRepositoryGit } from "#server/repository/access/index";

export function readConflictList(
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
  directory: string,
) {
  return Effect.gen(function* () {
    const operation = yield* coordination.operation(directory);
    const [unmerged, undone, mergeTool, sides] = yield* Effect.all(
      [
        readUnmergedEntries(git, directory),
        readResolveUndoEntries(git, directory),
        readMergeTool(git, directory),
        readConflictSides(git, directory, operation),
      ],
      { concurrency: "unbounded" },
    );
    const snapshots = yield* readConflictSnapshots(git, directory, unmerged);
    return {
      operation: operation.kind,
      sides: sides.labels,
      files: snapshots.map((snapshot) => snapshot.file),
      resolved: [...undone.keys()].filter((path) => !unmerged.has(path)),
      mergeTool,
    } satisfies ConflictList;
  });
}

export function readMergeTool(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(git, directory, ["config", "--get", "merge.tool"], {
    exitCodes: [0, 1],
  }).pipe(Effect.map((output) => output.trim() || null));
}
