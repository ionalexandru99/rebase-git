import { lstatSync, realpathSync, type WatchEventType, watch } from "node:fs";
import { join, relative, sep } from "node:path";
import { Effect } from "effect";
import type { RepositoryChangeKind } from "#contracts/environment-connection/environment-rpc.contract.ts";
import {
  reportWatchLimit,
  watchGitDirectoryTree,
} from "#server/adapters/local-git/watch-git-directory-tree.ts";

export interface RepositoryWatchHandle {
  readonly close: () => void;
}

export interface RepositoryWatchListener {
  readonly changed: (kind: RepositoryChangeKind) => void;
  readonly failed: (detail: string) => void;
}

export interface RepositoryWatcher {
  readonly watch: (
    gitDirectory: string,
    listener: RepositoryWatchListener,
  ) => Effect.Effect<RepositoryWatchHandle>;
}

const watchedRootEntries = new Set([
  "HEAD",
  "packed-refs",
  "shallow",
  "refs",
  "worktrees",
  "logs",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge",
  "rebase-apply",
  "sequencer",
]);
const recursiveEntries = ["refs", "worktrees"] as const;
const separatelyWatchedEntries = new Set<string>([...recursiveEntries, "logs"]);
const stashLogs = new Set(["refs", "refs/stash", "refs/stash.lock"]);
const watchGitDirectory =
  process.platform === "darwin" || process.platform === "win32"
    ? watchGitDirectoryRecursively
    : watchGitEntriesSeparately;

export function createLocalRepositoryWatcher(): RepositoryWatcher {
  const directories = new Map<string, WatchedDirectory>();
  return {
    watch: (gitDirectory, listener) =>
      Effect.sync(() => {
        let canonical: string;
        try {
          canonical = realpathSync.native(gitDirectory);
        } catch {
          return { close: () => {} };
        }
        const owned = directories.get(canonical) ?? watchDirectory(canonical);
        directories.set(canonical, owned);
        const own = { ...listener };
        owned.listeners.add(own);
        if (owned.failure !== undefined) own.failed(owned.failure);
        return {
          close: () => {
            if (!owned.listeners.delete(own)) return;
            if (owned.listeners.size > 0) return;
            directories.delete(canonical);
            owned.handle.close();
          },
        };
      }),
  };
}

interface WatchedDirectory {
  readonly listeners: Set<RepositoryWatchListener>;
  handle: RepositoryWatchHandle;
  failure?: string;
}

function watchDirectory(gitDirectory: string) {
  const directory: WatchedDirectory = {
    listeners: new Set(),
    handle: { close: () => {} },
  };
  directory.handle = watchGitDirectory(gitDirectory, {
    changed: (kind) => {
      for (const current of directory.listeners) current.changed(kind);
    },
    failed: (detail) => {
      directory.failure ??= detail;
      for (const current of directory.listeners) current.failed(detail);
    },
  });
  return directory;
}

function watchGitDirectoryRecursively(
  gitDirectory: string,
  { changed: onChange, failed }: RepositoryWatchListener,
): RepositoryWatchHandle {
  try {
    const watcher = watch(
      gitDirectory,
      { persistent: false, recursive: true },
      (event, fileName) => {
        if (fileName === null) return onChange("Refs");
        const kind = gitDirectoryChange(fileName.split(sep));
        if (kind === undefined) return;
        if (event === "change" && isDirectory(join(gitDirectory, fileName)))
          return;
        onChange(kind);
      },
    );
    watcher.on("error", (error) => {
      watcher.close();
      reportWatchLimit(error, failed);
    });
    return watcher;
  } catch (error) {
    reportWatchLimit(error, failed);
    return { close: () => {} };
  }
}

function gitDirectoryChange([entry, ...nested]: readonly string[]):
  | RepositoryChangeKind
  | undefined {
  if (entry === undefined) return undefined;
  if (nested.length === 0) {
    if (entry === "index") return "Index";
    return watchedRootEntries.has(entry) ? "Refs" : undefined;
  }
  if (entry === "refs") return "Refs";
  if (entry === "worktrees") return worktreeChange(nested);
  if (entry === "logs" && stashLogs.has(nested.join("/"))) return "Refs";
  return undefined;
}

function isDirectory(path: string) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function watchGitEntriesSeparately(
  gitDirectory: string,
  { changed: onChange, failed }: RepositoryWatchListener,
): RepositoryWatchHandle {
  const watchers = new Map<string, RepositoryWatchHandle>();
  const watchRecursively = (entry: (typeof recursiveEntries)[number]) => {
    if (watchers.has(entry)) return;
    const watcher = tryWatch(join(gitDirectory, entry), true, failed, (path) =>
      onChange(
        entry === "worktrees" ? worktreeChange(path?.split(sep) ?? []) : "Refs",
      ),
    );
    if (watcher !== undefined) watchers.set(entry, watcher);
  };
  const removeWatcher = (entry: string) => {
    watchers.get(entry)?.close();
    watchers.delete(entry);
  };
  const watchStashes = (replace?: "logs" | "logs/refs") => {
    if (replace === "logs") removeWatcher("logs");
    if (replace !== undefined) removeWatcher("logs/refs");
    if (!watchers.has("logs")) {
      const logs = tryWatch(
        join(gitDirectory, "logs"),
        false,
        failed,
        (fileName, event) => {
          if (
            fileName === undefined ||
            (fileName === "refs" && event === "rename")
          ) {
            watchStashes("logs/refs");
            onChange("Refs");
          }
        },
      );
      if (logs !== undefined) watchers.set("logs", logs);
    }
    if (!watchers.has("logs/refs")) {
      const refs = tryWatch(
        join(gitDirectory, "logs", "refs"),
        false,
        failed,
        (fileName) => {
          if (
            fileName === undefined ||
            fileName === "stash" ||
            fileName === "stash.lock"
          )
            onChange("Refs");
        },
      );
      if (refs !== undefined) watchers.set("logs/refs", refs);
    }
  };
  const root = tryWatch(gitDirectory, false, failed, (fileName, event) => {
    if (fileName === "index") {
      onChange("Index");
      return;
    }
    if (fileName !== undefined && !watchedRootEntries.has(fileName)) return;
    if (
      event === "change" &&
      fileName !== undefined &&
      separatelyWatchedEntries.has(fileName)
    )
      return;
    for (const entry of recursiveEntries)
      if (fileName === undefined || fileName === entry) {
        removeWatcher(entry);
        watchRecursively(entry);
      }
    if (fileName === undefined || fileName === "logs") watchStashes("logs");
    onChange("Refs");
  });
  if (root !== undefined) watchers.set(".", root);
  for (const entry of recursiveEntries) watchRecursively(entry);
  watchStashes();

  return {
    close: () => {
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}

function worktreeChange([
  ,
  file,
  ...nested
]: readonly string[]): RepositoryChangeKind {
  return nested.length === 0 &&
    file !== undefined &&
    (file === "index" || file.startsWith("index."))
    ? "Index"
    : "Refs";
}

function tryWatch(
  path: string,
  recursive: boolean,
  failed: (detail: string) => void,
  listener: (name: string | undefined, event?: WatchEventType) => void,
) {
  try {
    if (recursive) {
      const root = realpathSync.native(path);
      return watchGitDirectoryTree(
        root,
        (changed) =>
          listener(changed === undefined ? undefined : relative(root, changed)),
        failed,
      );
    }
    const watcher = watch(
      realpathSync.native(path),
      { persistent: false, recursive },
      (event, fileName) =>
        listener(fileName === null ? undefined : fileName, event),
    );
    watcher.on("error", (error) => {
      watcher.close();
      reportWatchLimit(error, failed);
    });
    return watcher;
  } catch (error) {
    reportWatchLimit(error, failed);
    return undefined;
  }
}
