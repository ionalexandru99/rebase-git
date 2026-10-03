import { createHash } from "node:crypto";
import { Effect } from "effect";
import {
  type HeadMoved,
  type ReadRepositoryReflog,
  type ReflogRef,
  RepositoryReflogApi,
  type ResetDiscardsChanges,
  type ResetToCommit,
} from "#contracts/repository-reflog/repository-reflog.contract.ts";
import type { RefMissing } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  groupReflog,
  parseReflog,
} from "#server/features/repository-reflog/reflog-entries.ts";
import { readRefTarget } from "#server/features/repository-refs/git/ref-git.ts";
import {
  atRebaseEditStop,
  type RepositoryWritePolicy,
} from "#server/repository/repository-coordination.ts";

const maximumEntries = 2_000;
const listedDiscards = 20;
const lineFormat = "%H%x1f%gd%x1f%gs%x1f%s";

const resetPolicy: RepositoryWritePolicy = {
  name: "reset",
  locks: { refs: "wait", worktree: "wait" },
  duringOperation: atRebaseEditStop,
};

export function repositoryReflogFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  return {
    routes: [
      query(RepositoryReflogApi.read, (input, git) => readReflog(git, input)),
      command(RepositoryReflogApi.reset, resetPolicy, (input, git) =>
        resetToCommit(git, input),
      ),
    ],
  };
}

function readReflog(
  git: GitCommandRunner,
  { worktreePath, ref }: ReadRepositoryReflog,
) {
  return Effect.gen(function* () {
    const [output, tips] = yield* Effect.all(
      [
        readReflogOutput(git, worktreePath, ref),
        runRepositoryGit(
          git,
          worktreePath,
          [
            "for-each-ref",
            "--format=%(objectname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
          ],
          { maxOutputBytes: 16 * 1_048_576 },
        ),
      ],
      { concurrency: "unbounded" },
    );
    const lines = parseReflog(output);
    const kept = lines.slice(0, maximumEntries);
    const orphaned = yield* readOrphaned(
      git,
      worktreePath,
      [...new Set(kept.map((line) => line.oid))],
      tips.split("\n").filter((tip) => tip.length > 0),
    );
    return {
      entries: groupReflog(lines, orphaned, maximumEntries),
      truncated: lines.length > maximumEntries,
    };
  });
}

function readReflogOutput(
  git: GitCommandRunner,
  directory: string,
  ref: ReflogRef,
) {
  return runRepositoryGit(
    git,
    directory,
    [
      "reflog",
      "show",
      "--no-abbrev",
      "--date=unix",
      `--max-count=${maximumEntries + 1}`,
      `--format=${lineFormat}`,
      ref._tag === "Head" ? "HEAD" : `refs/heads/${ref.name}`,
    ],
    { maxOutputBytes: 8 * 1_048_576 },
  ).pipe(
    Effect.catchIf(
      (error) => /does not have any commits yet/i.test(error.detail),
      () => Effect.succeed(""),
    ),
  );
}

function readOrphaned(
  git: GitCommandRunner,
  directory: string,
  oids: readonly string[],
  tips: readonly string[],
) {
  if (oids.length === 0) return Effect.succeed(new Set<string>());
  return runRepositoryGit(git, directory, ["rev-list", "--stdin"], {
    input: `${[...oids, ...tips.map((tip) => `^${tip}`)].join("\n")}\n`,
    maxOutputBytes: 64 * 1_048_576,
  }).pipe(
    Effect.map((output) => {
      const candidates = new Set(oids);
      return new Set(
        output
          .split("\n")
          .map((oid) => oid.trim())
          .filter((oid) => candidates.has(oid)),
      );
    }),
  );
}

function resetToCommit(git: GitCommandRunner, command: ResetToCommit) {
  const { worktreePath, target, mode, expectedHead, discard } = command;
  return Effect.gen(function* () {
    const head = yield* readRefTarget(git, worktreePath, "HEAD");
    if (head !== expectedHead)
      return yield* Effect.fail<HeadMoved>({
        _tag: "HeadMoved",
        head: head ?? null,
      });
    const commit = yield* readRefTarget(
      git,
      worktreePath,
      `${target}^{commit}`,
    );
    if (commit === undefined)
      return yield* Effect.fail<RefMissing>({
        _tag: "RefMissing",
        name: target,
      });
    if (mode === "hard")
      yield* requireDiscardConfirmed(git, worktreePath, commit, discard);
    yield* runRepositoryGit(
      git,
      worktreePath,
      ["reset", `--${mode}`, "--quiet", commit],
      { timeoutMilliseconds: 120_000 },
    );
    return { head: commit };
  });
}

function requireDiscardConfirmed(
  git: GitCommandRunner,
  directory: string,
  target: string,
  discard: string | undefined,
) {
  return Effect.gen(function* () {
    const status = yield* runRepositoryGit(
      git,
      directory,
      [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--no-renames",
      ],
      {
        globalArguments: ["--no-optional-locks"],
        maxOutputBytes: 64 * 1_048_576,
      },
    );
    const records = status.split("\0").filter((record) => record.length > 3);
    const untracked = records
      .filter((record) => record.startsWith("??"))
      .map((record) => record.slice(3));
    const overwritten =
      untracked.length === 0
        ? []
        : yield* readOverwrittenUntracked(git, directory, target, untracked);
    const paths = [
      ...records
        .filter((record) => !record.startsWith("??"))
        .map((record) => record.slice(3)),
      ...overwritten,
    ].sort();
    if (paths.length === 0) return;
    const fingerprint = createHash("sha256")
      .update(paths.join("\0"))
      .digest("hex");
    if (discard === fingerprint) return;
    return yield* Effect.fail<ResetDiscardsChanges>({
      _tag: "ResetDiscardsChanges",
      paths: paths.slice(0, listedDiscards),
      count: paths.length,
      fingerprint,
    });
  });
}

function readOverwrittenUntracked(
  git: GitCommandRunner,
  directory: string,
  target: string,
  untracked: readonly string[],
) {
  return runRepositoryGit(
    git,
    directory,
    ["diff", "--name-only", "-z", "--no-renames", "HEAD", target],
    { maxOutputBytes: 64 * 1_048_576 },
  ).pipe(
    Effect.map((output) => {
      const changed = new Set(output.split("\0"));
      return untracked.filter((path) => changed.has(path));
    }),
  );
}
