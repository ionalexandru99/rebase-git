import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type LargeFiles,
  type LfsLocks,
  LfsPattern,
  RepositoryLfsApi,
  type SetLock,
  type SetTracked,
} from "#contracts/repository-lfs/repository-lfs.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  gitFailed,
  isGitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import {
  downloadLargeFiles,
  type GitLfs,
  runGitLfs,
} from "#server/features/repository-lfs/git-lfs.ts";

const isPattern = (value: unknown) => LfsPattern.safeParse(value).success;
const LockRecord = z.object({
  path: z.string(),
  owner: z.object({ name: z.string() }).optional(),
});
const LockListing = z.object({
  ours: z.array(LockRecord),
  theirs: z.array(LockRecord),
});
const lockArguments: Readonly<Record<SetLock["action"], readonly string[]>> = {
  Lock: ["lock"],
  Unlock: ["unlock"],
  ForceUnlock: ["unlock", "--force"],
};

async function readLargeFiles(
  lfs: GitLfs,
  directory: string,
): Promise<LargeFiles> {
  const installed = await lfs.installed();
  const attributes = await readFile(
    join(directory, ".gitattributes"),
    "utf8",
  ).catch(() => "");
  return { installed, patterns: trackedPatterns(attributes) };
}

export function trackedPatterns(attributes: string) {
  return attributes
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([pattern, ...rest]) =>
        pattern !== undefined &&
        !pattern.startsWith("#") &&
        rest.includes("filter=lfs"),
    )
    .flatMap(([pattern]) =>
      pattern !== undefined && isPattern(pattern) ? [pattern] : [],
    );
}

async function readLocks(
  git: GitCommandRunner,
  directory: string,
): Promise<LfsLocks> {
  const output = await runGitLfs(git, directory, [
    "locks",
    "--verify",
    "--json",
  ]);
  const { ours, theirs } = parseLocks(output);
  return [
    ...ours.map((lock) => readLock(lock, true)),
    ...theirs.map((lock) => readLock(lock, false)),
  ];
}

function parseLocks(output: string) {
  try {
    return LockListing.parse(JSON.parse(output));
  } catch {
    throw gitFailed("Failed", "Git LFS returned locks Rebase can't read.");
  }
}

function readLock(
  lock: z.infer<typeof LockRecord>,
  ours: boolean,
): LfsLocks[number] {
  return { path: lock.path, owner: lock.owner?.name ?? "", ours };
}

async function setTracked(command: SetTracked, git: GitCommandRunner) {
  await runGitLfs(git, command.worktreePath, [
    command.tracked ? "track" : "untrack",
    command.pattern,
  ]);
}

async function setLock(command: SetLock, git: GitCommandRunner) {
  try {
    await runGitLfs(git, command.worktreePath, [
      ...lockArguments[command.action],
      "--",
      command.path,
    ]);
  } catch (error) {
    throw isGitFailed(error) &&
      /Not Implemented|not supported/i.test(error.detail)
      ? repositoryRejected(
          "Incompatible",
          "This server doesn't support file locks.",
        )
      : error;
  }
}

export function repositoryLfsFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const api = RepositoryLfsApi;
  return {
    routes: [
      query(api.read, (input) =>
        readLargeFiles(dependencies.lfs, input.worktreePath),
      ),
      query(api.locks, (input, git) => readLocks(git, input.worktreePath)),
      command(
        api.setTracked,
        {
          name: "track large files",
          locks: { worktree: "wait" },
          duringOperation: "block",
        },
        setTracked,
      ),
      command(
        api.download,
        {
          name: "download large files",
          locks: { worktree: "wait" },
          duringOperation: "block",
        },
        (input, git) =>
          downloadLargeFiles(
            git,
            input.worktreePath,
            input.paths,
            input.commits,
          ),
      ),
      command(
        api.setLock,
        { name: "lock", locks: {}, duringOperation: "proceed" },
        setLock,
      ),
    ],
  };
}
