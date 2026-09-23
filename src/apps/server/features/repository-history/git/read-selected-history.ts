import type { ReadRepositoryHistory } from "@rebase/contracts";
import { Effect, Stream } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import {
  historyOutputTooLarge,
  RepositoryHistoryError,
} from "#server/features/repository-history/git/history-failures";
import { gitHistoryFormat } from "#server/features/repository-history/git/parse-git-history";
import { streamRepositoryGit } from "#server/repository/access/index";

export const maximumHistoryOutputBytes = 8 * 1_048_576;
export const packedGitArguments = [
  "-c",
  "core.packedGitLimit=32m",
  "-c",
  "core.packedGitWindowSize=16m",
];
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
    ).pipe(
      Stream.runForEach((chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maximumHistoryOutputBytes)
          return Effect.fail(historyOutputTooLarge());
        chunks.push(chunk);
        return Effect.void;
      }),
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
      ).pipe(
        Stream.runForEach((chunk) => {
          const lines = (pending + chunk).split("\n");
          pending = lines.pop() ?? "";
          if (
            pending.length > maximumParentLineCharacters ||
            lines.some((line) => line.length > maximumParentLineCharacters)
          )
            return Effect.fail(historyOutputTooLarge());
          for (const line of lines) acceptLine(line);
          return Effect.void;
        }),
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
  args: readonly string[],
  roots: readonly string[],
  deadline: number,
): Stream.Stream<string, RepositoryHistoryError | RepositoryGitError> {
  return Date.now() >= deadline
    ? Stream.fail(
        new RepositoryHistoryError({
          failure: { _tag: "GitFailed", reason: "Timeout" },
        }),
      )
    : streamRepositoryGit(git, repositoryPath, args, {
        globalArguments: packedGitArguments,
        input: `${roots.join("\n")}\n`,
        timeoutMilliseconds: Math.max(1, deadline - Date.now()),
      });
}
