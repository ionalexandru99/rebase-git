import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type ListWorktreeFolder,
  maximumFileBytes,
  maximumFolderEntries,
  maximumSearchResults,
  type ReadWorktreeFile,
  type SearchWorktree,
  type WorktreeEntry,
  type WorktreeFile,
  WorktreeFilesApi,
  type WorktreeTextMatch,
} from "#contracts/worktree-files/worktree-files.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  runRepositoryGit,
  streamRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import { safeChangePath } from "#server/features/repository-changes/git/change-files.ts";

const binaryProbeBytes = 8_000;
const matchTextLength = 512;

export function worktreeFilesFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { query } = repositoryRoutes(dependencies);
  return {
    routes: [
      query(WorktreeFilesApi.list, (input, git) =>
        listWorktreeFolder(git, input),
      ),
      query(WorktreeFilesApi.read, (input, git) =>
        readWorktreeFile(git, input),
      ),
      query(WorktreeFilesApi.searchNames, (input, git) =>
        searchWorktreeNames(git, input),
      ),
      query(WorktreeFilesApi.searchText, (input, git) =>
        searchWorktreeText(git, input),
      ),
    ],
  };
}

export function listWorktreeFolder(
  git: GitCommandRunner,
  { worktreePath, folder }: ListWorktreeFolder,
) {
  return Effect.gen(function* () {
    const target = yield* folderPath(worktreePath, folder);
    const entries = yield* changeIo(() => readFolder(target));
    const listed = entries.slice(0, maximumFolderEntries);
    const ignored = yield* ignoredNames(
      git,
      worktreePath,
      folder,
      listed.map((entry) => entry.name),
    );
    return {
      entries: listed.map((entry) => ({
        ...entry,
        ignored: ignored.has(entry.name),
      })),
      complete: entries.length <= maximumFolderEntries,
    };
  });
}

export function readWorktreeFile(
  git: GitCommandRunner,
  { worktreePath, path }: ReadWorktreeFile,
) {
  return Effect.gen(function* () {
    const target = yield* safeChangePath(worktreePath, path);
    const kind = yield* changeIo(() => entryKind(target));
    if (kind === undefined || kind === "folder")
      return { _tag: "Missing" } as const;
    if (kind === "symlink")
      return {
        _tag: "Symlink",
        target: (yield* changeIo(() => readlink(target))).slice(0, 4_096),
      } as const;
    if (kind === "submodule")
      return {
        _tag: "Submodule",
        oid: yield* submoduleOid(git, worktreePath, path),
      } as const;
    return yield* changeIo(() => readText(target));
  });
}

export function searchWorktreeNames(
  git: GitCommandRunner,
  { worktreePath, query }: SearchWorktree,
) {
  const needle = query.trim().toLowerCase();
  return streamRepositoryGit(git, worktreePath, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]).pipe(
    splitRecords("\0"),
    Stream.filter(
      (path) =>
        path !== "" &&
        !path.endsWith("/") &&
        path.toLowerCase().includes(needle),
    ),
    Stream.runCollect,
    Effect.map((paths) => {
      const ranked = [...new Set(paths)]
        .map((path) => ({ path, rank: nameRank(path, needle) }))
        .sort(
          (left, right) =>
            left.rank - right.rank ||
            left.path.length - right.path.length ||
            (left.path < right.path ? -1 : 1),
        );
      return {
        paths: ranked.slice(0, maximumSearchResults).map((match) => match.path),
        complete: ranked.length <= maximumSearchResults,
      };
    }),
  );
}

export function searchWorktreeText(
  git: GitCommandRunner,
  { worktreePath, query }: SearchWorktree,
) {
  return streamRepositoryGit(git, worktreePath, [
    "grep",
    "-z",
    "-n",
    "-I",
    "-F",
    "--untracked",
    "--no-color",
    ...(query === query.toLowerCase() ? ["-i"] : []),
    "-e",
    query,
  ]).pipe(
    Stream.splitLines,
    Stream.map(parseMatch),
    Stream.filter((match) => match !== undefined),
    Stream.take(maximumSearchResults + 1),
    Stream.runCollect,
    Effect.catchIf(noMatches, () => Effect.succeed([])),
    Effect.map((matches) => ({
      matches: matches.slice(0, maximumSearchResults),
      complete: matches.length <= maximumSearchResults,
    })),
  );
}

function folderPath(worktreePath: string, folder: string) {
  return folder === ""
    ? changeIo(() => realpath(worktreePath))
    : Effect.gen(function* () {
        const target = yield* safeChangePath(worktreePath, folder);
        if ((yield* changeIo(() => entryKind(target))) !== "folder")
          return yield* Effect.fail(
            repositoryRejected("Missing", "The folder is no longer there."),
          );
        return target;
      });
}

async function readFolder(target: string) {
  const entries: Omit<WorktreeEntry, "ignored">[] = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const kind = entry.isSymbolicLink()
      ? "symlink"
      : entry.isDirectory()
        ? await folderKind(join(target, entry.name))
        : entry.isFile()
          ? "file"
          : undefined;
    if (kind !== undefined) entries.push({ name: entry.name, kind });
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

async function entryKind(target: string) {
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
    throw error;
  });
  if (info === undefined) return undefined;
  if (info.isSymbolicLink()) return "symlink";
  if (info.isDirectory()) return folderKind(target);
  return info.isFile() ? "file" : undefined;
}

async function folderKind(target: string) {
  const marker = await lstat(join(target, ".git")).catch(() => undefined);
  return marker === undefined ? "folder" : "submodule";
}

async function readText(target: string): Promise<WorktreeFile> {
  const file = await open(target, "r");
  try {
    const { size } = await file.stat();
    const buffer = Buffer.alloc(Math.min(size, maximumFileBytes));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const read = buffer.subarray(0, bytesRead);
    if (read.subarray(0, binaryProbeBytes).includes(0))
      return { _tag: "Binary", bytes: size };
    const truncated = size > read.length;
    const end = truncated ? read.lastIndexOf(10) + 1 : read.length;
    return {
      _tag: "Text",
      contents: read.subarray(0, end > 0 ? end : read.length).toString("utf8"),
      bytes: size,
      truncated,
    };
  } finally {
    await file.close();
  }
}

function ignoredNames(
  git: GitCommandRunner,
  worktreePath: string,
  folder: string,
  names: readonly string[],
) {
  if (names.length === 0) return Effect.succeed(new Set<string>());
  const prefix = folder === "" ? "./" : `./${folder}/`;
  return runRepositoryGit(
    git,
    worktreePath,
    ["check-ignore", "-z", "--stdin"],
    {
      input: names.map((name) => `${prefix}${name}\0`).join(""),
      exitCodes: [0, 1],
      literalPathspecs: false,
    },
  ).pipe(
    Effect.map(
      (output) =>
        new Set(
          output
            .split("\0")
            .filter(Boolean)
            .map((path) => path.slice(prefix.length)),
        ),
    ),
  );
}

function submoduleOid(
  git: GitCommandRunner,
  worktreePath: string,
  path: string,
) {
  return runRepositoryGit(git, worktreePath, [
    "ls-files",
    "-s",
    "-z",
    "--",
    path,
  ]).pipe(
    Effect.map((output) => {
      const [mode, oid] = output.split(" ");
      return mode === "160000" && oid !== undefined ? oid : null;
    }),
  );
}

function splitRecords(separator: string) {
  return <E>(stream: Stream.Stream<string, E>) =>
    stream.pipe(
      Stream.mapAccum(
        () => "",
        (pending, chunk) => {
          const parts = (pending + chunk).split(separator);
          const rest = parts.pop() ?? "";
          return [rest, parts];
        },
        { onHalt: (pending) => (pending === "" ? [] : [pending]) },
      ),
    );
}

function parseMatch(line: string) {
  const [path, number, ...text] = line.split("\0");
  const lineNumber = Number(number);
  if (path === undefined || path === "" || !Number.isInteger(lineNumber))
    return undefined;
  return {
    path,
    line: lineNumber,
    text: text.join("\0").slice(0, matchTextLength),
  } satisfies WorktreeTextMatch;
}

function nameRank(path: string, needle: string) {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  return 3;
}

function noMatches(error: GitFailed) {
  return error.exitCode === 1;
}
