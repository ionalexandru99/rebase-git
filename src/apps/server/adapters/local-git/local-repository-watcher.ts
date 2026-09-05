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
  return {
    watch: (gitDirectory, onChange) =>
      Effect.sync(() => watchGitDirectory(gitDirectory, onChange)),
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
    if (fileName === "refs" || fileName === "worktrees") {
      removeWatcher(fileName);
      watchRecursively(fileName);
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
