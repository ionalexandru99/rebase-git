import { open } from "node:fs/promises";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import {
  type GitCommandRunner,
  isGitObjectId,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { historyFailed } from "#server/features/repository-history/git/history-failures.ts";

const maximumShallowBytes = 4 * 1_048_576;
const maximumShallowOutputBytes = 8 * 1_048_576;

export async function readShallowHistoryOids(shallowFile: string) {
  try {
    return await readShallowFile(shallowFile);
  } catch {
    throw historyFailed("Could not read shallow repository history");
  }
}

async function readShallowFile(shallowFile: string) {
  const file = await open(shallowFile, "r").catch((error: unknown) => {
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
    if (oids.length > 40_512 || oids.some((oid) => !isGitObjectId(oid)))
      throw new Error("Invalid shallow boundary");
    return [...new Set(oids)].sort();
  } finally {
    await file.close();
  }
}

export async function restoreShallowCommitParents(
  git: GitCommandRunner,
  directory: string,
  commits: readonly RepositoryCommit[],
  shallowOids: ReadonlySet<string>,
): Promise<readonly RepositoryCommit[]> {
  const boundaries = commits.filter((commit) => shallowOids.has(commit.oid));
  if (boundaries.length === 0) return commits;
  const output = await runRepositoryGit(
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
  );
  const parentsByOid = new Map<string, string[]>();
  let parents: string[] | undefined;
  for (const line of output.split("\n")) {
    const separator = line.indexOf(" ");
    const field = line.slice(0, separator);
    const oid = line.slice(separator + 1);
    if (separator < 0 || !isGitObjectId(oid)) continue;
    if (field === "commit") {
      parents = [];
      parentsByOid.set(oid, parents);
    } else if (field === "parent") parents?.push(oid);
  }
  return commits.map((commit) => {
    const restored = parentsByOid.get(commit.oid);
    return restored === undefined ? commit : { ...commit, parents: restored };
  });
}
