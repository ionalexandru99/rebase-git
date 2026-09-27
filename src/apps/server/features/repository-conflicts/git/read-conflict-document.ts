import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConflictDocument,
  ConflictPath,
  ConflictRegion,
} from "@rebase/contracts";
import { Effect } from "effect";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands";
import { changeIo } from "#server/features/repository-changes/git/change-failures";
import { scratchDirectory } from "#server/features/repository-changes/git/read-change-diff";
import {
  markerBlocks,
  openRegionLines,
  tokenMarks,
} from "#server/features/repository-conflicts/conflict-regions";
import {
  type ConflictSnapshot,
  conflictFailed,
  requireConflict,
  type StageEntry,
  worktreeText,
} from "#server/features/repository-conflicts/git/conflict-files";
import { binary } from "#server/repository/comparison/build-change-diff";
import { previewByteLimit } from "#server/repository/comparison/read-blobs";

interface StageTexts {
  readonly current: string;
  readonly base: string;
  readonly incoming: string;
}

const textModes = new Set(["100644", "100755"]);

export function readConflictDocument(
  git: GitCommandRunner,
  input: ConflictPath,
) {
  return Effect.gen(function* () {
    const directory = input.worktreePath;
    const snapshot = yield* requireConflict(git, directory, input.path);
    const texts = yield* stageTexts(snapshot);
    const content = yield* documentContent(snapshot);
    const merged = yield* mergeStages(
      git,
      directory,
      texts,
      snapshot.markerSize,
    );
    const regions = markerBlocks(merged, snapshot.markerSize);
    const openLines = openRegionLines(
      regions,
      markerBlocks(content, snapshot.markerSize),
    );
    return {
      file: snapshot.file,
      content,
      regions: regions.map(
        (region, index): ConflictRegion => ({
          id: String(index),
          line: openLines[index] ?? null,
          current: region.current,
          base: region.base,
          incoming: region.incoming,
          marks: {
            current: tokenMarks(region.base, region.current),
            incoming: tokenMarks(region.base, region.incoming),
          },
          open: (openLines[index] ?? null) !== null,
        }),
      ),
    } satisfies ConflictDocument;
  });
}

function stageTexts(snapshot: ConflictSnapshot) {
  const stage = (side: StageEntry["side"]) =>
    snapshot.stages.find((entry) => entry.side === side);
  const current = stage("current");
  const incoming = stage("incoming");
  if (current === undefined || incoming === undefined)
    return Effect.fail(
      conflictFailed(
        "Unsupported",
        "Only files that exist on both sides can be merged line by line.",
      ),
    );
  if (snapshot.stages.some((entry) => !textModes.has(entry.mode)))
    return Effect.fail(
      conflictFailed(
        "Unsupported",
        "Links and submodules can only be resolved as a whole file.",
      ),
    );
  if (snapshot.file.stages.some((entry) => entry.bytes > previewByteLimit))
    return Effect.fail(
      conflictFailed("TooLarge", "This file is too large to merge here."),
    );
  const blobs = [current, stage("base"), incoming].map((entry) =>
    entry === undefined
      ? Buffer.alloc(0)
      : (snapshot.blobs.get(entry.oid)?.content ?? null),
  );
  if (blobs.some((blob) => blob === null || binary(blob)))
    return Effect.fail(
      conflictFailed(
        "Unsupported",
        "Binary files can only be resolved as a whole file.",
      ),
    );
  const [currentText = "", baseText = "", incomingText = ""] = blobs.map(
    (blob) => blob?.toString("utf8") ?? "",
  );
  return Effect.succeed({
    current: currentText,
    base: baseText,
    incoming: incomingText,
  } satisfies StageTexts);
}

function documentContent({ worktree }: ConflictSnapshot) {
  if (worktree.identity === "missing") return Effect.succeed("");
  if (worktree.bytes > previewByteLimit)
    return Effect.fail(
      conflictFailed("TooLarge", "This file is too large to merge here."),
    );
  const text = worktreeText(worktree);
  return text === null
    ? Effect.fail(
        conflictFailed(
          "Unsupported",
          "The working file is not text. Resolve it as a whole file.",
        ),
      )
    : Effect.succeed(text);
}

function mergeStages(
  git: GitCommandRunner,
  directory: string,
  texts: StageTexts,
  markerSize: number,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const scratch = yield* scratchDirectory;
      const files = ["current", "base", "incoming"] as const;
      yield* changeIo(() =>
        Promise.all(
          files.map((side) => writeFile(join(scratch, side), texts[side])),
        ),
      );
      return yield* runRepositoryGit(
        git,
        directory,
        [
          "merge-file",
          "-p",
          "--zdiff3",
          `--marker-size=${markerSize}`,
          ...files.flatMap((side) => ["-L", side]),
          ...files.map((side) => join(scratch, side)),
        ],
        { exitCodes: Array.from({ length: 128 }, (_, count) => count) },
      );
    }),
  );
}
