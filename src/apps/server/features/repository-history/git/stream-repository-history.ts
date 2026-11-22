import {
  type GitCommandRunner,
  type GitObjectFormat,
  runRepositoryGit,
  streamRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { parseHistoryOutput } from "#server/features/repository-history/git/history-failures.ts";
import {
  createGitHistoryBatchParser,
  gitHistoryFormat,
} from "#server/features/repository-history/git/parse-git-history.ts";
import { restoreShallowCommitParents } from "#server/features/repository-history/git/shallow-repository-history.ts";

const batchSize = 256;
const pageSize = 5_000;
const maximumBatchCharacters = 4 * 1_048_576;
const traversalTimeoutMilliseconds = 30 * 60_000;
const packedGitArguments = [
  "-c",
  "core.packedGitLimit=32m",
  "-c",
  "core.packedGitWindowSize=16m",
];

interface HistoryTraversal {
  readonly roots: readonly string[];
  readonly knownTips: readonly string[];
  readonly objectFormat: GitObjectFormat;
  readonly shallowOids: readonly string[];
}

export async function* streamRepositoryHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  traversal: HistoryTraversal,
) {
  const excluded = await existingCommits(
    git,
    repositoryPath,
    traversal.knownTips,
  );
  const frontier = new Set(traversal.roots);
  const shallow = new Set(traversal.shallowOids);
  const deadline = Date.now() + traversalTimeoutMilliseconds;
  while (frontier.size > 0) {
    let parsed = 0;
    for await (const commits of historyPage(
      git,
      repositoryPath,
      traversal.objectFormat,
      frontier,
      excluded,
      deadline,
    )) {
      for (const commit of commits) {
        frontier.delete(commit.oid);
        for (const parent of commit.parents) frontier.add(parent);
      }
      yield await restoreShallowCommitParents(
        git,
        repositoryPath,
        commits,
        shallow,
      );
      parsed += commits.length;
    }
    if (parsed < pageSize) break;
  }
}

async function existingCommits(
  git: GitCommandRunner,
  repositoryPath: string,
  oids: readonly string[],
) {
  if (oids.length === 0) return [];
  const output = await runRepositoryGit(
    git,
    repositoryPath,
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    { input: `${oids.join("\n")}\n`, maxOutputBytes: 8 * 1_048_576 },
  );
  return output
    .split("\n")
    .flatMap((line) =>
      line.endsWith(" commit") ? [line.slice(0, line.indexOf(" "))] : [],
    );
}

async function* historyPage(
  git: GitCommandRunner,
  repositoryPath: string,
  objectFormat: GitObjectFormat,
  frontier: ReadonlySet<string>,
  excluded: readonly string[],
  deadline: number,
) {
  const parser = createGitHistoryBatchParser(
    objectFormat,
    batchSize,
    maximumBatchCharacters,
  );
  const output = streamRepositoryGit(
    git,
    repositoryPath,
    [
      "log",
      "--stdin",
      "--topo-order",
      "--no-show-signature",
      `--max-count=${pageSize}`,
      `--format=${gitHistoryFormat}`,
      "-z",
      "--",
    ],
    {
      globalArguments: packedGitArguments,
      input: `${[...frontier].sort().join("\n")}\n${excluded.map((oid) => `^${oid}`).join("\n")}\n`,
      timeoutMilliseconds: Math.max(1, deadline - Date.now()),
    },
  );
  for await (const chunk of output)
    yield* parseHistoryOutput(() => parser.accept(chunk));
  yield* parseHistoryOutput(() => parser.finish());
}
