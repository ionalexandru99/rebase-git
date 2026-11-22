import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import {
  diffByteLimit,
  previewByteLimit,
} from "#server/repository/comparison/read-blobs.ts";
import type { RepositoryFileContent } from "#server/repository/comparison/read-object-file.ts";

export function safeChangePath(directory: string, path: string) {
  return changeIo(async () => {
    if (
      isAbsolute(path) ||
      path.includes("\0") ||
      path
        .split(/[\\/]/)
        .some((part) => part === ".." || part.toLowerCase() === ".git")
    )
      throw new Error("Invalid changed-file path.");
    const target = resolve(directory, path);
    const root = await realpath(directory);
    let parent = dirname(target);
    while (true) {
      try {
        parent = await realpath(parent);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const next = dirname(parent);
        if (next === parent) throw error;
        parent = next;
      }
    }
    const inside = relative(root, parent);
    if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`))
      throw new Error("The file is outside this worktree.");
    return target;
  });
}

export async function worktreeFile(directory: string, path: string) {
  const target = await safeChangePath(directory, path);
  return changeIo(async (): Promise<RepositoryFileContent> => {
    const info = await lstat(target).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (info === null)
      return { content: null, bytes: 0, mode: "0", identity: "missing" };
    const mode = info.isSymbolicLink()
      ? "120000"
      : info.isDirectory()
        ? "160000"
        : info.mode & 0o111
          ? "100755"
          : "100644";
    const content =
      mode === "160000" || info.size > diffByteLimit
        ? null
        : mode === "120000"
          ? Buffer.from(await readlink(target))
          : await readFile(target);
    return {
      content,
      bytes: info.size,
      mode,
      identity: `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.mode}`,
    };
  });
}

export function worktreeIdentities(
  directory: string,
  paths: readonly string[],
) {
  return changeIo(() =>
    mapConcurrently(paths, async (path) => {
      const info = await lstat(join(directory, path)).catch(() => null);
      return `${path}:${info?.size}:${info?.mtimeMs}:${info?.ctimeMs}:${info?.mode}`;
    }),
  );
}

export function worktreeLineCounts(
  directory: string,
  paths: readonly string[],
) {
  return changeIo(() =>
    mapConcurrently(paths, async (path) => {
      const target = join(directory, path);
      const info = await lstat(target).catch(() => null);
      if (!info?.isFile() || info.size > previewByteLimit) return null;
      const content = await readFile(target).catch(() => null);
      if (content === null || content.includes(0)) return null;
      let added = content.length > 0 && content.at(-1) !== 10 ? 1 : 0;
      for (
        let index = content.indexOf(10);
        index >= 0;
        index = content.indexOf(10, index + 1)
      )
        added++;
      return { added, removed: 0 };
    }),
  );
}

export async function mapConcurrently<Item, Value>(
  items: readonly Item[],
  read: (item: Item) => Promise<Value>,
) {
  const values: Value[] = new Array(items.length);
  let next = 0;
  const work = async () => {
    while (next < items.length) {
      const index = next++;
      values[index] = await read(items[index] as Item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, items.length) }, work));
  return values;
}
