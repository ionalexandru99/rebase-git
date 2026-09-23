import { open } from "node:fs/promises";
import type { RepositoryCommit } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import { historyGit } from "#server/features/repository-history/git/history-git";

const maximumShallowBytes = 4 * 1_048_576;
const maximumShallowOutputBytes = 8 * 1_048_576;

export function readShallowHistoryOids(
  git: GitCommandRunner,
  directory: string,
) {
  return historyGit(
    git,
    directory,
    ["rev-parse", "--path-format=absolute", "--git-path", "shallow"],
    { maxOutputBytes: maximumShallowOutputBytes },
  ).pipe(
    Effect.flatMap((path) =>
      Effect.tryPromise({
        try: async () => {
          const file = await open(path.trim(), "r").catch((error: unknown) => {
            if (
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "ENOENT"
            )
              return undefined;
            throw error;
          });
          if (file === undefined) return [];
          try {
            const buffer = Buffer.alloc(maximumShallowBytes + 1);
            let bytesRead = 0;
            while (bytesRead < buffer.length) {
              const result = await file.read(
                buffer,
                bytesRead,
                buffer.length - bytesRead,
                bytesRead,
              );
              if (result.bytesRead === 0) break;
              bytesRead += result.bytesRead;
            }
            if (bytesRead > maximumShallowBytes)
              throw new Error("Shallow boundary data is too large");
            const oids = buffer
              .subarray(0, bytesRead)
              .toString("utf8")
              .trim()
              .split("\n")
              .filter(Boolean);
            if (
              oids.length > 40_512 ||
              oids.some((oid) => !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(oid))
            )
              throw new Error("Invalid shallow boundary");
            return [...new Set(oids)].sort();
          } finally {
            await file.close();
          }
        },
        catch: historyError,
      }),
    ),
  );
}

export function restoreShallowCommitParents(
  git: GitCommandRunner,
  directory: string,
  commits: readonly RepositoryCommit[],
  shallowOids: ReadonlySet<string>,
): Effect.Effect<readonly RepositoryCommit[], RepositoryHistoryError> {
  const boundaries = commits.filter((commit) => shallowOids.has(commit.oid));
  if (boundaries.length === 0) return Effect.succeed(commits);
  return historyGit(
    git,
    directory,
    [
      "show",
      "--no-patch",
      "--pretty=raw",
      "--no-abbrev",
      "--no-show-signature",
      "--end-of-options",
      ...boundaries.map((commit) => commit.oid),
      "--",
    ],
    { maxOutputBytes: maximumShallowOutputBytes },
  ).pipe(
    Effect.map((output) => {
      const parentsByOid = new Map<string, string[]>();
      let parents: string[] | undefined;
      for (const line of output.split("\n")) {
        const oid = /^commit ([0-9a-f]{40}(?:[0-9a-f]{24})?)$/.exec(line)?.[1];
        if (oid !== undefined) {
          parents = [];
          parentsByOid.set(oid, parents);
          continue;
        }
        const parent = /^parent ([0-9a-f]{40}(?:[0-9a-f]{24})?)$/.exec(
          line,
        )?.[1];
        if (parent !== undefined) parents?.push(parent);
      }
      return commits.map((commit) => {
        const restored = parentsByOid.get(commit.oid);
        return restored === undefined
          ? commit
          : { ...commit, parents: restored };
      });
    }),
  );
}

function historyError(cause: unknown) {
  return new RepositoryHistoryError({
    cause,
    failure: {
      _tag: "GitFailed",
      reason: "Failed",
      detail: "Could not read shallow repository history",
    },
  });
}
