import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "#contracts/repository-history/repository-history.contract.ts";
import { readCommits } from "#web/features/repository-history/history-database.ts";
import type { HistoryGraph } from "#web/features/repository-history/history-graph.ts";

const maximumScannedCommits = 4_096;
const chunkSize = 1_024;
const maximumCachedCommits = 16_384;

interface CachedSearchCommit {
  readonly commit: RepositoryCommit;
  readonly oid: string;
  readonly subject: string;
  readonly authorName: string;
  readonly authorEmail: string;
}

const searchCache = new WeakMap<
  HistoryGraph,
  Map<number, CachedSearchCommit>
>();

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
  const after = decodeCursor(repository, query.text, query.cursor);
  const matcher = createSearchMatcher(query.text, refTargets);
  const commits: RepositoryCommit[] = [];
  if (matcher === undefined) return { commits };
  const newest = graph.newest();
  let next = resumePosition(graph, newest, after);
  const end = Math.min(newest.length, next + maximumScannedCommits);
  let cache = searchCache.get(graph);
  if (cache === undefined) {
    cache = new Map();
    searchCache.set(graph, cache);
  }
  while (next < end && commits.length < query.limit) {
    signal.throwIfAborted();
    const slice = newest.subarray(next, Math.min(end, next + chunkSize));
    const missingOids: string[] = [];
    const missingIds: number[] = [];
    for (let i = 0; i < slice.length; i += 1) {
      const id = slice[i] as number;
      if (!cache.has(id)) {
        missingIds.push(id);
        missingOids.push(graph.oid(id));
      }
    }
    let fetched: Map<string, CachedSearchCommit> | undefined;
    if (missingOids.length > 0) {
      const loaded = await readCommits(repository, missingOids);
      signal.throwIfAborted();
      fetched = new Map();
      for (const commit of loaded)
        fetched.set(commit.oid, toCachedEntry(commit));
      for (let i = 0; i < missingIds.length; i += 1) {
        if (cache.size >= maximumCachedCommits) break;
        const id = missingIds[i] as number;
        const entry = fetched.get(missingOids[i] as string);
        if (entry !== undefined) cache.set(id, entry);
      }
    }
    for (let i = 0; i < slice.length; i += 1) {
      next += 1;
      const id = slice[i] as number;
      const entry = cache.get(id) ?? fetched?.get(graph.oid(id));
      if (entry !== undefined && matcher(entry)) commits.push(entry.commit);
      if (commits.length === query.limit) break;
    }
  }
  return next < newest.length
    ? {
        commits,
        cursor: encodeCursor(
          repository,
          query.text,
          graph.oid(newest[next - 1] ?? -1),
        ),
      }
    : { commits };
}

interface SearchToken {
  readonly kind: "any" | "author" | "ref";
  readonly value: string;
}

function toCachedEntry(commit: RepositoryCommit): CachedSearchCommit {
  return {
    commit,
    oid: commit.oid.toLowerCase(),
    subject: commit.subject.toLowerCase(),
    authorName: commit.author.name.toLowerCase(),
    authorEmail: commit.author.email.toLowerCase(),
  };
}

function parseSearchTokens(text: string): readonly SearchToken[] {
  const words = normalizeHistorySearch(text).split(" ").filter(Boolean);
  const tokens: SearchToken[] = [];
  for (const word of words) {
    if (word.startsWith("author:") && word.length > "author:".length) {
      tokens.push({ kind: "author", value: word.slice("author:".length) });
    } else if (word.startsWith("ref:") && word.length > "ref:".length) {
      tokens.push({ kind: "ref", value: word.slice("ref:".length) });
    } else {
      tokens.push({ kind: "any", value: word });
    }
  }
  return tokens;
}

function createSearchMatcher(
  text: string,
  refs: readonly RepositoryHistoryRefTarget[],
) {
  const tokens = parseSearchTokens(text);
  if (tokens.length === 0) return undefined;
  const refsByOid = new Map<string, string[]>();
  for (const ref of refs) {
    const names = refsByOid.get(ref.oid) ?? [];
    names.push(ref.name.toLowerCase());
    refsByOid.set(ref.oid, names);
  }
  return (entry: CachedSearchCommit) => {
    const refNames = refsByOid.get(entry.commit.oid);
    for (const token of tokens) {
      if (token.kind === "author") {
        if (
          !entry.authorName.includes(token.value) &&
          !entry.authorEmail.includes(token.value)
        )
          return false;
      } else if (token.kind === "ref") {
        if (
          refNames === undefined ||
          !refNames.some((name) => name.includes(token.value))
        )
          return false;
      } else if (
        !entry.subject.includes(token.value) &&
        !entry.authorName.includes(token.value) &&
        !entry.authorEmail.includes(token.value) &&
        !entry.oid.includes(token.value) &&
        !refNames?.some((name) => name.includes(token.value))
      ) {
        return false;
      }
    }
    return true;
  };
}

function normalizeHistorySearch(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function resumePosition(
  graph: HistoryGraph,
  newest: Int32Array,
  after: string | undefined,
) {
  if (after === undefined) return 0;
  const position = newest.indexOf(graph.id(after) ?? -1);
  if (position < 0)
    throw new Error("History search cursor does not match this query");
  return position + 1;
}

function encodeCursor(repository: number, text: string, oid: string) {
  return encodeURIComponent(
    JSON.stringify([4, repository, normalizeHistorySearch(text), oid]),
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
      value[0] === 4 &&
      value[1] === repository &&
      value[2] === normalizeHistorySearch(text) &&
      typeof value[3] === "string" &&
      /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value[3])
    )
      return value[3];
  } catch {}
  throw new Error("History search cursor does not match this query");
}
