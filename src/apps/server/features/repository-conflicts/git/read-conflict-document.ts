import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ConflictDocument,
  ConflictPath,
  ConflictRegion,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { previewByteLimit } from "#server/domain/repository-comparison.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import { changeIo } from "#server/features/repository-changes/git/change-failures";
import { conflictFailed } from "#server/features/repository-conflicts/git/conflict-failures";
import {
  type ConflictSnapshot,
  requireConflict,
  worktreeText,
} from "#server/features/repository-conflicts/git/read-conflict-files";
import {
  readConflictSides,
  sideTreeCommits,
} from "#server/features/repository-conflicts/git/read-conflict-sides";
import { readRegionBlame } from "#server/features/repository-conflicts/git/read-region-blame";
import type { StageEntry } from "#server/features/repository-conflicts/git/stage-entries";
import {
  type MarkerBlock,
  markerBlocks,
  openRegionLines,
  sideLineNumbers,
  splitLines,
} from "#server/features/repository-conflicts/regions/conflict-regions";
import { tokenMarks } from "#server/features/repository-conflicts/regions/token-marks";
import { runRepositoryGit } from "#server/repository/access/index";
import { binary, fingerprint } from "#server/repository/comparison/index";

interface StageTexts {
  readonly current: string;
  readonly base: string;
  readonly incoming: string;
}

const maximumLineLength = 100_000;
const textModes = new Set(["100644", "100755"]);

export function readConflictDocument(
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
  input: ConflictPath,
) {
  return Effect.gen(function* () {
    const directory = input.worktreePath;
    const snapshot = yield* requireConflict(git, directory, input.path);
    const texts = yield* stageTexts(snapshot);
    const content = yield* documentContent(snapshot);
    const operation = yield* coordination.operation(directory);
    const [sides, merged] = yield* Effect.all(
      [
        readConflictSides(git, directory, operation),
        mergeStages(git, directory, texts, snapshot.markerSize),
      ],
      { concurrency: "unbounded" },
    );
    const regions = markerBlocks(merged, snapshot.markerSize);
    if (regions.some(hasOversizedLine))
      return yield* Effect.fail(
        conflictFailed("TooLarge", "A conflicting line is too long to show."),
      );
    const blame = yield* readDocumentBlame(
      git,
      directory,
      input.path,
      sideTreeCommits(operation, sides.commits),
      texts,
      regions,
    );
    const openLines = openRegionLines(
      regions,
      markerBlocks(content, snapshot.markerSize),
    );
    return {
      file: snapshot.file,
      sides: sides.labels,
      content,
      regions: regions.map(
        (region, index): ConflictRegion => ({
          id: regionId(regions, index),
          line: openLines[index] ?? null,
          current: region.current,
          base: region.base,
          incoming: region.incoming,
          blame: {
            current: blame.current[index] ?? null,
            incoming: blame.incoming[index] ?? null,
          },
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

function readDocumentBlame(
  git: GitCommandRunner,
  directory: string,
  path: string,
  commits: Record<"current" | "incoming", string | null>,
  texts: StageTexts,
  regions: readonly MarkerBlock[],
) {
  const blame = (side: "current" | "incoming") =>
    readRegionBlame(
      git,
      directory,
      path,
      commits[side],
      sideLineNumbers(
        splitLines(texts[side]),
        regions.map((region) => region[side]),
      ),
    );
  return Effect.all(
    { current: blame("current"), incoming: blame("incoming") },
    { concurrency: "unbounded" },
  );
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

const scratchDirectory = Effect.acquireRelease(
  changeIo(() => mkdtemp(join(tmpdir(), "rebase-conflict-"))),
  (path) =>
    changeIo(() => rm(path, { recursive: true, force: true })).pipe(
      Effect.ignore,
    ),
);

function regionId(regions: readonly MarkerBlock[], index: number) {
  const texts = (region: MarkerBlock | undefined) =>
    JSON.stringify([region?.current, region?.base, region?.incoming]);
  const key = texts(regions[index]);
  const occurrence = regions
    .slice(0, index)
    .filter((region) => texts(region) === key).length;
  return fingerprint(key, String(occurrence));
}

function hasOversizedLine(region: MarkerBlock) {
  return [region.current, region.base, region.incoming].some((lines) =>
    lines.some((line) => line.length > maximumLineLength),
  );
}
