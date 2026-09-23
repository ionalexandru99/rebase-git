import { Effect } from "effect";
import type {
  GitCommandOptions,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import { previewByteLimit } from "#server/domain/repository-comparison.contract";
import { RepositoryGitError } from "#server/domain/repository-git.contract";
import { runRepositoryGit } from "#server/repository/access/index";

export interface GitBlob {
  readonly bytes: number;
  readonly content: Buffer | null;
}

const headerBytes = 256;

export function readBlobs(
  git: GitCommandRunner,
  directory: string,
  oids: readonly string[],
  options: GitCommandOptions = {},
) {
  const unique = [...new Set(oids)];
  return readBlobContents(git, directory, unique, options).pipe(
    Effect.catchIf(
      (error) => error.reason === "OutputTooLarge",
      () => readLargeBlobs(git, directory, unique, options),
    ),
  );
}

function readLargeBlobs(
  git: GitCommandRunner,
  directory: string,
  oids: readonly string[],
  options: GitCommandOptions,
) {
  return Effect.gen(function* () {
    const sizes = yield* readBlobSizes(git, directory, oids, options);
    const previewable = [...sizes]
      .filter(([, bytes]) => bytes <= previewByteLimit)
      .map(([oid]) => oid);
    const contents = yield* readBlobContents(
      git,
      directory,
      previewable,
      options,
    );
    return new Map<string, GitBlob>(
      [...sizes].map(([oid, bytes]) => [
        oid,
        contents.get(oid) ?? { bytes, content: null },
      ]),
    );
  });
}

function readBlobContents(
  git: GitCommandRunner,
  directory: string,
  oids: readonly string[],
  options: GitCommandOptions,
) {
  if (oids.length === 0) return Effect.succeed(new Map<string, GitBlob>());
  return runRepositoryGit(git, directory, ["cat-file", "--batch"], {
    ...options,
    input: batchInput(oids),
    outputEncoding: "base64",
    maxOutputBytes: oids.length * (previewByteLimit + headerBytes),
  }).pipe(
    Effect.flatMap((output) =>
      parseBatch(Buffer.from(output, "base64"), oids.length),
    ),
  );
}

function readBlobSizes(
  git: GitCommandRunner,
  directory: string,
  oids: readonly string[],
  options: GitCommandOptions,
) {
  return runRepositoryGit(git, directory, ["cat-file", "--batch-check"], {
    ...options,
    input: batchInput(oids),
  }).pipe(
    Effect.flatMap((output) => {
      const sizes = new Map<string, number>();
      for (const line of output.split("\n").filter(Boolean)) {
        const header = parseHeader(line);
        if (header === undefined) return unreadableBlob;
        sizes.set(header.oid, header.bytes);
      }
      return sizes.size === oids.length
        ? Effect.succeed(sizes)
        : unreadableBlob;
    }),
  );
}

function parseBatch(output: Buffer, count: number) {
  const blobs = new Map<string, GitBlob>();
  let offset = 0;
  while (offset < output.length) {
    const end = output.indexOf(10, offset);
    const header =
      end < 0 ? undefined : parseHeader(output.toString("utf8", offset, end));
    if (header === undefined) return unreadableBlob;
    const start = end + 1;
    blobs.set(header.oid, {
      bytes: header.bytes,
      content:
        header.bytes > previewByteLimit
          ? null
          : output.subarray(start, start + header.bytes),
    });
    offset = start + header.bytes + 1;
  }
  return blobs.size === count ? Effect.succeed(blobs) : unreadableBlob;
}

function parseHeader(line: string) {
  const [oid, type, size] = line.split(" ");
  const bytes = Number(size);
  return oid !== undefined && type === "blob" && Number.isSafeInteger(bytes)
    ? { oid, bytes }
    : undefined;
}

function batchInput(oids: readonly string[]) {
  return oids.map((oid) => `${oid}\n`).join("");
}

export const unreadableBlob = Effect.fail(
  new RepositoryGitError({
    detail: "Could not read the file object.",
    reason: "Failed",
  }),
);
