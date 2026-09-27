import { Effect } from "effect";
import type {
  ConflictList,
  ConflictSides,
  SideLabel,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import type { RepositoryOperation } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  readConflictSnapshots,
  readUnmergedEntries,
} from "#server/features/repository-conflicts/git/conflict-files.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

export function readConflictList(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
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

function readConflictSides(
  git: GitCommandRunner,
  directory: string,
  operation: RepositoryOperation,
) {
  return Effect.gen(function* () {
    const [current, incoming] = yield* Effect.all(
      [
        resolveCommit(git, directory, "HEAD"),
        operation.commit === null
          ? Effect.succeed(null)
          : resolveCommit(git, directory, operation.commit),
      ],
      { concurrency: "unbounded" },
    );
    const base = yield* baseCommit(git, directory, operation.kind, incoming);
    const subjects = yield* readSubjects(git, directory, [
      current,
      incoming,
      base,
    ]);
    const label = (commit: string | null, ref: string | null) =>
      ({
        ref: commit === null ? null : ref,
        commit,
        subject: commit === null ? null : (subjects.get(commit) ?? null),
      }) satisfies SideLabel;
    return {
      current: label(
        current,
        operation.kind === "rebase" ? null : operation.branch,
      ),
      incoming: label(
        incoming,
        operation.kind === "rebase" ? operation.branch : operation.mergedBranch,
      ),
      base: label(base, null),
    } satisfies ConflictSides;
  });
}

function baseCommit(
  git: GitCommandRunner,
  directory: string,
  kind: RepositoryOperation["kind"],
  incoming: string | null,
) {
  if (incoming === null) return Effect.succeed(null);
  if (kind === "merge")
    return firstLine(
      runRepositoryGit(git, directory, ["merge-base", "HEAD", incoming], {
        exitCodes: [0, 1],
      }),
    );
  if (kind === "revert") return Effect.succeed(incoming);
  if (kind === "rebase" || kind === "cherry-pick")
    return resolveCommit(git, directory, `${incoming}^`);
  return Effect.succeed(null);
}

function resolveCommit(git: GitCommandRunner, directory: string, rev: string) {
  return firstLine(
    runRepositoryGit(
      git,
      directory,
      ["rev-parse", "--verify", "--quiet", rev],
      { exitCodes: [0, 1] },
    ),
  );
}

function firstLine<E>(output: Effect.Effect<string, E>) {
  return output.pipe(Effect.map((text) => text.split("\n")[0]?.trim() || null));
}

function readSubjects(
  git: GitCommandRunner,
  directory: string,
  commits: readonly (string | null)[],
) {
  const unique = [...new Set(commits.filter((commit) => commit !== null))];
  if (unique.length === 0) return Effect.succeed(new Map<string, string>());
  return runRepositoryGit(git, directory, [
    "log",
    "--no-walk=unsorted",
    "--format=%H%x00%s",
    ...unique,
  ]).pipe(
    Effect.map(
      (output) =>
        new Map(
          output
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [commit = "", subject = ""] = line.split("\0");
              return [commit, subject] as const;
            }),
        ),
    ),
  );
}
