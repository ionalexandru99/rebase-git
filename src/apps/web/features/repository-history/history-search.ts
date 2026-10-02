import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "#contracts/repository-history/repository-history.contract.ts";
import { readCommits } from "#web/features/repository-history/history-database.ts";
import type { HistoryGraph } from "#web/features/repository-history/history-graph.ts";

const maximumScannedCommits = 4_096;
const chunkSize = 256;

export async function searchHistory(
  repository: number,
  graph: HistoryGraph,
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
  let next = decodeCursor(repository, query.text, query.cursor);
  const matches = matchingHistoryMetadata(query.text, refTargets);
  const commits: RepositoryCommit[] = [];
  if (normalizeHistorySearch(query.text) === "") return { commits };
  const newest = graph.newest();
  const end = Math.min(newest.length, next + maximumScannedCommits);
  while (next < end && commits.length < query.limit) {
    signal.throwIfAborted();
    const oids = Array.from(
      newest.subarray(next, Math.min(end, next + chunkSize)),
      (id) => graph.oid(id),
    );
    const chunk = new Map(
      (await readCommits(repository, oids)).map((commit) => [
        commit.oid,
        commit,
      ]),
    );
    signal.throwIfAborted();
    for (const oid of oids) {
      next += 1;
      const commit = chunk.get(oid);
      if (commit !== undefined && matches(commit)) commits.push(commit);
      if (commits.length === query.limit) break;
    }
  }
  return next < newest.length
    ? { commits, cursor: encodeCursor(repository, query.text, next) }
    : { commits };
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

function encodeCursor(repository: number, text: string, next: number) {
  return encodeURIComponent(
    JSON.stringify([4, repository, normalizeHistorySearch(text), next]),
  );
}

function decodeCursor(
  repository: number,
  text: string,
  cursor: string | undefined,
) {
  if (cursor === undefined) return 0;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(cursor));
    if (
      Array.isArray(value) &&
      value.length === 4 &&
      value[0] === 4 &&
      value[1] === repository &&
      value[2] === normalizeHistorySearch(text) &&
      Number.isInteger(value[3]) &&
      value[3] > 0
    )
      return value[3];
  } catch {}
  throw new Error("History search cursor does not match this query");
}
