import { Effect } from "effect";
import {
  type BlameCommit,
  type BlameRange,
  type FileBlame,
  FileBlameApi,
  type ReadFileBlame,
} from "#contracts/file-blame/file-blame.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { previewByteLimit } from "#server/repository/comparison/read-blobs.ts";

const groupHeader = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) (\d+)(?: (\d+))?$/;
const uncommitted = /^0+$/;
const escapes: Readonly<Record<string, number>> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
};

export function fileBlameFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { query } = repositoryRoutes(dependencies);
  return {
    routes: [
      query(FileBlameApi.read, (input, git) => readFileBlame(git, input)),
    ],
  };
}

function readFileBlame(
  git: GitCommandRunner,
  { worktreePath, path, revision }: ReadFileBlame,
) {
  return runRepositoryGit(
    git,
    worktreePath,
    [
      "blame",
      "--porcelain",
      "-w",
      "-M",
      ...(revision === null ? [] : [revision]),
      "--",
      path,
    ],
    {
      globalArguments: ["--no-replace-objects", "-c", "core.quotePath=false"],
      timeoutMilliseconds: 120_000,
    },
  ).pipe(
    Effect.map(parseFileBlame),
    Effect.catchIf(
      (error) => error.reason === "OutputTooLarge",
      () => Effect.succeed(unblamable("large")),
    ),
  );
}

function parseFileBlame(output: string): FileBlame {
  const lines: string[] = [];
  const ranges: BlameRange[] = [];
  const commits = new Map<string, BlameCommit>();
  const rows = output.split("\n");
  let index = 0;
  while (index < rows.length) {
    const header = groupHeader.exec(rows[index] ?? "");
    index += 1;
    if (header === null) continue;
    const [, oid = "", originalLine = "0", finalLine = "0", count] = header;
    const fields = new Map<string, string>();
    while (index < rows.length && !rows[index]?.startsWith("\t")) {
      const row = rows[index] ?? "";
      const space = row.indexOf(" ");
      fields.set(
        space < 0 ? row : row.slice(0, space),
        space < 0 ? "" : row.slice(space + 1),
      );
      index += 1;
    }
    lines.push(rows[index]?.slice(1).replace(/\r$/, "") ?? "");
    index += 1;
    const committed = !uncommitted.test(oid);
    if (committed && !commits.has(oid)) commits.set(oid, commit(oid, fields));
    if (count !== undefined)
      addRange(ranges, {
        start: Number(finalLine),
        count: Number(count),
        oid: committed ? oid : null,
        originalLine: Number(originalLine),
      });
  }
  const text = lines.join("\n");
  if (text.includes("\0")) return unblamable("binary");
  if (Buffer.byteLength(text) > previewByteLimit) return unblamable("large");
  return { _tag: "Blamed", text, ranges, commits: [...commits.values()] };
}

function addRange(ranges: BlameRange[], range: BlameRange) {
  const last = ranges.at(-1);
  if (
    last?.oid === range.oid &&
    last.start + last.count === range.start &&
    last.originalLine + last.count === range.originalLine
  )
    ranges[ranges.length - 1] = { ...last, count: last.count + range.count };
  else ranges.push(range);
}

function commit(oid: string, fields: ReadonlyMap<string, string>): BlameCommit {
  const previous = fields.get("previous");
  const space = previous?.indexOf(" ") ?? -1;
  return {
    oid,
    subject: (fields.get("summary") ?? "").slice(0, 1_024),
    author: (fields.get("author") ?? "").slice(0, 256),
    email: (fields.get("author-mail") ?? "")
      .replace(/^<|>$/g, "")
      .slice(0, 320),
    authoredAt: Number.parseInt(fields.get("author-time") ?? "", 10) || 0,
    path: unquote(fields.get("filename") ?? ""),
    previous:
      previous === undefined || space < 0
        ? null
        : {
            oid: previous.slice(0, space),
            path: unquote(previous.slice(space + 1)),
          },
  };
}

function unblamable(reason: "binary" | "large"): FileBlame {
  return { _tag: "Unblamable", reason };
}

function unquote(path: string) {
  if (!path.startsWith('"') || !path.endsWith('"')) return path;
  const bytes: number[] = [];
  const body = path.slice(1, -1);
  let index = 0;
  while (index < body.length) {
    const char = String.fromCodePoint(body.codePointAt(index) ?? 0);
    const next = body[index + 1] ?? "";
    if (char !== "\\") {
      bytes.push(...Buffer.from(char));
      index += char.length;
    } else if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(body.slice(index + 1, index + 4), 8));
      index += 4;
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      index += 2;
    }
  }
  return Buffer.from(bytes).toString();
}
