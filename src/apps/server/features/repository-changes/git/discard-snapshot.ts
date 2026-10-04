import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import {
  changesFailed,
  type DiscardedChanges,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import { safeChangePath } from "#server/features/repository-changes/git/change-files.ts";
import { copyIndex } from "#server/features/repository-changes/git/change-index.ts";
import { patchOptions } from "#server/features/repository-changes/git/mutate-changes.ts";

interface TreeEntry {
  readonly mode: string;
  readonly oid: string;
}

type WorktreeEntry = TreeEntry | "missing" | "other";

interface ChangedEntry {
  readonly path: string;
  readonly from: TreeEntry | null;
  readonly to: TreeEntry | null;
}

const blobBytesLimit = 256 * 1_048_576;

export function snapshotChanges(
  git: GitCommandRunner,
  directory: string,
  index: string,
  {
    paths,
    conflicted,
  }: {
    readonly paths: readonly string[];
    readonly conflicted: readonly string[];
  },
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const indexFile = yield* Effect.acquireRelease(
        changeIo(async () => {
          const copy = `${index}.snapshot-${randomUUID()}`;
          await copyIndex(index, copy);
          return copy;
        }),
        (copy) =>
          Effect.promise(() =>
            Promise.all([
              rm(copy, { force: true }),
              rm(`${copy}.lock`, { force: true }),
            ]),
          ),
      );
      const update = (args: readonly string[], lines: readonly string[]) =>
        lines.length === 0
          ? Effect.void
          : runRepositoryGit(git, directory, ["update-index", "-z", ...args], {
              indexFile,
              input: `${lines.join("\0")}\0`,
            });
      const tree = runRepositoryGit(git, directory, ["write-tree"], {
        indexFile,
      }).pipe(Effect.map((oid) => oid.trim()));
      yield* update(["--force-remove", "--stdin"], conflicted);
      const staged = yield* tree;
      const worktree = yield* readWorktree(git, directory, paths);
      yield* update(
        ["--index-info"],
        paths.flatMap((path) => {
          const entry = worktree.get(path);
          if (entry === "other" || entry === undefined) return [];
          return entry === "missing"
            ? [`0 ${"0".repeat(staged.length)}\t${path}`]
            : [`${entry.mode} ${entry.oid}\t${path}`];
        }),
      );
      return { index: staged, worktree: yield* tree };
    }),
  );
}

export function restoreDiscarded(
  git: GitCommandRunner,
  directory: string,
  indexFile: string,
  { before, after }: DiscardedChanges,
) {
  return Effect.gen(function* () {
    const changed = yield* changedEntries(
      git,
      directory,
      after.worktree,
      before.worktree,
    );
    const paths = changed.map((entry) => entry.path);
    for (const path of paths) yield* safeChangePath(directory, path);
    const current = yield* readWorktree(git, directory, paths);
    if (!changed.every(({ path, from }) => same(current.get(path), from)))
      return yield* Effect.fail(changedSinceDiscard());
    const staged = yield* runRepositoryGit(git, directory, [
      "diff",
      ...patchOptions,
      "--no-renames",
      after.index,
      before.index,
      "--",
    ]);
    if (staged.trim() !== "")
      yield* runRepositoryGit(
        git,
        directory,
        ["apply", "--cached", "--whitespace=nowarn"],
        { indexFile, input: staged },
      ).pipe(Effect.mapError(changedSinceDiscard));
    const contents = yield* Effect.forEach(changed, ({ to }) =>
      to === null ? Effect.succeed(null) : readBlob(git, directory, to.oid),
    );
    yield* changeIo(async () => {
      for (const [index, { path, to }] of changed.entries())
        await writeEntry(join(directory, path), to, contents[index] ?? null);
    });
  });
}

function readWorktree(
  git: GitCommandRunner,
  directory: string,
  paths: readonly string[],
) {
  return Effect.gen(function* () {
    const stats = yield* changeIo(() =>
      Promise.all(
        paths.map((path) =>
          lstat(join(directory, path)).catch((error) => {
            const { code } = error as NodeJS.ErrnoException;
            if (code === "ENOENT" || code === "ENOTDIR") return null;
            throw error;
          }),
        ),
      ),
    );
    const files = paths.filter((_, index) => stats[index]?.isFile());
    const fileOids =
      files.length === 0
        ? []
        : (yield* runRepositoryGit(
            git,
            directory,
            ["hash-object", "-w", "--no-filters", "--stdin-paths"],
            { input: `${files.map(quotedLine).join("\n")}\n` },
          ))
            .trim()
            .split("\n");
    const entries = new Map<string, WorktreeEntry>();
    for (const [index, path] of paths.entries()) {
      const stat = stats[index];
      if (stat === null || stat === undefined) entries.set(path, "missing");
      else if (stat.isFile())
        entries.set(path, {
          mode:
            process.platform !== "win32" && (stat.mode & 0o111) !== 0
              ? "100755"
              : "100644",
          oid: fileOids[files.indexOf(path)] ?? "",
        });
      else if (stat.isSymbolicLink()) {
        const target = yield* changeIo(() => readlink(join(directory, path)));
        const oid = yield* runRepositoryGit(
          git,
          directory,
          ["hash-object", "-w", "--stdin"],
          { input: target },
        );
        entries.set(path, { mode: "120000", oid: oid.trim() });
      } else entries.set(path, "other");
    }
    return entries;
  });
}

function changedEntries(
  git: GitCommandRunner,
  directory: string,
  from: string,
  to: string,
) {
  return runRepositoryGit(git, directory, [
    "diff-tree",
    "-r",
    "-z",
    "--no-renames",
    from,
    to,
  ]).pipe(
    Effect.map((output) => {
      const fields = output.split("\0");
      const changed: ChangedEntry[] = [];
      for (let index = 0; index + 1 < fields.length; index += 2) {
        const [fromMode, toMode, fromOid, toOid] = (fields[index] ?? "")
          .slice(1)
          .split(" ");
        const entry = (mode = "", oid = "") =>
          /^0+$/.test(mode) ? null : { mode, oid };
        changed.push({
          path: fields[index + 1] ?? "",
          from: entry(fromMode, fromOid),
          to: entry(toMode, toOid),
        });
      }
      return changed;
    }),
  );
}

function readBlob(git: GitCommandRunner, directory: string, oid: string) {
  return runRepositoryGit(git, directory, ["cat-file", "blob", oid], {
    outputEncoding: "base64",
    maxOutputBytes: blobBytesLimit,
  }).pipe(Effect.map((output) => Buffer.from(output, "base64")));
}

async function writeEntry(
  target: string,
  entry: TreeEntry | null,
  bytes: Buffer | null,
) {
  await rm(target, { force: true });
  if (entry === null || bytes === null) return;
  await mkdir(dirname(target), { recursive: true });
  if (entry.mode === "120000") await symlink(bytes.toString(), target);
  else
    await writeFile(target, bytes, {
      mode: entry.mode === "100755" ? 0o755 : 0o644,
    });
}

function same(current: WorktreeEntry | undefined, expected: TreeEntry | null) {
  if (expected === null) return current === "missing";
  return (
    typeof current === "object" &&
    current.mode === expected.mode &&
    current.oid === expected.oid
  );
}

function quotedLine(path: string) {
  if (!/[\n\r]/.test(path) && !path.startsWith('"')) return path;
  const escaped = path
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
  return `"${escaped}"`;
}

function changedSinceDiscard() {
  return changesFailed(
    "Conflict",
    "These files changed after the discard, so they were not restored.",
  );
}
