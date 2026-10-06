import { Effect } from "effect";
import {
  FileHistoryApi,
  type FileHistoryEntry,
  type ReadFileHistory,
} from "#contracts/file-history/file-history.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";

const recordSeparator = "\x1e";
const fieldSeparator = "\x1f";
const headerFormat = ["%H", "%P", "%an", "%at", "%s"].join("%x1f");

export function fileHistoryFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { query } = repositoryRoutes(dependencies);
  return {
    routes: [
      query(FileHistoryApi.read, (input, git) => readFileHistory(git, input)),
    ],
  };
}

export function readFileHistory(
  git: GitCommandRunner,
  { worktreePath, path, limit }: ReadFileHistory,
) {
  return runRepositoryGit(
    git,
    worktreePath,
    [
      "log",
      "--follow",
      "-M",
      "-z",
      "--raw",
      "--numstat",
      "--diff-merges=first-parent",
      "--no-show-signature",
      "--no-ext-diff",
      "--no-textconv",
      `--format=${recordSeparator}${headerFormat}`,
      `--max-count=${limit + 1}`,
      "HEAD",
      "--",
      path,
    ],
    {
      globalArguments: ["--no-replace-objects"],
      maxOutputBytes: 64 * 1_048_576,
    },
  ).pipe(
    Effect.catchIf(
      (error) => /does not have any commits yet/i.test(error.detail),
      () => Effect.succeed(""),
    ),
    Effect.map((output) => {
      const entries = parseFileHistory(output);
      return {
        entries: entries.slice(0, limit),
        complete: entries.length <= limit,
      };
    }),
  );
}

export function parseFileHistory(output: string): FileHistoryEntry[] {
  const entries: FileHistoryEntry[] = [];
  for (const record of output.split(recordSeparator)) {
    const end = record.indexOf("\0");
    if (end < 0) continue;
    const [oid, parents, author, authoredAt, subject] = record
      .slice(0, end)
      .split(fieldSeparator);
    const change = parseChange(record.slice(end + 1).replace(/^\n/, ""));
    if (
      oid === undefined ||
      parents === undefined ||
      author === undefined ||
      authoredAt === undefined ||
      subject === undefined ||
      change === undefined
    )
      continue;
    entries.push({
      oid,
      parentOid: parents.split(" ").find(Boolean) ?? null,
      subject: subject.slice(0, 1_024),
      author: author.slice(0, 256),
      authoredAt: Number.parseInt(authoredAt, 10) || 0,
      ...change,
    });
  }
  return entries;
}

function changeStatus(status: string): FileHistoryEntry["status"] {
  return status === "A" || status === "D" || status === "T" ? status : "M";
}

function parseChange(
  text: string,
):
  | Omit<
      FileHistoryEntry,
      "oid" | "parentOid" | "subject" | "author" | "authoredAt"
    >
  | undefined {
  const fields = text.split("\0");
  const raw = fields[0];
  if (raw === undefined || !raw.startsWith(":")) return undefined;
  const status = raw.slice(raw.lastIndexOf(" ") + 1, raw.lastIndexOf(" ") + 2);
  const renamed = status === "R" || status === "C";
  const first = fields[1];
  const path = renamed ? fields[2] : first;
  if (first === undefined || path === undefined) return undefined;
  const counts = fields[renamed ? 3 : 2]?.split("\t");
  const added = Number(counts?.[0]);
  const removed = Number(counts?.[1]);
  return {
    path,
    previousPath: renamed ? first : null,
    status: renamed ? "R" : changeStatus(status),
    lines:
      Number.isInteger(added) && Number.isInteger(removed)
        ? { added, removed }
        : null,
  };
}
