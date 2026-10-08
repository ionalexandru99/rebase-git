import { readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute } from "node:path";
import { Effect } from "effect";
import {
  type CloneRepository,
  type InitializeRepository,
  RepositoryCatalogApi,
  type RepositoryNotCreated,
  type RepositoryPathRejected,
} from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type {
  GitCommandRunner,
  GitFailed,
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
  const defaults = Effect.all(
    {
      cloneFolder: context
        .read("Could not read the clone folder", (database) =>
          database
            .select({ cloneFolder: serverSettingTable.cloneFolder })
            .from(serverSettingTable)
            .get(),
        )
        .pipe(Effect.map((row) => row?.cloneFolder ?? homedir())),
      initialBranch: git
        .run({
          directory: homedir(),
          arguments: ["config", "--get", "init.defaultBranch"],
        })
        .pipe(
          Effect.map(({ exitCode, stdout }) =>
            exitCode === 0 && stdout.trim() !== "" ? stdout.trim() : "main",
          ),
          Effect.orElseSucceed(() => "main"),
        ),
    },
    { concurrency: "unbounded" },
  );

  const remember = (path: string, repositoryId?: string) =>
    catalog
      .remember(path, repositoryId)
      .pipe(
        Effect.mapError(() =>
          notCreated("GitFailed", "Rebase could not open the new repository."),
        ),
      );

  return {
    defaults,
    setCloneFolder: (path: string) =>
      Effect.gen(function* () {
        const folder = yield* existingFolder(path);
        yield* context.write("Could not save the clone folder", (database) =>
          database
            .insert(serverSettingTable)
            .values({ singleton: 1, cloneFolder: folder })
            .onConflictDoUpdate({
              target: serverSettingTable.singleton,
              set: { cloneFolder: folder },
            }),
        );
      }),
    clone: ({ repositoryId, url, path }: CloneRepository) =>
      Effect.gen(function* () {
        const before = yield* destination(path);
        if (before === "Used" || before === "File")
          return yield* Effect.fail(notCreated("DestinationNotEmpty"));
        const report = progress.reporter(
          [repositoryId],
          RepositoryCatalogApi.clone._tag,
        );
        const output = yield* git
          .run({
            directory: dirname(path),
            arguments: ["clone", "--progress", "--", url, path],
            environment: { GIT_LFS_SKIP_SMUDGE: "1" },
            progress: report,
            timeoutMilliseconds: cloneDeadlineMilliseconds,
          })
          .pipe(
            Effect.mapError(gitNotCreated),
            Effect.onInterrupt(() =>
              before === "Missing"
                ? Effect.promise(() =>
                    rm(path, { recursive: true, force: true }),
                  )
                : Effect.void,
            ),
          );
        if (output.exitCode !== 0) {
          const after = yield* destination(path);
          return yield* Effect.fail({
            ...notCreated("GitFailed", withoutCredentials(output.stderr)),
            ...(before === "Missing" && after !== "Missing"
              ? { leftover: path }
              : {}),
          });
        }
        const remembered = yield* remember(path, repositoryId);
        if (yield* lfs.installed)
          yield* downloadLargeFiles(
            {
              ...git,
              run: (command) => git.run({ ...command, progress: report }),
            },
            path,
          ).pipe(
            Effect.mapError(({ detail }) =>
              notCreated(
                "GitFailed",
                `Cloned, but the large files didn't download. ${detail}`,
              ),
            ),
          );
        return remembered;
      }),
    initialize: ({ path, branch }: InitializeRepository) =>
      Effect.gen(function* () {
        const target = yield* destination(path);
        if (target === "File")
          return yield* Effect.fail(notCreated("MalformedPath"));
        const inside = yield* insideRepository(
          git,
          target === "Missing" ? dirname(path) : path,
        );
        if (inside) return yield* Effect.fail(notCreated("InsideRepository"));
        const output = yield* git
          .run({
            directory: dirname(path),
            arguments: ["init", `--initial-branch=${branch}`, "--", path],
          })
          .pipe(Effect.mapError(gitNotCreated));
        if (output.exitCode !== 0)
          return yield* Effect.fail(
            notCreated("GitFailed", withoutCredentials(output.stderr)),
          );
        return yield* remember(path);
      }),
  };
}

export function withoutCredentials(text: string) {
  return text
    .trim()
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1")
    .slice(0, 2_048);
}

function destination(
  path: string,
): Effect.Effect<Destination, RepositoryNotCreated> {
  if (!validPath(path)) return Effect.fail(notCreated("MalformedPath"));
  return Effect.tryPromise({
    try: async (): Promise<Destination> => {
      const parent = await stat(dirname(path));
      if (!parent.isDirectory()) throw new Error("parent");
      const target = await stat(path).catch((cause: unknown) => {
        if (errorCode(cause) === "ENOENT") return undefined;
        throw cause;
      });
      if (target === undefined) return "Missing";
      if (!target.isDirectory()) return "File";
      return (await readdir(path)).length === 0 ? "Empty" : "Used";
    },
    catch: () => notCreated("MalformedPath"),
  });
}

function insideRepository(git: GitCommandRunner, directory: string) {
  return git
    .run({ directory, arguments: ["rev-parse", "--show-toplevel"] })
    .pipe(
      Effect.map(({ exitCode }) => exitCode === 0),
      Effect.mapError(gitNotCreated),
    );
}

function existingFolder(
  path: string,
): Effect.Effect<string, RepositoryPathRejected> {
  if (!validPath(path)) return Effect.fail(pathRejected("MalformedPath"));
  return Effect.tryPromise({
    try: async () => {
      const folder = await realpath(path);
      return { folder, directory: (await stat(folder)).isDirectory() };
    },
    catch: (cause) =>
      pathRejected(
        errorCode(cause) === "ENOENT" ? "NotFound" : "InspectionFailed",
      ),
  }).pipe(
    Effect.flatMap(({ folder, directory }) =>
      directory
        ? Effect.succeed(folder)
        : Effect.fail(pathRejected("NotDirectory")),
    ),
  );
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
