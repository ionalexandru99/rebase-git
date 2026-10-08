import { homedir } from "node:os";
import { Effect, Stream } from "effect";
import type { ChangedLines } from "#contracts/repository-changes/repository-changes.contract.ts";
import type { GitStatus } from "#contracts/source-control/source-control.contract.ts";
import {
  type GitCommand,
  type GitCommandOptions,
  type GitCommandRunner,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";

export type GitLfs = ReturnType<typeof createGitLfs>;

const filtersOff = [
  "-c",
  "filter.lfs.process=",
  "-c",
  "filter.lfs.clean=",
  "-c",
  "filter.lfs.smudge=",
  "-c",
  "filter.lfs.required=false",
];
const progressOnStdout = {
  environment: { GIT_LFS_FORCE_PROGRESS: "1" },
  progressStream: "stdout",
  timeoutMilliseconds: 6 * 60 * 60_000,
} as const;

export function createGitLfs(git: GitCommandRunner) {
  let known: GitStatus | undefined;
  const rescan = git
    .run({ directory: homedir(), arguments: ["lfs", "version"] })
    .pipe(
      Effect.map(({ exitCode, stdout }): GitStatus => {
        const version = stdout.trim().split(" ")[0];
        return exitCode === 0 && version?.startsWith("git-lfs/")
          ? { _tag: "Available", version }
          : { _tag: "Missing" };
      }),
      Effect.orElseSucceed((): GitStatus => ({ _tag: "Missing" })),
      Effect.tap((status) =>
        Effect.sync(() => {
          known = status;
        }),
      ),
    );
  const status = Effect.suspend(() =>
    known === undefined ? rescan : Effect.succeed(known),
  );
  const command = <Command extends Pick<GitCommand, "globalArguments">>(
    next: Command,
  ) =>
    Effect.map(status, (current) =>
      current._tag === "Available"
        ? next
        : {
            ...next,
            globalArguments: [...filtersOff, ...(next.globalArguments ?? [])],
          },
    );
  return {
    status,
    rescan,
    installed: Effect.map(status, (current) => current._tag === "Available"),
    git: {
      run: (next) => Effect.flatMap(command(next), git.run),
      stream: (next) => Stream.unwrap(Effect.map(command(next), git.stream)),
    } satisfies GitCommandRunner,
  };
}

export function runGitLfs(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  options: GitCommandOptions = {},
) {
  return runRepositoryGit(git, directory, ["lfs", ...args], {
    ...options,
    literalPathspecs: false,
  });
}

export function largeFilePaths(
  git: GitCommandRunner,
  directory: string,
  paths: readonly string[],
) {
  if (paths.length === 0) return Effect.succeed(new Set<string>());
  return runRepositoryGit(
    git,
    directory,
    ["check-attr", "-z", "--stdin", "filter"],
    { input: paths.map((path) => `${path}\0`).join("") },
  ).pipe(
    Effect.map((output) => {
      const fields = output.split("\0");
      const found = new Set<string>();
      for (let index = 0; index + 2 < fields.length; index += 3)
        if (fields[index + 2] === "lfs") found.add(fields[index] ?? "");
      return found;
    }),
  );
}

export function markLargeFile<
  File extends { readonly path: string; readonly lines: ChangedLines },
>(file: File, large: ReadonlySet<string>) {
  return large.has(file.path)
    ? { ...file, lines: null, lfs: true }
    : { ...file, lfs: false };
}

export function downloadLargeFiles(
  git: GitCommandRunner,
  directory: string,
  paths?: readonly string[],
  commits: readonly string[] = [],
) {
  return Effect.gen(function* () {
    if (paths !== undefined && commits.length > 0) {
      const source = yield* defaultRemote(git, directory);
      if (source === undefined) return;
      return yield* runGitLfs(
        git,
        directory,
        ["fetch", `--include=${includePattern(paths)}`, source, ...commits],
        progressOnStdout,
      );
    }
    const tracked = yield* runRepositoryGit(
      git,
      directory,
      ["ls-files", "-z", "--", ":(attr:filter=lfs)"],
      { literalPathspecs: false },
    );
    if (tracked === "") return;
    yield* runGitLfs(
      git,
      directory,
      [
        "pull",
        ...(paths === undefined ? [] : [`--include=${includePattern(paths)}`]),
      ],
      progressOnStdout,
    );
  });
}

export function fetchLargeFiles(
  lfs: GitLfs,
  git: GitCommandRunner,
  directory: string,
  target: string,
  remote?: string,
) {
  return Effect.gen(function* () {
    if (!(yield* lfs.installed)) return;
    const attributes = yield* runRepositoryGitOutput(
      git,
      directory,
      ["cat-file", "blob", `${target}:.gitattributes`],
      { exitCodes: [0, 128] },
    );
    if (!attributes.stdout.includes("filter=lfs")) return;
    const source = remote ?? (yield* defaultRemote(git, directory));
    if (source === undefined) return;
    yield* runGitLfs(git, directory, ["fetch", source, target], {
      ...progressOnStdout,
    });
  });
}

function defaultRemote(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(git, directory, ["remote"]).pipe(
    Effect.map((output) => {
      const remotes = output.split("\n").filter(Boolean);
      return remotes.includes("origin") ? "origin" : remotes[0];
    }),
  );
}

function includePattern(paths: readonly string[]) {
  return paths.map((path) => path.replace(/[\\*?[\],]/g, "\\$&")).join(",");
}
