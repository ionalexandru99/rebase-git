import { stat } from "node:fs/promises";
import type {
  ChangedFile,
  ChangesScope,
  RepositoryChanges,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { worktreeIdentities } from "#server/features/repository-changes/git/change-files";
import {
  changeGit,
  changeIo,
  changesError,
} from "#server/features/repository-changes/git/change-git";
import { fingerprint } from "#server/repository/comparison/index";

export function readChanges(git: GitCommandRunner, scope: ChangesScope) {
  return Effect.gen(function* () {
    const directory = scope.worktreePath;
    const { head, indexPath } = yield* readHeadAndIndexPath(git, directory);
    if (scope.amend && head === null)
      return yield* Effect.fail(
        changesError("Unsupported", "There is no commit to amend."),
      );
    const base = yield* comparisonBase(git, directory, head, scope.amend);
    const [status, stagedOutput, index, message] = yield* Effect.all(
      [
        changeGit(git, directory, [
          "status",
          "--porcelain=v1",
          "--no-renames",
          "-z",
          "--untracked-files=all",
        ]),
        changeGit(git, directory, [
          "diff",
          "--cached",
          "--no-renames",
          "--name-status",
          "-z",
          base,
        ]),
        indexIdentity(indexPath),
        head === null
          ? Effect.succeed("")
          : changeGit(git, directory, ["log", "-1", "--format=%B", head]),
      ],
      { concurrency: 4 },
    );
    const unstaged: ChangedFile[] = [];
    for (const record of status.split("\0")) {
      if (!record) continue;
      const xy = record.slice(0, 2);
      const path = record.slice(3);
      const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
      if (xy[1] !== " " || conflict)
        unstaged.push({ path, status: conflict ? "U" : fileStatus(xy[1]) });
    }
    const parts = stagedOutput.split("\0");
    const staged: ChangedFile[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const path = parts[i + 1];
      if (path) staged.push({ path, status: fileStatus(parts[i]) });
    }
    const identities = yield* worktreeIdentities(directory, [
      ...new Set([...unstaged, ...staged].map((file) => file.path)),
    ]);
    return {
      snapshot: {
        head,
        message: message.trimEnd(),
        revision: fingerprint(head ?? "", index, status, base, ...identities),
        unstaged,
        staged,
        truncated: false,
      } satisfies RepositoryChanges,
      base,
    };
  });
}

function readHeadAndIndexPath(git: GitCommandRunner, directory: string) {
  return git
    .run({
      directory,
      arguments: [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "index",
        "--verify",
        "HEAD",
      ],
    })
    .pipe(
      Effect.mapError(() => changesError("GitFailed", "Could not read HEAD.")),
      Effect.flatMap((output) => {
        const [indexPath, head] = output.stdout.split("\n");
        return indexPath
          ? Effect.succeed({
              indexPath,
              head: output.exitCode === 0 && head ? head.trim() : null,
            })
          : Effect.fail(changesError("GitFailed", output.stderr));
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
      const parents = (yield* changeGit(git, directory, [
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
    return (yield* changeGit(
      git,
      directory,
      ["hash-object", "-w", "-t", "tree", "--stdin"],
      { input: "" },
    )).trim();
  });
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
