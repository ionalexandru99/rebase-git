import { realpathSync, type WatchEventType, watch } from "node:fs";
import { join, relative, sep } from "node:path";
import type { RepositoryChangeKind } from "@rebase/contracts";
import { Effect, Layer } from "effect";
import { watchGitDirectoryTree } from "#server/adapters/local-git/watch-git-directory-tree";
import {
  type RepositoryWatcher,
  type RepositoryWatchHandle,
  RepositoryWatching,
} from "#server/domain/repository-watcher.contract";

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

export function createLocalRepositoryWatcher(): RepositoryWatcher {
  const directories = new Map<
    string,
    {
      readonly handle: RepositoryWatchHandle;
      readonly listeners: Set<(kind: RepositoryChangeKind) => void>;
    }
  >();
  return {
    watch: (gitDirectory, onChange) =>
      Effect.sync(() => {
        let canonical: string;
        try {
          canonical = realpathSync.native(gitDirectory);
        } catch {
          return { close: () => {} };
        }
        let directory = directories.get(canonical);
        if (directory === undefined) {
          const listeners = new Set<(kind: RepositoryChangeKind) => void>();
          directory = {
            listeners,
            handle: watchGitDirectory(canonical, (kind) => {
              for (const listener of listeners) listener(kind);
            }),
          };
          directories.set(canonical, directory);
        }
        const owned = directory;
        const listener = (kind: RepositoryChangeKind) => onChange(kind);
        owned.listeners.add(listener);
        return {
          close: () => {
            if (!owned.listeners.delete(listener)) return;
            if (owned.listeners.size > 0) return;
            directories.delete(canonical);
            owned.handle.close();
          },
        };
      }),
  };
}

export const localRepositoryWatcherLayer = Layer.sync(
  RepositoryWatching,
  createLocalRepositoryWatcher,
);

function watchGitDirectory(
  gitDirectory: string,
  onChange: (kind: RepositoryChangeKind) => void,
): RepositoryWatchHandle {
  const watchers = new Map<string, RepositoryWatchHandle>();
  const watchRecursively = (entry: (typeof recursiveEntries)[number]) => {
    if (watchers.has(entry)) return;
    const watcher = tryWatch(join(gitDirectory, entry), true, (path) =>
      onChange(entry === "worktrees" ? worktreeChange(path) : "Refs"),
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
  const root = tryWatch(gitDirectory, false, (fileName, event) => {
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

function worktreeChange(path: string | undefined): RepositoryChangeKind {
  const [, file, ...nested] = path?.split(sep) ?? [];
  return nested.length === 0 &&
    file !== undefined &&
    (file === "index" || file.startsWith("index."))
    ? "Index"
    : "Refs";
}

function tryWatch(
  path: string,
  recursive: boolean,
  listener: (name: string | undefined, event?: WatchEventType) => void,
) {
  try {
    if (recursive) {
      const root = realpathSync.native(path);
      return watchGitDirectoryTree(root, (changed) =>
        listener(changed === undefined ? undefined : relative(root, changed)),
      );
    }
    const watcher = watch(
      realpathSync.native(path),
      { persistent: false, recursive },
      (event, fileName) =>
        listener(fileName === null ? undefined : fileName, event),
    );
    watcher.on("error", () => watcher.close());
    return watcher;
  } catch {
    return undefined;
  }
}
