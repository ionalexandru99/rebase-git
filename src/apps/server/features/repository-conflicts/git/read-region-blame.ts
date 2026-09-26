import type { CommitSummary } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { runRepositoryGit } from "#server/repository/access/index";

export function readRegionBlame(
  git: GitCommandRunner,
  directory: string,
  path: string,
  commit: string | null,
  lines: readonly (number | null)[],
) {
  const requested = [...new Set(lines.filter((line) => line !== null))];
  if (commit === null || requested.length === 0)
    return Effect.succeed(lines.map(() => null));
  return runRepositoryGit(
    git,
    directory,
    [
      "blame",
      "--line-porcelain",
      ...requested.flatMap((line) => ["-L", `${line},${line}`]),
      commit,
      "--",
      path,
    ],
    { exitCodes: [0, 128] },
  ).pipe(
    Effect.map((output) => {
      const summaries = parseBlame(output);
      return lines.map((line) =>
        line === null ? null : (summaries.get(line) ?? null),
      );
    }),
  );
}

function parseBlame(output: string) {
  const summaries = new Map<number, CommitSummary>();
  let commit = "";
  let line = 0;
  let subject = "";
  for (const row of output.split("\n")) {
    const header = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(row);
    if (header !== null) {
      commit = header[1] ?? "";
      line = Number(header[2]);
    } else if (row.startsWith("summary ")) {
      subject = row.slice("summary ".length);
    } else if (row.startsWith("\t")) {
      summaries.set(line, { commit, subject });
    }
  }
  return summaries;
}
