import { stat } from "node:fs/promises";
import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type ChangedFile,
  type ChangesScope,
  changesFailed,
  type RepositoryChanges,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import {
  worktreeIdentities,
  worktreeLineCounts,
} from "#server/features/repository-changes/git/change-files.ts";
import { fingerprint } from "#server/repository/comparison/fingerprint.ts";

export function readChanges(git: GitCommandRunner, scope: ChangesScope) {
  return Effect.gen(function* () {
    const directory = scope.worktreePath;
    const { head, indexPath } = yield* readHeadAndIndexPath(git, directory);
    if (scope.amend && head === null)
      return yield* Effect.fail(
        changesFailed("Unsupported", "There is no commit to amend."),
      );
    const base = yield* comparisonBase(git, directory, head, scope.amend);
    const [status, unstagedLines, stagedDiff, index, message] =
      yield* Effect.all(
        [
          runRepositoryGit(git, directory, [
            "status",
            "--porcelain=v1",
            "--no-renames",
            "-z",
            "--untracked-files=all",
          ]),
          runRepositoryGit(git, directory, [
            "diff",
            "--numstat",
            "--no-renames",
            "-z",
          ]),
          runRepositoryGitOutput(git, directory, [
            "diff",
            "--cached",
            "--find-renames",
            `-l${renameLimit}`,
            "--raw",
            "--numstat",
            "-z",
            base,
          ]),
          indexIdentity(indexPath),
          head === null
            ? Effect.succeed("")
            : runRepositoryGit(git, directory, [
                "log",
                "-1",
                "--format=%B",
                head,
              ]),
        ],
        { concurrency: 5 },
      );
    const records = status
      .split("\0")
      .filter((record) => record.length > 0)
      .map((record) => ({ xy: record.slice(0, 2), path: record.slice(3) }))
      .filter(({ xy }) => xy[1] !== " " || conflicted(xy));
    const untracked = records.flatMap(({ xy, path }) =>
      xy === "??" ? [path] : [],
    );
    const untrackedLines = yield* worktreeLineCounts(directory, untracked);
    const counted = new Map([
      ...lineCounts(unstagedLines),
      ...untracked.map(
        (path, index) => [path, untrackedLines[index] ?? null] as const,
      ),
    ]);
    const unstaged = records.map(
      ({ xy, path }): ChangedFile =>
        conflicted(xy)
          ? { path, previousPath: null, status: "U", lines: null }
          : {
              path,
              previousPath: null,
              status: fileStatus(xy[1]),
              lines: counted.get(path) ?? null,
            },
    );
    const staged = stagedFiles(stagedDiff.stdout);
    const paths = [
      ...new Set(
        [...unstaged, ...staged].flatMap((file) =>
          file.previousPath === null
            ? [file.path]
            : [file.path, file.previousPath],
        ),
      ),
    ];
    const identities = yield* worktreeIdentities(directory, paths);
    return {
      snapshot: {
        head,
        message: message.trimEnd(),
        revision: fingerprint(head ?? "", index, status, base, ...identities),
        unstaged,
        staged,
        renamesLimited: stagedDiff.stderr.includes(
          "rename detection was skipped",
        ),
      } satisfies RepositoryChanges,
      base,
      files: { paths, identities },
    };
  });
}

function readHeadAndIndexPath(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
      "--verify",
      "--quiet",
      "HEAD",
    ],
    { exitCodes: [0, 1] },
  ).pipe(
    Effect.flatMap((output) => {
      const [indexPath, head] = output.split("\n");
      return indexPath
        ? Effect.succeed({ indexPath, head: head?.trim() || null })
        : Effect.fail(repositoryRejected("GitFailed", "Could not read HEAD."));
    }),
  );
}

function indexIdentity(indexPath: string) {
  return changeIo(async () => {
    const info = await stat(indexPath, { bigint: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    return info === null
      ? "missing"
      : `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  });
}

function comparisonBase(
  git: GitCommandRunner,
  directory: string,
  head: string | null,
  amend: boolean,
) {
  return Effect.gen(function* () {
    if (head !== null && !amend) return head;
    if (head !== null) {
      const parents = (yield* runRepositoryGit(git, directory, [
        "rev-list",
        "--parents",
        "-n",
        "1",
        head,
      ]))
        .trim()
        .split(" ");
      if (parents[1]) return parents[1];
    }
    return (yield* runRepositoryGit(
      git,
      directory,
      ["hash-object", "-w", "-t", "tree", "--stdin"],
      { input: "" },
    )).trim();
  });
}
const renameLimit = 1000;

function stagedFiles(output: string) {
  const fields = output.split("\0");
  const files: Omit<ChangedFile, "lines">[] = [];
  let i = 0;
  while (fields[i]?.startsWith(":")) {
    const status = fields[i++]?.split(" ").at(-1) ?? "";
    const first = fields[i++];
    const renamed = status.startsWith("R");
    const path = renamed ? fields[i++] : first;
    if (path)
      files.push({
        path,
        previousPath: renamed ? (first ?? null) : null,
        status: renamed ? "R" : fileStatus(status),
      });
  }
  const counted = lineCounts(fields.slice(i).join("\0"));
  return files.map(
    (file): ChangedFile => ({ ...file, lines: counted.get(file.path) ?? null }),
  );
}

function conflicted(xy: string) {
  return xy.includes("U") || xy === "AA" || xy === "DD";
}

function lineCounts(output: string) {
  const fields = output.split("\0");
  const counts = new Map<string, ChangedFile["lines"]>();
  for (let i = 0; i < fields.length; ) {
    const [added = "", removed = "", path] = (fields[i++] ?? "").split("\t");
    if (path === undefined) continue;
    let target: string | undefined = path;
    if (path === "") {
      target = fields[i + 1];
      i += 2;
    }
    if (target)
      counts.set(
        target,
        added === "-"
          ? null
          : { added: Number(added), removed: Number(removed) },
      );
  }
  return counts;
}

function fileStatus(status: string | undefined): ChangedFile["status"] {
  return status === "A" ||
    status === "D" ||
    status === "T" ||
    status === "U" ||
    status === "?"
    ? status
    : "M";
}
