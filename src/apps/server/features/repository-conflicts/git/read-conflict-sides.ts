import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ConflictSides,
  RepositoryOperation,
  SideLabel,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { changeIo } from "#server/features/repository-changes/git/change-failures";
import { runRepositoryGit } from "#server/repository/access/index";

export interface ConflictCommits {
  readonly current: string | null;
  readonly incoming: string | null;
  readonly base: string | null;
}

export function readConflictSides(
  git: GitCommandRunner,
  directory: string,
  operation: RepositoryOperation,
) {
  return readConflictCommits(git, directory, operation).pipe(
    Effect.flatMap((commits) =>
      labelSides(git, directory, operation, commits).pipe(
        Effect.map((labels) => ({ commits, labels })),
      ),
    ),
  );
}

function readConflictCommits(
  git: GitCommandRunner,
  directory: string,
  operation: RepositoryOperation,
) {
  return Effect.gen(function* () {
    const current = yield* resolveCommit(git, directory, "HEAD");
    const incoming =
      operation.kind === "merge"
        ? yield* resolveCommit(git, directory, "MERGE_HEAD")
        : operation.commit;
    return {
      current,
      incoming,
      base: yield* baseCommit(git, directory, operation.kind, incoming),
    } satisfies ConflictCommits;
  });
}

function labelSides(
  git: GitCommandRunner,
  directory: string,
  operation: RepositoryOperation,
  commits: ConflictCommits,
) {
  return Effect.gen(function* () {
    const [subjects, branches, merged] = yield* Effect.all(
      [
        readSubjects(git, directory, Object.values(commits)),
        readBranchHeads(git, directory),
        operation.kind === "merge"
          ? readMergedBranch(git, directory)
          : Effect.succeed(null),
      ],
      { concurrency: "unbounded" },
    );
    const label = (commit: string | null, recorded: string | null) =>
      ({
        ref:
          commit === null
            ? null
            : (recorded ?? uniqueBranch(branches.get(commit))),
        commit,
        subject: commit === null ? null : (subjects.get(commit) ?? null),
      }) satisfies SideLabel;
    const rebase = operation.kind === "rebase";
    return {
      current: label(commits.current, rebase ? null : operation.branch),
      incoming: label(commits.incoming, rebase ? operation.branch : merged),
      base: label(commits.base, null),
    } satisfies ConflictSides;
  });
}

export function sideTreeCommits(
  operation: RepositoryOperation,
  commits: ConflictCommits,
) {
  return {
    current: commits.current,
    incoming:
      operation.kind === "revert" && commits.incoming !== null
        ? `${commits.incoming}^`
        : commits.incoming,
  };
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
      {
        exitCodes: [0, 1],
      },
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

function readBranchHeads(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(git, directory, [
    "for-each-ref",
    "--format=%(objectname)%00%(refname:short)",
    "refs/heads",
  ]).pipe(
    Effect.map((output) => {
      const heads = new Map<string, string[]>();
      for (const line of output.split("\n").filter(Boolean)) {
        const [commit = "", name = ""] = line.split("\0");
        heads.set(commit, [...(heads.get(commit) ?? []), name]);
      }
      return heads;
    }),
  );
}

function readMergedBranch(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(git, directory, [
    "rev-parse",
    "--git-path",
    "MERGE_MSG",
  ]).pipe(
    Effect.flatMap((path) =>
      changeIo(() =>
        readFile(resolve(directory, path.trim()), "utf8").catch(() => ""),
      ),
    ),
    Effect.map(
      (message) =>
        /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(message)?.[1] ??
        null,
    ),
  );
}

function uniqueBranch(names: readonly string[] | undefined) {
  return names?.length === 1 ? (names[0] ?? null) : null;
}
