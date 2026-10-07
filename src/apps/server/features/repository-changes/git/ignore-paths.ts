import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import {
  changesFailed,
  type IgnorePaths,
  type IgnoreTarget,
  type IgnoreTracked,
  listedTrackedPaths,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type GitCommandOptions,
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import { safeChangePath } from "#server/features/repository-changes/git/change-files.ts";

const argumentCharacters = 24_000;

export function ignorePaths(
  git: GitCommandRunner,
  index: GitCommandOptions,
  command: IgnorePaths,
) {
  const directory = command.worktreePath;
  const paths = [...new Set(command.paths)];
  const pathspecs = paths.map((path) => path.replace(/\/+$/, ""));
  return Effect.gen(function* () {
    if (paths.some((path) => /[\r\n]/.test(path)))
      return yield* Effect.fail(
        changesFailed(
          "Unsupported",
          "Git can't ignore a name with a line break.",
        ),
      );
    yield* Effect.forEach(paths, (path) => safeChangePath(directory, path));
    const tracked = yield* trackedFiles(git, index, directory, pathspecs);
    if (tracked.length > 0 && !command.untrack)
      return yield* Effect.fail<IgnoreTracked>({
        _tag: "IgnoreTracked",
        paths: tracked.slice(0, listedTrackedPaths),
        count: tracked.length,
      });
    const file = yield* ruleFile(git, directory, command.target);
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* changeIo(() => appendRules(file, paths.map(ignoreRule)));
        if (tracked.length === 0) return;
        yield* runRepositoryGit(
          git,
          directory,
          [
            "rm",
            "-r",
            "--cached",
            "--force",
            "--quiet",
            "--ignore-unmatch",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
          ],
          { ...index, input: `${pathspecs.join("\0")}\0` },
        );
      }),
    );
  });
}

function ignoreRule(path: string) {
  const folder = path.endsWith("/");
  const name = path
    .replace(/\/+$/, "")
    .replace(/[\\*?[]/g, "\\$&")
    .replace(/ +$/, (spaces) => spaces.replaceAll(" ", "\\ "));
  return `/${name}${folder ? "/" : ""}`;
}

function trackedFiles(
  git: GitCommandRunner,
  index: GitCommandOptions,
  directory: string,
  pathspecs: readonly string[],
) {
  return Effect.forEach(argumentGroups(pathspecs), (group) =>
    runRepositoryGit(git, directory, ["ls-files", "-z", "--", ...group], {
      ...index,
      maxOutputBytes: 64 * 1_048_576,
    }),
  ).pipe(
    Effect.map((outputs) => [
      ...new Set(
        outputs.flatMap((output) => output.split("\0")).filter(Boolean),
      ),
    ]),
  );
}

function ruleFile(
  git: GitCommandRunner,
  directory: string,
  target: IgnoreTarget,
) {
  if (target === "repository")
    return Effect.succeed(join(directory, ".gitignore"));
  return runRepositoryGit(git, directory, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "info/exclude",
  ]).pipe(Effect.map((output) => output.trim()));
}

async function appendRules(file: string, rules: readonly string[]) {
  const current = await readFile(file, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const newline = current.includes("\r\n") ? "\r\n" : "\n";
  const present = new Set(current.split(/\r?\n/));
  const added = [...new Set(rules)].filter((rule) => !present.has(rule));
  if (added.length === 0) return;
  const separator = current === "" || current.endsWith("\n") ? "" : newline;
  await mkdir(dirname(file), { recursive: true });
  await appendFile(
    file,
    `${separator}${added.map((rule) => `${rule}${newline}`).join("")}`,
  );
}

function argumentGroups(paths: readonly string[]) {
  const groups: string[][] = [];
  let length = argumentCharacters;
  for (const path of paths) {
    if (length + path.length > argumentCharacters) {
      groups.push([]);
      length = 0;
    }
    groups.at(-1)?.push(path);
    length += path.length + 1;
  }
  return groups;
}
