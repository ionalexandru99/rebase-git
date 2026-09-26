import type { ConflictKind, ConflictSide } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { runRepositoryGit } from "#server/repository/access/index";

export interface StageEntry {
  readonly side: ConflictSide;
  readonly mode: string;
  readonly oid: string;
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

export function readUnmergedEntries(
  git: GitCommandRunner,
  directory: string,
  paths: readonly string[] = [],
) {
  return readStageEntries(git, directory, "--unmerged", paths);
}

export function readResolveUndoEntries(
  git: GitCommandRunner,
  directory: string,
  paths: readonly string[] = [],
) {
  return readStageEntries(git, directory, "--resolve-undo", paths);
}

export function conflictKind(stages: readonly StageEntry[]) {
  return kinds[stages.map((stage) => stage.side).join(",")] ?? "both-modified";
}

export function hasSide(stages: readonly StageEntry[], side: ConflictSide) {
  return stages.some((stage) => stage.side === side);
}

function readStageEntries(
  git: GitCommandRunner,
  directory: string,
  listing: "--unmerged" | "--resolve-undo",
  paths: readonly string[],
) {
  return runRepositoryGit(git, directory, [
    "ls-files",
    listing,
    "-z",
    ...(paths.length === 0 ? [] : ["--", ...paths]),
  ]).pipe(Effect.map(parseStageEntries));
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
