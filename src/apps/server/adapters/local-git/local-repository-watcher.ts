import { type FSWatcher, realpathSync, watch } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import type {
  RepositoryWatcher,
  RepositoryWatchHandle,
} from "#server/domain/repository-watcher.contract";

const watchedRootEntries = new Set([
  "HEAD",
  "packed-refs",
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
  const watchers = new Map<string, FSWatcher>();
  const watchRecursively = (entry: (typeof recursiveEntries)[number]) => {
    if (watchers.has(entry)) return;
    const watcher = tryWatch(join(gitDirectory, entry), true, () => onChange());
    if (watcher !== undefined) watchers.set(entry, watcher);
  };
  const watchStashes = () => {
    if (!watchers.has("logs")) {
      const logs = tryWatch(join(gitDirectory, "logs"), false, (fileName) => {
        if (fileName === undefined || fileName === "refs") watchStashes();
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
      watchers.get(fileName)?.close();
      watchers.delete(fileName);
      watchRecursively(fileName);
    }
    if (fileName === "logs") watchStashes();
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
