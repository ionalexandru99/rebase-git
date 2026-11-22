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

export async function readConflictList(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  directory: string,
) {
  const operation = await coordination.operation(directory);
  const [unmerged, sides] = await Promise.all([
    readUnmergedEntries(git, directory),
    readConflictSides(git, directory, operation),
  ]);
  const snapshots = await readConflictSnapshots(git, directory, unmerged);
  return {
    sides,
    files: snapshots.map((snapshot) => snapshot.file),
  } satisfies ConflictList;
}

async function readConflictSides(
  git: GitCommandRunner,
  directory: string,
  operation: RepositoryOperation,
) {
  const [current, incoming] = await Promise.all([
    resolveCommit(git, directory, "HEAD"),
    operation.commit === null
      ? null
      : resolveCommit(git, directory, operation.commit),
  ]);
  const base = await baseCommit(git, directory, operation.kind, incoming);
  const subjects = await readSubjects(git, directory, [
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
}

async function baseCommit(
  git: GitCommandRunner,
  directory: string,
  kind: RepositoryOperation["kind"],
  incoming: string | null,
) {
  if (incoming === null) return null;
  if (kind === "merge" || kind === "squash")
    return firstLine(
      await runRepositoryGit(git, directory, ["merge-base", "HEAD", incoming], {
        exitCodes: [0, 1],
      }),
    );
  if (kind === "revert") return incoming;
  if (kind === "rebase" || kind === "cherry-pick")
    return resolveCommit(git, directory, `${incoming}^`);
  return null;
}

async function resolveCommit(
  git: GitCommandRunner,
  directory: string,
  rev: string,
) {
  return firstLine(
    await runRepositoryGit(
      git,
      directory,
      ["rev-parse", "--verify", "--quiet", rev],
      { exitCodes: [0, 1] },
    ),
  );
}

function firstLine(text: string) {
  return text.split("\n")[0]?.trim() || null;
}

async function readSubjects(
  git: GitCommandRunner,
  directory: string,
  commits: readonly (string | null)[],
) {
  const unique = [...new Set(commits.filter((commit) => commit !== null))];
  if (unique.length === 0) return new Map<string, string>();
  const output = await runRepositoryGit(git, directory, [
    "log",
    "--no-walk=unsorted",
    "--format=%H%x00%s",
    ...unique,
  ]);
  return new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [commit = "", subject = ""] = line.split("\0");
        return [commit, subject] as const;
      }),
  );
}
