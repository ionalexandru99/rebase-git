import { type Dirent, realpath } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, parse } from "node:path";
import { promisify } from "node:util";
import type {
  EnvironmentDirectory,
  EnvironmentDirectoryEntry,
  EnvironmentDirectoryRejected,
  EnvironmentPathBreadcrumb,
} from "@rebase/contracts";
import { currentTransportLimits } from "@rebase/contracts";
import { Effect } from "effect";
import {
  type EnvironmentFilesystem,
  EnvironmentFilesystemError,
} from "#server/domain/environment-filesystem.contract";

const maximumEntries = 500;
const maximumPathLength = 4_096;
const maximumBreadcrumbBytes = 16_384;
const responseSizeMargin = 512;
const realpathNative = promisify(realpath.native);

export function createEnvironmentFilesystem(
  homeDirectory = homedir(),
): EnvironmentFilesystem {
  return {
    listDirectory: (requestedPath, includeHidden = false) =>
      listEnvironmentDirectory(requestedPath ?? homeDirectory, includeHidden),
  };
}

function listEnvironmentDirectory(
  requestedPath: string,
  includeHidden: boolean,
) {
  if (!validPath(requestedPath)) {
    return Effect.fail(directoryRejected("MalformedPath"));
  }

  return Effect.gen(function* () {
    const path = yield* canonicalizeDirectory(requestedPath);
    const directoryEntries = yield* readDirectory(path, includeHidden);
    const inspectedEntries = yield* Effect.promise(() =>
      inspectEntries(path, directoryEntries.slice(0, maximumEntries)),
    );
    const parent = dirname(path);
    const listing = {
      breadcrumbs: createBreadcrumbs(path),
      entries: [],
      ...(parent === path ? {} : { parentPath: parent }),
      path,
      truncated: false,
    } satisfies EnvironmentDirectory;
    const entries = fitDirectoryEntries(listing, inspectedEntries);
    return {
      ...listing,
      entries,
      truncated: directoryEntries.length > entries.length,
    } satisfies EnvironmentDirectory;
  });
}

function canonicalizeDirectory(path: string) {
  return Effect.tryPromise({
    try: async () => {
      const canonicalPath = await realpathNative(path);
      const metadata = await stat(canonicalPath);
      if (!metadata.isDirectory()) {
        throw directoryRejected("NotDirectory");
      }
      return canonicalPath;
    },
    catch: (cause) =>
      cause instanceof EnvironmentFilesystemError
        ? cause
        : directoryRejected(fileSystemRejectionReason(cause), cause),
  });
}

function readDirectory(path: string, includeHidden: boolean) {
  return Effect.tryPromise({
    try: async () => {
      const entries = await readdir(path, { withFileTypes: true });
      return entries
        .filter(
          (entry) =>
            (includeHidden || !entry.name.startsWith(".")) &&
            validEntry(path, entry.name),
        )
        .sort(
          (left, right) =>
            Number(right.isDirectory()) - Number(left.isDirectory()) ||
            left.name.localeCompare(right.name, undefined, {
              numeric: true,
              sensitivity: "base",
            }),
        );
    },
    catch: (cause) =>
      directoryRejected(fileSystemRejectionReason(cause), cause),
  });
}

async function inspectEntries(
  directory: string,
  entries: readonly Dirent<string>[],
) {
  return Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      const metadata = await stat(path).catch(() => undefined);
      const type =
        (metadata?.isDirectory() ?? entry.isDirectory()) ? "directory" : "file";
      return {
        kind: type === "directory" ? "Folder" : fileKind(entry.name),
        ...(metadata === undefined
          ? {}
          : { modifiedAt: metadata.mtime.toISOString() }),
        name: entry.name,
        path,
        type,
      } satisfies EnvironmentDirectoryEntry;
    }),
  );
}

function createBreadcrumbs(path: string): readonly EnvironmentPathBreadcrumb[] {
  const root = parse(path).root;
  if (path === root) return [{ name: root, path: root }];

  const breadcrumbs: EnvironmentPathBreadcrumb[] = [];
  let current = path;

  while (current !== root) {
    breadcrumbs.unshift({ name: basename(current), path: current });
    current = dirname(current);
  }
  const bounded = breadcrumbs.slice(-256);
  while (
    bounded.length > 1 &&
    Buffer.byteLength(JSON.stringify(bounded)) > maximumBreadcrumbBytes
  ) {
    bounded.shift();
  }
  return bounded;
}

function fitDirectoryEntries(
  listing: EnvironmentDirectory,
  entries: readonly EnvironmentDirectoryEntry[],
) {
  const maximumResponseBytes =
    currentTransportLimits.maxHttpResponseBytes - responseSizeMargin;
  let encodedBytes = Buffer.byteLength(JSON.stringify(listing));
  const fitted: EnvironmentDirectoryEntry[] = [];

  for (const entry of entries) {
    const entryBytes = Buffer.byteLength(JSON.stringify(entry));
    const separatorBytes = fitted.length === 0 ? 0 : 1;
    if (encodedBytes + entryBytes + separatorBytes > maximumResponseBytes) {
      break;
    }
    fitted.push(entry);
    encodedBytes += entryBytes + separatorBytes;
  }
  return fitted;
}

function fileKind(name: string) {
  switch (extname(name).toLocaleLowerCase()) {
    case ".md":
    case ".mdx":
      return "Markdown";
    case ".pdf":
      return "PDF";
    case ".ts":
    case ".tsx":
      return "TypeScript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "JavaScript";
    case ".json":
      return "JSON";
    case ".yaml":
    case ".yml":
      return "YAML";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".webp":
    case ".svg":
      return "Image";
    default:
      return "File";
  }
}

function validPath(path: string) {
  return (
    path.length > 0 &&
    path.length <= maximumPathLength &&
    !path.includes("\0") &&
    isAbsolute(path)
  );
}

function validEntry(directory: string, name: string) {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    join(directory, name).length <= maximumPathLength
  );
}

function fileSystemRejectionReason(
  cause: unknown,
): EnvironmentDirectoryRejected["reason"] {
  switch (fileSystemErrorCode(cause)) {
    case "ENOENT":
      return "NotFound";
    case "ENOTDIR":
      return "NotDirectory";
    case "EACCES":
    case "EPERM":
      return "PermissionDenied";
    default:
      return "InspectionFailed";
  }
}

function fileSystemErrorCode(cause: unknown) {
  return typeof cause === "object" && cause !== null && "code" in cause
    ? String(cause.code)
    : undefined;
}

function directoryRejected(
  reason: EnvironmentDirectoryRejected["reason"],
  cause?: unknown,
) {
  return new EnvironmentFilesystemError({
    ...(cause === undefined ? {} : { cause }),
    failure: { _tag: "EnvironmentDirectoryRejected", reason },
  });
}
