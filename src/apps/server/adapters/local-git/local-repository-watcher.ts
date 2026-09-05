import { realpathSync, watch } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { watchGitDirectoryTree } from "#server/adapters/local-git/watch-git-directory-tree";
import type {
  RepositoryWatcher,
  RepositoryWatchHandle,
} from "#server/domain/repository-watcher.contract";

const watchedRootEntries = new Set([
  "HEAD",
  "packed-refs",
  "shallow",
  "refs",
  "worktrees",
  "logs",
]);
const recursiveEntries = ["refs", "worktrees"] as const;

export function createLocalRepositoryWatcher(): RepositoryWatcher {
  const directories = new Map<
    string,
    {
      readonly handle: RepositoryWatchHandle;
      readonly listeners: Set<() => void>;
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
          const listeners = new Set<() => void>();
          directory = {
            listeners,
            handle: watchGitDirectory(canonical, () => {
              for (const listener of listeners) listener();
            }),
          };
          directories.set(canonical, directory);
        }
        const owned = directory;
        const listener = () => onChange();
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

function watchGitDirectory(
  gitDirectory: string,
  onChange: () => void,
): RepositoryWatchHandle {
  const watchers = new Map<string, RepositoryWatchHandle>();
  const watchRecursively = (entry: (typeof recursiveEntries)[number]) => {
    if (watchers.has(entry)) return;
    const watcher = tryWatch(join(gitDirectory, entry), true, () => onChange());
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
      const logs = tryWatch(join(gitDirectory, "logs"), false, (fileName) => {
        if (fileName === undefined || fileName === "refs") {
          watchStashes("logs/refs");
          onChange();
        }
      });
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
            onChange();
        },
      );
      if (refs !== undefined) watchers.set("logs/refs", refs);
    }
  };
  const root = tryWatch(gitDirectory, false, (fileName) => {
    if (fileName !== undefined && !watchedRootEntries.has(fileName)) return;
    for (const entry of recursiveEntries)
      if (fileName === undefined || fileName === entry) {
        removeWatcher(entry);
        watchRecursively(entry);
      }
    if (fileName === undefined || fileName === "logs") watchStashes("logs");
    onChange();
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

function tryWatch(
  path: string,
  recursive: boolean,
  listener: (fileName: string | undefined) => void,
) {
  try {
    if (recursive)
      return watchGitDirectoryTree(realpathSync.native(path), () =>
        listener(undefined),
      );
    const watcher = watch(
      realpathSync.native(path),
      { persistent: false, recursive },
      (_, fileName) => listener(fileName === null ? undefined : fileName),
    );
    watcher.on("error", () => watcher.close());
    return watcher;
  } catch {
    return undefined;
  }
}
