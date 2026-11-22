import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChangedLines } from "#contracts/repository-changes/repository-changes.contract.ts";
import type { GitStatus } from "#contracts/source-control/source-control.contract.ts";
import {
  type GitCommand,
  type GitCommandOptions,
  type GitCommandRunner,
  readGitCommonDirectory,
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
  const rescan = async (): Promise<GitStatus> => {
    try {
      const { exitCode, stdout } = await git.run({
        directory: homedir(),
        arguments: ["lfs", "version"],
      });
      const version = stdout.trim().split(" ")[0];
      known =
        exitCode === 0 && version?.startsWith("git-lfs/")
          ? { _tag: "Available", version }
          : { _tag: "Missing" };
      return known;
    } catch {
      return { _tag: "Missing" };
    }
  };
  const status = () =>
    known === undefined ? rescan() : Promise.resolve(known);
  const command = async <Command extends Pick<GitCommand, "globalArguments">>(
    next: Command,
  ) =>
    (await status())._tag === "Available"
      ? next
      : {
          ...next,
          globalArguments: [...filtersOff, ...(next.globalArguments ?? [])],
        };
  return {
    status,
    rescan,
    installed: async () => (await status())._tag === "Available",
    git: {
      run: async (next) => git.run(await command(next)),
      stream: async function* (next) {
        yield* git.stream(await command(next));
      },
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

export async function largeFilePaths(
  git: GitCommandRunner,
  directory: string,
  paths: readonly string[],
) {
  const found = new Set<string>();
  if (paths.length === 0) return found;
  const output = await runRepositoryGit(
    git,
    directory,
    ["check-attr", "-z", "--stdin", "filter"],
    { input: paths.map((path) => `${path}\0`).join("") },
  );
  const fields = output.split("\0");
  for (let index = 0; index + 2 < fields.length; index += 3)
    if (fields[index + 2] === "lfs") found.add(fields[index] ?? "");
  return found;
}

export function markLargeFile<
  File extends { readonly path: string; readonly lines: ChangedLines },
>(file: File, large: ReadonlySet<string>) {
  return large.has(file.path)
    ? { ...file, lines: null, lfs: true }
    : { ...file, lfs: false };
}

export async function downloadLargeFiles(
  git: GitCommandRunner,
  directory: string,
  paths?: readonly string[],
  commits: readonly string[] = [],
) {
  if (paths !== undefined && commits.length > 0) {
    const source = await defaultRemote(git, directory);
    if (source === undefined) return;
    await runGitLfs(
      git,
      directory,
      ["fetch", `--include=${includePattern(paths)}`, source, ...commits],
      progressOnStdout,
    );
    return;
  }
  const tracked = await runRepositoryGit(
    git,
    directory,
    ["ls-files", "-z", "--", ":(attr:filter=lfs)"],
    { literalPathspecs: false },
  );
  if (tracked === "") return;
  await runGitLfs(
    git,
    directory,
    [
      "pull",
      ...(paths === undefined ? [] : [`--include=${includePattern(paths)}`]),
    ],
    progressOnStdout,
  );
}

export async function fetchLargeFiles(
  lfs: GitLfs,
  git: GitCommandRunner,
  directory: string,
  target: string,
  remote?: string,
) {
  if (!(await lfs.installed())) return;
  if (!(await usesLargeFiles(git, directory, target))) return;
  const source = remote ?? (await defaultRemote(git, directory));
  if (source === undefined) return;
  await runGitLfs(git, directory, ["fetch", source, target], {
    ...progressOnStdout,
  });
}

async function usesLargeFiles(
  git: GitCommandRunner,
  directory: string,
  target: string,
) {
  const common = await readGitCommonDirectory(git, directory);
  const store = await stat(join(common, "lfs")).then(
    () => true,
    () => false,
  );
  if (store) return true;
  const attributes = await runRepositoryGitOutput(
    git,
    directory,
    ["cat-file", "blob", `${target}:.gitattributes`],
    { exitCodes: [0, 128] },
  );
  return attributes.stdout.includes("filter=lfs");
}

async function defaultRemote(git: GitCommandRunner, directory: string) {
  const remotes = (await runRepositoryGit(git, directory, ["remote"]))
    .split("\n")
    .filter(Boolean);
  return remotes.includes("origin") ? "origin" : remotes[0];
}

function includePattern(paths: readonly string[]) {
  return paths.map((path) => path.replace(/[\\*?[\],]/g, "\\$&")).join(",");
}
