import { readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type CloneRepository,
  type InitializeRepository,
  RepositoryCatalogApi,
  type RepositoryNotCreated,
  type RepositoryPathRejected,
} from "#contracts/repository-catalog/repository-catalog.contract.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  isGitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import type { CommandProgress } from "#server/features/command-progress/command-progress.ts";
import type { RepositoryCatalog } from "#server/features/repository-catalog/repository-catalog.ts";
import {
  downloadLargeFiles,
  type GitLfs,
} from "#server/features/repository-lfs/git-lfs.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import { serverSettingTable } from "#server/persistence/environment-state.schema.ts";

export type RepositoryCreation = ReturnType<typeof createRepositoryCreation>;

const cloneDeadlineMilliseconds = 6 * 60 * 60 * 1_000;
const leftoverRemovalRetryDelay = 100;
const leftoverRemovalRetryCount = 10;

type Destination = "Missing" | "Empty" | "Used" | "File";

export function createRepositoryCreation({
  catalog,
  context,
  git,
  lfs,
  progress,
}: {
  readonly catalog: RepositoryCatalog;
  readonly context: EnvironmentContext;
  readonly git: GitCommandRunner;
  readonly lfs: GitLfs;
  readonly progress: CommandProgress;
}) {
  const defaults = async () => {
    const [cloneFolder, initialBranch] = await Promise.all([
      context
        .read("Could not read the clone folder", (database) =>
          database
            .select({ cloneFolder: serverSettingTable.cloneFolder })
            .from(serverSettingTable)
            .get(),
        )
        .then((row) => row?.cloneFolder ?? homedir()),
      git
        .run({
          directory: homedir(),
          arguments: ["config", "--get", "init.defaultBranch"],
        })
        .then(
          ({ exitCode, stdout }) =>
            exitCode === 0 && stdout.trim() !== "" ? stdout.trim() : "main",
          () => "main",
        ),
    ]);
    return { cloneFolder, initialBranch };
  };

  const remember = (path: string, repositoryId?: string) =>
    catalog.remember(path, repositoryId).catch(() => {
      throw notCreated(
        "GitFailed",
        "Rebase could not open the new repository.",
      );
    });

  return {
    defaults,
    setCloneFolder: async (path: string) => {
      const folder = await existingFolder(path);
      await context.write("Could not save the clone folder", (database) =>
        database
          .insert(serverSettingTable)
          .values({ singleton: 1, cloneFolder: folder })
          .onConflictDoUpdate({
            target: serverSettingTable.singleton,
            set: { cloneFolder: folder },
          }),
      );
    },
    clone: async (
      { repositoryId, url, path }: CloneRepository,
      signal?: AbortSignal,
    ) => {
      const before = await destination(path);
      if (before === "Used" || before === "File")
        throw notCreated("DestinationNotEmpty");
      const report = progress.reporter(
        [repositoryId],
        RepositoryCatalogApi.clone._tag,
      );
      const output = await git
        .run({
          directory: dirname(path),
          arguments: ["clone", "--progress", "--", url, path],
          environment: { GIT_LFS_SKIP_SMUDGE: "1" },
          progress: report,
          timeoutMilliseconds: cloneDeadlineMilliseconds,
          ...(signal === undefined ? {} : { signal }),
        })
        .catch(async (error: unknown) => {
          if (signal?.aborted && before === "Missing")
            await removeLeftover(path);
          return rejectAsNotCreated(error);
        });
      if (output.exitCode !== 0) {
        const after = await destination(path);
        throw {
          ...notCreated("GitFailed", withoutCredentials(output.stderr)),
          ...(before === "Missing" && after !== "Missing"
            ? { leftover: path }
            : {}),
        };
      }
      const remembered = await remember(path, repositoryId);
      if (await lfs.installed())
        await downloadLargeFiles(
          {
            ...git,
            run: (command) => git.run({ ...command, progress: report }),
          },
          path,
        ).catch((error: unknown) => {
          throw isGitFailed(error)
            ? notCreated(
                "GitFailed",
                `Cloned, but the large files didn't download. ${error.detail}`,
              )
            : error;
        });
      return remembered;
    },
    initialize: async ({ path, branch }: InitializeRepository) => {
      const target = await destination(path);
      if (target === "File") throw notCreated("MalformedPath");
      const inside = await insideRepository(
        git,
        target === "Missing" ? dirname(path) : path,
      );
      if (inside) throw notCreated("InsideRepository");
      const output = await git
        .run({
          directory: dirname(path),
          arguments: ["init", `--initial-branch=${branch}`, "--", path],
        })
        .catch(rejectAsNotCreated);
      if (output.exitCode !== 0)
        throw notCreated("GitFailed", withoutCredentials(output.stderr));
      return remember(path);
    },
  };
}

async function removeLeftover(path: string) {
  for (let attempt = 0; attempt <= leftoverRemovalRetryCount; attempt += 1) {
    if (attempt > 0) await delay(leftoverRemovalRetryDelay);
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch {}
  }
}

export function withoutCredentials(text: string) {
  return text
    .trim()
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1")
    .slice(0, 2_048);
}

async function destination(path: string): Promise<Destination> {
  if (!validPath(path)) throw notCreated("MalformedPath");
  try {
    const parent = await stat(dirname(path));
    if (!parent.isDirectory()) throw new Error("parent");
    const target = await stat(path).catch((cause: unknown) => {
      if (errorCode(cause) === "ENOENT") return undefined;
      throw cause;
    });
    if (target === undefined) return "Missing";
    if (!target.isDirectory()) return "File";
    return (await readdir(path)).length === 0 ? "Empty" : "Used";
  } catch {
    throw notCreated("MalformedPath");
  }
}

async function insideRepository(git: GitCommandRunner, directory: string) {
  const { exitCode } = await git
    .run({ directory, arguments: ["rev-parse", "--show-toplevel"] })
    .catch(rejectAsNotCreated);
  return exitCode === 0;
}

async function existingFolder(path: string) {
  if (!validPath(path)) throw pathRejected("MalformedPath");
  let folder: string;
  let directory: boolean;
  try {
    folder = await realpath(path);
    directory = (await stat(folder)).isDirectory();
  } catch (cause) {
    throw pathRejected(
      errorCode(cause) === "ENOENT" ? "NotFound" : "InspectionFailed",
    );
  }
  if (!directory) throw pathRejected("NotDirectory");
  return folder;
}

function validPath(path: string) {
  return (
    path.length <= 4_096 &&
    !path.includes("\0") &&
    isAbsolute(path) &&
    dirname(path) !== path
  );
}

function gitNotCreated(failure: GitFailed) {
  return notCreated("GitFailed", withoutCredentials(failure.detail));
}

function rejectAsNotCreated(error: unknown): never {
  throw isGitFailed(error) ? gitNotCreated(error) : error;
}

function notCreated(
  reason: RepositoryNotCreated["reason"],
  detail?: string,
): RepositoryNotCreated {
  return {
    _tag: "RepositoryNotCreated",
    reason,
    ...(detail === undefined || detail === "" ? {} : { detail }),
  };
}

function pathRejected(
  reason: RepositoryPathRejected["reason"],
): RepositoryPathRejected {
  return { _tag: "RepositoryPathRejected", reason };
}

function errorCode(cause: unknown) {
  return typeof cause === "object" && cause !== null && "code" in cause
    ? String(cause.code)
    : undefined;
}
