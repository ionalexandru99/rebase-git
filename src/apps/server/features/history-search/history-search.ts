import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type CodeMatch,
  type CodeSearchUpdate,
  HistorySearchApi,
  maximumCodeMatches,
  type SearchCode,
} from "#contracts/history-search/history-search.contract.ts";
import {
  type EnvironmentFeature,
  stream,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  isGitFailed,
  runRepositoryGit,
  streamRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const commitMarker = "\x1e";
const progressMarker = "\x1f";
const recordStart = new RegExp(`(?=[${commitMarker}${progressMarker}])`);
const progressSteps = 100;
const matchBatch = 256;
const searchTimeoutMilliseconds = 30 * 60_000;
const finished: CodeSearchUpdate = { _tag: "CodeSearchProgress", percent: 100 };

export function historySearchFeature({
  access,
  git,
}: {
  readonly access: RepositoryAccess;
  readonly git: GitCommandRunner;
}): EnvironmentFeature {
  return {
    routes: [
      stream(HistorySearchApi.code, (input, { signal }) =>
        searchCode(access, git, input, signal),
      ),
    ],
  };
}

async function* searchCode(
  access: RepositoryAccess,
  git: GitCommandRunner,
  input: SearchCode,
  signal: AbortSignal,
) {
  try {
    await access.requireWorktree(input);
    yield* searchCommits(
      git,
      input,
      await listCommits(git, input, signal),
      signal,
    );
  } catch (error) {
    throw isGitFailed(error)
      ? repositoryRejected("GitFailed", error.detail)
      : error;
  }
}

async function listCommits(
  git: GitCommandRunner,
  { worktreePath, roots, path }: SearchCode,
  signal: AbortSignal,
) {
  const output = await runRepositoryGit(
    git,
    worktreePath,
    ["rev-list", "--stdin", "--", ...(path === undefined ? [] : [path])],
    {
      input: `${roots.join("\n")}\n`,
      maxOutputBytes: 64 * 1_048_576,
      timeoutMilliseconds: searchTimeoutMilliseconds,
      signal,
    },
  );
  return output.split("\n").filter(Boolean);
}

async function* searchCommits(
  git: GitCommandRunner,
  { worktreePath, text, path }: SearchCode,
  oids: readonly string[],
  signal: AbortSignal,
): AsyncGenerator<CodeSearchUpdate> {
  if (oids.length === 0) {
    yield finished;
    return;
  }
  const parser = createCodeMatchParser();
  const chunks = streamRepositoryGit(
    git,
    worktreePath,
    [
      "diff-tree",
      "--stdin",
      "--root",
      "-r",
      "-M",
      "-z",
      "--name-only",
      "--no-ext-diff",
      "--no-textconv",
      `--format=${commitMarker}%H`,
      `-G${escapeRegularExpression(text)}`,
      "--",
      ...(path === undefined ? [] : [path]),
    ],
    {
      input: withProgressMarkers(oids),
      timeoutMilliseconds: searchTimeoutMilliseconds,
      signal,
    },
  );
  for await (const chunk of chunks)
    for (const update of parser.accept(chunk)) {
      yield update;
      if (update === finished) return;
    }
  for (const update of parser.finish()) {
    yield update;
    if (update === finished) return;
  }
}

function withProgressMarkers(oids: readonly string[]) {
  const step = Math.ceil(oids.length / progressSteps);
  return `${oids
    .map((oid, index) =>
      (index + 1) % step === 0 && index + 1 < oids.length
        ? `${oid}\n${progressMarker}${Math.floor(((index + 1) * 100) / oids.length)}\n`
        : `${oid}\n`,
    )
    .join("")}${progressMarker}100\n`;
}

function createCodeMatchParser() {
  let rest = "";
  let found = 0;
  let pending: CodeMatch[] = [];
  const flush = (): CodeSearchUpdate[] => {
    if (pending.length === 0) return [];
    const matches = pending;
    pending = [];
    return [{ _tag: "CodeMatches", matches }];
  };
  const read = (record: string): CodeSearchUpdate[] => {
    if (record.startsWith(progressMarker)) {
      const percent = Number.parseInt(record.slice(1), 10);
      return [
        ...flush(),
        ...(percent === 100
          ? [finished]
          : [{ _tag: "CodeSearchProgress", percent } as const]),
      ];
    }
    const end = record.indexOf("\0");
    if (!record.startsWith(commitMarker) || end < 0) return [];
    found += 1;
    pending.push({
      oid: record.slice(1, end),
      paths: record
        .slice(end + 1)
        .replace(/^\n/, "")
        .split("\0")
        .filter(Boolean),
    });
    if (found >= maximumCodeMatches) return [...flush(), finished];
    return pending.length >= matchBatch ? flush() : [];
  };
  return {
    accept: (chunk: string) => {
      const records = `${rest}${chunk}`.split(recordStart);
      rest = records.pop() ?? "";
      return records.flatMap(read);
    },
    finish: () => {
      const last = rest;
      rest = "";
      return [...read(last), ...flush(), finished];
    },
  };
}

function escapeRegularExpression(text: string) {
  return text.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
}
