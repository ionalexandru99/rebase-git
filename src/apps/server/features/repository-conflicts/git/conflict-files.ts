import { open } from "node:fs/promises";
import type {
  ConflictFailure,
  ConflictFile,
  ConflictKind,
  ConflictSide,
  WholeFileChoice,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import {
  mapConcurrently,
  safeChangePath,
  worktreeFile,
} from "#server/features/repository-changes/git/change-files.ts";
import {
  type ConflictText,
  conflictText,
} from "#server/features/repository-conflicts/git/conflict-text.ts";
import { binary } from "#server/repository/comparison/build-change-diff.ts";
import { fingerprint } from "#server/repository/comparison/fingerprint.ts";
import {
  type GitBlob,
  previewByteLimit,
  readBlobs,
} from "#server/repository/comparison/read-blobs.ts";
import type { RepositoryFileContent } from "#server/repository/comparison/read-object-file.ts";

interface StageEntry {
  readonly side: ConflictSide;
  readonly mode: string;
  readonly oid: string;
}

export interface ConflictSnapshot {
  readonly file: ConflictFile;
  readonly stages: readonly StageEntry[];
  readonly worktree: RepositoryFileContent;
  readonly text: ConflictText | null;
}

interface SnapshotSources {
  readonly markerSizes: ReadonlyMap<string, number>;
  readonly blobs: ReadonlyMap<string, GitBlob>;
}

const sides: Record<string, ConflictSide> = {
  "1": "base",
  "2": "current",
  "3": "incoming",
};

const kinds: Record<string, ConflictKind> = {
  "base,current,incoming": "both-modified",
  "current,incoming": "both-added",
  base: "both-deleted",
  "base,incoming": "deleted-in-current",
  "base,current": "deleted-in-incoming",
  current: "added-in-current",
  incoming: "added-in-incoming",
};

const defaultMarkerSize = 7;
const binarySniffBytes = 8000;
const gitlink = "160000";
const symlink = "120000";

export function conflictFailed(
  reason: ConflictFailure["reason"],
  detail: string,
): ConflictFailure {
  return { _tag: "ConflictFailed", reason, detail: detail.slice(0, 2048) };
}

export async function readUnmergedEntries(
  git: GitCommandRunner,
  directory: string,
  paths: readonly string[] = [],
) {
  return parseStageEntries(
    await runRepositoryGit(git, directory, [
      "ls-files",
      "--unmerged",
      "-z",
      ...(paths.length === 0 ? [] : ["--", ...paths]),
    ]),
  );
}

export async function readConflictSnapshots(
  git: GitCommandRunner,
  directory: string,
  entries: ReadonlyMap<string, readonly StageEntry[]>,
) {
  if (entries.size === 0) return [];
  const sources = await readSnapshotSources(git, directory, entries);
  return mapConcurrently([...entries], ([path, stages]) =>
    readConflictSnapshot(directory, path, stages, sources),
  );
}

export async function requireConflict(
  git: GitCommandRunner,
  directory: string,
  path: string,
  revision?: string,
) {
  const entries = await readUnmergedEntries(git, directory, [path]);
  const stages = entries.get(path);
  if (stages === undefined)
    throw conflictFailed("Missing", "This file is no longer in conflict.");
  const sources = await readSnapshotSources(
    git,
    directory,
    new Map([[path, stages]]),
  );
  const snapshot = await readConflictSnapshot(directory, path, stages, sources);
  if (revision !== undefined && snapshot.file.revision !== revision)
    throw conflictFailed(
      "Stale",
      "The file changed since it was loaded. Review the refreshed conflict.",
    );
  return snapshot;
}

function parseStageEntries(output: string) {
  const entries = new Map<string, StageEntry[]>();
  for (const record of output.split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, oid, stage] = record.slice(0, tab).split(" ");
    const side = sides[stage ?? ""];
    if (tab < 0 || mode === undefined || oid === undefined || !side) continue;
    const path = record.slice(tab + 1);
    entries.set(path, [...(entries.get(path) ?? []), { side, mode, oid }]);
  }
  return entries;
}

async function readSnapshotSources(
  git: GitCommandRunner,
  directory: string,
  entries: ReadonlyMap<string, readonly StageEntry[]>,
): Promise<SnapshotSources> {
  const [markerSizes, blobs] = await Promise.all([
    readMarkerSizes(git, directory, [...entries.keys()]),
    readBlobs(
      git,
      directory,
      [...entries.values()].flatMap((stages) =>
        stages.filter((stage) => stage.mode !== gitlink).map(({ oid }) => oid),
      ),
      previewByteLimit,
    ),
  ]);
  return { markerSizes, blobs };
}

async function readMarkerSizes(
  git: GitCommandRunner,
  directory: string,
  paths: readonly string[],
) {
  const output = await runRepositoryGit(
    git,
    directory,
    ["check-attr", "-z", "--stdin", "conflict-marker-size"],
    { input: paths.map((path) => `${path}\0`).join("") },
  );
  const fields = output.split("\0");
  const sizes = new Map<string, number>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const size = Number(fields[index + 2]);
    if (Number.isSafeInteger(size) && size > 0)
      sizes.set(fields[index] ?? "", size);
  }
  return sizes;
}

async function readConflictSnapshot(
  directory: string,
  path: string,
  stages: readonly StageEntry[],
  sources: SnapshotSources,
) {
  return conflictSnapshot(
    path,
    stages,
    await readConflictWorktree(directory, path),
    sources,
  );
}

async function readConflictWorktree(
  directory: string,
  path: string,
): Promise<RepositoryFileContent> {
  const worktree = await worktreeFile(directory, path);
  if (worktree.content !== null || worktree.mode === gitlink) return worktree;
  if (worktree.identity === "missing") return worktree;
  const target = await safeChangePath(directory, path);
  const content = await changeIo(async () => {
    const file = await open(target, "r");
    try {
      const head = Buffer.alloc(binarySniffBytes);
      const { bytesRead } = await file.read(head, 0, binarySniffBytes, 0);
      return head.subarray(0, bytesRead).includes(0)
        ? null
        : await file.readFile();
    } finally {
      await file.close();
    }
  });
  return { ...worktree, content };
}

function conflictSnapshot(
  path: string,
  stages: readonly StageEntry[],
  worktree: RepositoryFileContent,
  { blobs, markerSizes }: SnapshotSources,
): ConflictSnapshot {
  const markerSize = markerSizes.get(path) ?? defaultMarkerSize;
  const kind =
    kinds[stages.map((stage) => stage.side).join(",")] ?? "both-modified";
  const text =
    worktree.content !== null &&
    worktree.mode !== symlink &&
    !binary(worktree.content)
      ? conflictText(worktree.content, markerSize)
      : null;
  return {
    stages,
    worktree,
    text,
    file: {
      path,
      revision: fingerprint(
        path,
        stages
          .map((stage) => `${stage.side}:${stage.mode}:${stage.oid}`)
          .join(),
        worktree.identity,
      ),
      kind,
      stages: stages.map((stage) => {
        const blob = blobs.get(stage.oid);
        return {
          side: stage.side,
          bytes: blob?.bytes ?? 0,
          binary: binary(blob?.content ?? null),
        };
      }),
      openRegions: text?.blocks.length ?? 0,
      choices: wholeFileChoices(stages, kind),
    },
  };
}

function wholeFileChoices(stages: readonly StageEntry[], kind: ConflictKind) {
  const has = (side: ConflictSide) =>
    stages.some((stage) => stage.side === side);
  const choices: WholeFileChoice[] = [];
  if (has("current")) choices.push("current");
  if (has("incoming")) choices.push("incoming");
  if (kind.startsWith("deleted-in-") || kind === "both-deleted")
    choices.push("delete");
  return choices;
}
