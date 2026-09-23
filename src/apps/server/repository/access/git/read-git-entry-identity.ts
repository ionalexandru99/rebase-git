import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";

export function readGitEntryIdentity(directory: string) {
  return Effect.promise(() =>
    lstat(join(directory, ".git"), { bigint: true }).then(
      (info) =>
        info.isDirectory()
          ? `${info.dev}:${info.ino}:${info.birthtimeNs}`
          : `${info.dev}:${info.ino}:${info.ctimeNs}`,
      () => undefined,
    ),
  );
}
