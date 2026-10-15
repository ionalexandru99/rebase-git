import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix } from "node:path";
import { Effect } from "effect";
import {
  changesFailed,
  type IgnorePaths,
  type IgnoreRule,
  type IgnoreTarget,
  ignoreTracked,
  type ReadIgnoreRule,
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
    const [first] = tracked;
    if (first !== undefined && !command.untrack)
      return yield* Effect.fail(ignoreTracked(first, tracked.length));
    const target = command.target;
    const file =
      target === null ? null : yield* ruleFile(git, directory, target);
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        if (file !== null)
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

export function readIgnoreRule(
  git: GitCommandRunner,
  { worktreePath, path, includeTracked }: ReadIgnoreRule,
) {
  return Effect.gen(function* () {
    yield* safeChangePath(worktreePath, path);
    const output = yield* runRepositoryGit(
      git,
      worktreePath,
      [
        "check-ignore",
        "-z",
        "--verbose",
        ...(includeTracked ? ["--no-index"] : []),
        "--stdin",
      ],
      { input: `./${path}\0`, exitCodes: [0, 1], literalPathspecs: false },
    );
    const [file, line, pattern] = output.split("\0");
    if (!file || !pattern || pattern.startsWith("!")) return null;
    return {
      pattern,
      line: Number(line),
      ...ruleSource(posix.normalize(separators(file))),
    } satisfies IgnoreRule;
  });
}

function ruleSource(file: string): Pick<IgnoreRule, "file" | "inWorktree"> {
  if (file === ".git/info/exclude" || file.endsWith("/.git/info/exclude"))
    return { file: ".git/info/exclude", inWorktree: false };
  if (
    !isAbsolute(file) &&
    !file.startsWith("../") &&
    (file === ".gitignore" || file.endsWith("/.gitignore"))
  )
    return { file, inWorktree: true };
  const home = `${separators(homedir())}/`;
  return {
    file: file.startsWith(home) ? `~/${file.slice(home.length)}` : file,
    inWorktree: false,
  };
}

function separators(path: string) {
  return process.platform === "win32" ? path.replaceAll("\\", "/") : path;
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
