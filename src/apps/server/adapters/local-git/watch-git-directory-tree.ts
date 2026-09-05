import { type FSWatcher, lstatSync, readdirSync, watch } from "node:fs";
import { join, sep } from "node:path";
import type { RepositoryWatchHandle } from "#server/domain/repository-watcher.contract";

export function watchGitDirectoryTree(
  root: string,
  onChange: () => void,
): RepositoryWatchHandle | undefined {
  const watchers = new Map<string, FSWatcher>();
  const remove = (directory: string) => {
    for (const [path, watcher] of watchers) {
      if (path !== directory && !path.startsWith(`${directory}${sep}`))
        continue;
      watchers.delete(path);
      watcher.close();
    }
  };
  const refreshChild = (path: string, replaced: boolean) => {
    let directory = false;
    try {
      directory = lstatSync(path).isDirectory();
    } catch {}
    if (replaced && watchers.has(path)) remove(path);
    if (directory) attach(path);
    else if (watchers.has(path)) remove(path);
  };
  const refresh = (directory: string) => {
    try {
      const children = new Set(
        readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(directory, entry.name)),
      );
      for (const path of watchers.keys()) {
        if (path.startsWith(`${directory}${sep}`)) {
          const child = path.slice(directory.length + 1).split(sep)[0];
          if (child !== undefined && !children.has(join(directory, child)))
            remove(path);
        }
      }
      for (const child of children) attach(child);
    } catch {
      remove(directory);
    }
  };
  const attach = (directory: string) => {
    if (watchers.has(directory)) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(directory, { persistent: false }, (event, name) => {
        if (watchers.get(directory) !== watcher) return;
        onChange();
        if (name === null) refresh(directory);
        else refreshChild(join(directory, name), event === "rename");
      });
    } catch {
      return;
    }
    watchers.set(directory, watcher);
    watcher.on("error", () => {
      if (watchers.get(directory) === watcher) remove(directory);
    });
    refresh(directory);
  };
  attach(root);
  if (!watchers.has(root)) return undefined;
  return { close: () => remove(root) };
}
