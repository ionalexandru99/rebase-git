import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";
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
  isGitFailed,
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

export async function listWorktreeFolder(
  git: GitCommandRunner,
  { worktreePath, folder }: ListWorktreeFolder,
) {
  const target = await folderPath(worktreePath, folder);
  const entries = await changeIo(() => readFolder(target));
  const listed = entries.slice(0, maximumFolderEntries);
  const ignored = await ignoredNames(
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
}

export async function readWorktreeFile(
  git: GitCommandRunner,
  { worktreePath, path }: ReadWorktreeFile,
): Promise<WorktreeFile> {
  const target = await safeChangePath(worktreePath, path);
  const kind = await changeIo(() => entryKind(target));
  if (kind === undefined || kind === "folder") return { _tag: "Missing" };
  if (kind === "symlink")
    return {
      _tag: "Symlink",
      target: (await changeIo(() => readlink(target))).slice(0, 4_096),
    };
  if (kind === "submodule")
    return {
      _tag: "Submodule",
      oid: await submoduleOid(git, worktreePath, path),
    };
  return changeIo(() => readText(target));
}

export async function searchWorktreeNames(
  git: GitCommandRunner,
  { worktreePath, query }: SearchWorktree,
) {
  const needle = query.trim().toLowerCase();
  const paths = new Set<string>();
  for await (const path of splitRecords(
    streamRepositoryGit(git, worktreePath, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ]),
    "\0",
  ))
    if (
      path !== "" &&
      !path.endsWith("/") &&
      path.toLowerCase().includes(needle)
    )
      paths.add(path);
  const ranked = [...paths]
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
}

export async function searchWorktreeText(
  git: GitCommandRunner,
  { worktreePath, query }: SearchWorktree,
) {
  const matches: WorktreeTextMatch[] = [];
  try {
    for await (const line of splitRecords(
      streamRepositoryGit(git, worktreePath, [
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
      ]),
      /\r?\n|\r/,
    )) {
      const match = parseMatch(line);
      if (match === undefined) continue;
      matches.push(match);
      if (matches.length > maximumSearchResults) break;
    }
  } catch (error) {
    if (!isGitFailed(error) || error.exitCode !== 1) throw error;
  }
  return {
    matches: matches.slice(0, maximumSearchResults),
    complete: matches.length <= maximumSearchResults,
  };
}

async function folderPath(worktreePath: string, folder: string) {
  if (folder === "") return changeIo(() => realpath(worktreePath));
  const target = await safeChangePath(worktreePath, folder);
  if ((await changeIo(() => entryKind(target))) !== "folder")
    throw repositoryRejected("Missing", "The folder is no longer there.");
  return target;
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

async function ignoredNames(
  git: GitCommandRunner,
  worktreePath: string,
  folder: string,
  names: readonly string[],
) {
  if (names.length === 0) return new Set<string>();
  const prefix = folder === "" ? "./" : `./${folder}/`;
  const output = await runRepositoryGit(
    git,
    worktreePath,
    ["check-ignore", "-z", "--stdin"],
    {
      input: names.map((name) => `${prefix}${name}\0`).join(""),
      exitCodes: [0, 1],
      literalPathspecs: false,
    },
  );
  return new Set(
    output
      .split("\0")
      .filter(Boolean)
      .map((path) => path.slice(prefix.length)),
  );
}

async function submoduleOid(
  git: GitCommandRunner,
  worktreePath: string,
  path: string,
) {
  const output = await runRepositoryGit(git, worktreePath, [
    "ls-files",
    "-s",
    "-z",
    "--",
    path,
  ]);
  const [mode, oid] = output.split(" ");
  return mode === "160000" && oid !== undefined ? oid : null;
}

async function* splitRecords(
  chunks: AsyncIterable<string>,
  separator: string | RegExp,
) {
  let pending = "";
  for await (const chunk of chunks) {
    const parts = (pending + chunk).split(separator);
    pending = parts.pop() ?? "";
    yield* parts;
  }
  if (pending !== "") yield pending;
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
