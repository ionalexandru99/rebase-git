import type { ConflictList } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import { readConflictSnapshots } from "#server/features/repository-conflicts/git/read-conflict-files";
import { readConflictSides } from "#server/features/repository-conflicts/git/read-conflict-sides";
import { readUnmergedEntries } from "#server/features/repository-conflicts/git/stage-entries";

export function readConflictList(
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
  directory: string,
) {
  return Effect.gen(function* () {
    const operation = yield* coordination.operation(directory);
    const [unmerged, sides] = yield* Effect.all(
      [
        readUnmergedEntries(git, directory),
        readConflictSides(git, directory, operation),
      ],
      { concurrency: "unbounded" },
    );
    const snapshots = yield* readConflictSnapshots(git, directory, unmerged);
    return {
      sides,
      files: snapshots.map((snapshot) => snapshot.file),
    } satisfies ConflictList;
  });
}
