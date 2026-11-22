import { type Dirent, realpath } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, parse } from "node:path";
import { promisify } from "node:util";
import {
  type EnvironmentDirectory,
  type EnvironmentDirectoryEntry,
  type EnvironmentDirectoryRejected,
  EnvironmentFilesystemApi,
  type EnvironmentPathBreadcrumb,
} from "#contracts/environment-filesystem/environment-filesystem.contract.ts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes.ts";
import { route } from "#server/adapters/environment-transport/environment-routes.ts";

const maximumEntries = 500;
const maximumPathLength = 4_096;
const maximumBreadcrumbBytes = 16_384;
const realpathNative = promisify(realpath.native);

export function environmentFilesystemFeature(): EnvironmentFeature {
  const filesystem = createEnvironmentFilesystem();
  return {
    routes: [
      route(EnvironmentFilesystemApi.listDirectory, (directory) =>
        filesystem.listDirectory(directory.path, directory.includeHidden),
      ),
    ],
  };
}

export function createEnvironmentFilesystem(homeDirectory = homedir()) {
  return {
    listDirectory: (requestedPath?: string, includeHidden = false) =>
      listEnvironmentDirectory(requestedPath ?? homeDirectory, includeHidden),
  };
}

async function listEnvironmentDirectory(
  requestedPath: string,
  includeHidden: boolean,
): Promise<EnvironmentDirectory> {
  if (!validPath(requestedPath)) throw directoryRejected("MalformedPath");
  const path = await canonicalizeDirectory(requestedPath);
  const directoryEntries = await readDirectory(path, includeHidden);
  const [inspectedEntries, repository] = await Promise.all([
    inspectEntries(path, directoryEntries.slice(0, maximumEntries)),
    insideRepository(path),
  ]);
  const parent = dirname(path);
  return {
    breadcrumbs: createBreadcrumbs(path),
    entries: inspectedEntries,
    ...(parent === path ? {} : { parentPath: parent }),
    path,
    repository,
    truncated: directoryEntries.length > inspectedEntries.length,
  };
}

async function canonicalizeDirectory(path: string) {
  let canonicalPath: string;
  let directory: boolean;
  try {
    canonicalPath = await realpathNative(path);
    directory = (await stat(canonicalPath)).isDirectory();
  } catch (cause) {
    throw directoryRejected(fileSystemRejectionReason(cause));
  }
  if (!directory) throw directoryRejected("NotDirectory");
  return canonicalPath;
}

async function readDirectory(path: string, includeHidden: boolean) {
  const entries = await readdir(path, { withFileTypes: true }).catch(
    (cause: unknown) => {
      throw directoryRejected(fileSystemRejectionReason(cause));
    },
  );
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
        kind:
          type === "file"
            ? fileKind(entry.name)
            : (await holdsRepository(path))
              ? "Repository"
              : "Folder",
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

async function insideRepository(path: string): Promise<boolean> {
  if (await holdsRepository(path)) return true;
  const parent = dirname(path);
  return parent !== path && insideRepository(parent);
}

function holdsRepository(path: string) {
  return access(join(path, ".git")).then(
    () => true,
    (cause: unknown) => {
      const code = fileSystemErrorCode(cause);
      return code !== "ENOENT" && code !== "ENOTDIR";
    },
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
): EnvironmentDirectoryRejected {
  return { _tag: "EnvironmentDirectoryRejected", reason };
}
