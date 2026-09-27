import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "@rebase/contracts";
import { readCommitChunk } from "#web/features/repository-history/history-database";

const maximumScannedCommits = 4_096;
const chunkSize = 256;

export async function searchHistory(
  repository: number,
  refTargets: readonly RepositoryHistoryRefTarget[],
  query: {
    readonly text: string;
    readonly limit: number;
    readonly cursor?: string;
  },
  signal: AbortSignal,
) {
  if (
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100 ||
    query.text.length > 256
  )
    throw new Error("History search query exceeds its limits");
  let after = decodeCursor(repository, query.text, query.cursor);
  const matches = matchingHistoryMetadata(query.text, refTargets);
  const commits: RepositoryCommit[] = [];
  if (normalizeHistorySearch(query.text) === "") return { commits };
  let scanned = 0;
  while (scanned < maximumScannedCommits && commits.length < query.limit) {
    signal.throwIfAborted();
    const chunk = await readCommitChunk(repository, after, chunkSize);
    signal.throwIfAborted();
    for (const record of chunk) {
      after = record.commit.oid;
      scanned += 1;
      if (matches(record.commit)) commits.push(record.commit);
      if (commits.length === query.limit) break;
    }
    if (chunk.length < chunkSize && commits.length < query.limit)
      return { commits };
  }
  return after === undefined
    ? { commits }
    : { commits, cursor: encodeCursor(repository, query.text, after) };
}

export function matchingHistoryMetadata(
  text: string,
  refs: readonly RepositoryHistoryRefTarget[],
) {
  const words = normalizeHistorySearch(text).split(" ").filter(Boolean);
  const refsByOid = new Map<string, string[]>();
  for (const ref of refs) {
    const names = refsByOid.get(ref.oid) ?? [];
    names.push(ref.name.toLowerCase());
    refsByOid.set(ref.oid, names);
  }
  return (commit: RepositoryCommit) => {
    if (words.length === 0) return false;
    const fields = [
      commit.oid,
      commit.subject,
      commit.author.name,
      commit.author.email,
      ...(refsByOid.get(commit.oid) ?? []),
    ].map((field) => field.toLowerCase());
    return words.every((word) => fields.some((field) => field.includes(word)));
  };
}

function normalizeHistorySearch(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function encodeCursor(repository: number, text: string, oid: string) {
  return encodeURIComponent(
    JSON.stringify([3, repository, normalizeHistorySearch(text), oid]),
  );
}

function decodeCursor(
  repository: number,
  text: string,
  cursor: string | undefined,
) {
  if (cursor === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(cursor));
    if (
      Array.isArray(value) &&
      value.length === 4 &&
      value[0] === 3 &&
      value[1] === repository &&
      value[2] === normalizeHistorySearch(text) &&
      typeof value[3] === "string" &&
      /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value[3])
    )
      return value[3];
  } catch {}
  throw new Error("History search cursor does not match this query");
}
