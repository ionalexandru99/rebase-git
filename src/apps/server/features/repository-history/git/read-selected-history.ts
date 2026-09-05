import type { ReadRepositoryHistory } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import { gitHistoryFormat } from "#server/features/repository-history/git/parse-git-history";

export const maximumHistoryOutputBytes = 8 * 1_048_576;
const maximumParentLineCharacters = 1_048_576;

export function readSelectedHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  request: ReadRepositoryHistory,
) {
  return Effect.gen(function* () {
    const deadline = Date.now() + 30_000;
    const roots = yield* selectedHistoryRoots(
      git,
      repositoryPath,
      request,
      deadline,
    );
    const chunks: string[] = [];
    let bytes = 0;
    yield* streamQuery(
      git,
      repositoryPath,
      [
        "log",
        "--stdin",
        "--first-parent",
        request.order === "topological" ? "--topo-order" : "--date-order",
        "--no-show-signature",
        `--skip=${request.offset ?? 0}`,
        `--max-count=${request.limit}`,
        `--format=${gitHistoryFormat}`,
        "-z",
        "--",
      ],
      roots,
      deadline,
      (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maximumHistoryOutputBytes)
          throw new RepositoryHistoryError({
            failure: { _tag: "GitFailed", reason: "OutputTooLarge" },
          });
        chunks.push(chunk);
      },
    );
    return chunks.join("");
  });
}

function selectedHistoryRoots(
  git: GitCommandRunner,
  repositoryPath: string,
  request: ReadRepositoryHistory,
  deadline: number,
) {
  return Effect.gen(function* () {
    const roots = new Set(request.roots.map(({ oid }) => oid));
    const requested = new Map<string, Set<string>>();
    for (const { childOid, parentOid } of request.additionalParentEdges ?? []) {
      const parents = requested.get(childOid) ?? new Set<string>();
      parents.add(parentOid);
      requested.set(childOid, parents);
    }
    while (requested.size > 0) {
      const additions = new Set<string>();
      let pending = "";
      const acceptLine = (line: string) => {
        if (line.length > maximumParentLineCharacters)
          throw new RepositoryHistoryError({
            failure: { _tag: "GitFailed", reason: "OutputTooLarge" },
          });
        const [child, _firstParent, ...secondaryParents] = line.split(" ");
        if (child === undefined) return;
        const selected = requested.get(child);
        if (selected === undefined) return;
        requested.delete(child);
        for (const parent of secondaryParents)
          if (selected.has(parent) && !roots.has(parent)) additions.add(parent);
      };
      yield* streamQuery(
        git,
        repositoryPath,
        [
          "rev-list",
          "--stdin",
          "--first-parent",
          request.order === "topological" ? "--topo-order" : "--date-order",
          "--parents",
          `--max-count=${(request.offset ?? 0) + request.limit}`,
          "--",
        ],
        [...roots].sort(),
        deadline,
        (chunk) => {
          const lines = (pending + chunk).split("\n");
          pending = lines.pop() ?? "";
          if (pending.length > maximumParentLineCharacters)
            throw new RepositoryHistoryError({
              failure: { _tag: "GitFailed", reason: "OutputTooLarge" },
            });
          for (const line of lines) acceptLine(line);
        },
      );
      if (pending !== "") acceptLine(pending);
      if (additions.size === 0) break;
      for (const root of additions) roots.add(root);
    }
    return [...roots].sort();
  });
}

function streamQuery(
  git: GitCommandRunner,
  repositoryPath: string,
  arguments_: readonly string[],
  roots: readonly string[],
  deadline: number,
  accept: (chunk: string) => void,
) {
  if (Date.now() >= deadline)
    return Effect.fail(
      new RepositoryHistoryError({
        failure: { _tag: "GitFailed", reason: "Timeout" },
      }),
    );
  const stream = git.stream;
  if (stream === undefined)
    return Effect.fail(
      new RepositoryHistoryError({
        failure: { _tag: "GitFailed", reason: "GitUnavailable" },
      }),
    );
  let parsingFailure: unknown;
  return stream(
    {
      arguments: [
        "-c",
        "core.packedGitLimit=32m",
        "-c",
        "core.packedGitWindowSize=16m",
        ...arguments_,
      ],
      directory: repositoryPath,
      input: `${roots.join("\n")}\n`,
      timeoutMilliseconds: Math.max(1, deadline - Date.now()),
    },
    async (chunk) => {
      try {
        accept(chunk);
      } catch (error) {
        parsingFailure = error;
        throw error;
      }
    },
  ).pipe(
    Effect.mapError((error) =>
      parsingFailure instanceof RepositoryHistoryError
        ? parsingFailure
        : new RepositoryHistoryError({
            cause: error,
            failure: { _tag: "GitFailed", reason: error.reason },
          }),
    ),
    Effect.flatMap((output) =>
      output.exitCode === 0
        ? Effect.void
        : Effect.fail(
            new RepositoryHistoryError({
              failure: {
                _tag: "GitFailed",
                reason: "Failed",
                detail: output.stderr.slice(0, 2_048),
              },
            }),
          ),
    ),
  );
}
