import { Effect, Stream } from "effect";
import type { EnvironmentRpc } from "#contracts/environment-connection/environment-rpc.contract.ts";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import {
  type CodeMatch,
  type CodeSearchUpdate,
  maximumCodeMatches,
  type SearchCode,
} from "#contracts/history-search/history-search.contract.ts";
import type {
  EnvironmentFeature,
  EnvironmentRpcHandlersFor,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  type GitFailed,
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
    routes: [],
    rpc: (): Pick<
      EnvironmentRpcHandlersFor<typeof EnvironmentRpc>,
      "repositories/history/code-search"
    > => ({
      "repositories/history/code-search": (input) =>
        Stream.unwrap(
          access.requireWorktree(input).pipe(
            Effect.catchTag("EnvironmentStorageError", Effect.die),
            Effect.andThen(listCommits(git, input)),
            Effect.map((oids) => searchCommits(git, input, oids)),
          ),
        ).pipe(Stream.mapError(rejected)),
    }),
  };
}

function listCommits(
  git: GitCommandRunner,
  { worktreePath, roots, path }: SearchCode,
) {
  return runRepositoryGit(
    git,
    worktreePath,
    ["rev-list", "--stdin", "--", ...(path === undefined ? [] : [path])],
    {
      input: `${roots.join("\n")}\n`,
      maxOutputBytes: 64 * 1_048_576,
      timeoutMilliseconds: searchTimeoutMilliseconds,
    },
  ).pipe(Effect.map((output) => output.split("\n").filter(Boolean)));
}

function searchCommits(
  git: GitCommandRunner,
  { worktreePath, text, path }: SearchCode,
  oids: readonly string[],
): Stream.Stream<CodeSearchUpdate, GitFailed> {
  if (oids.length === 0) return Stream.make(finished);
  const parser = createCodeMatchParser();
  return streamRepositoryGit(
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
    },
  ).pipe(
    Stream.map((chunk) => parser.accept(chunk)),
    Stream.concat(Stream.sync(() => parser.finish())),
    Stream.flattenIterable,
    Stream.takeUntil((update) => update === finished),
  );
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

function rejected(failure: RepositoryRejected | GitFailed) {
  return failure._tag === "GitFailed"
    ? repositoryRejected("GitFailed", failure.detail)
    : failure;
}
