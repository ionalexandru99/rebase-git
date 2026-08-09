import { realpath } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { Data, Effect } from 'effect4'

const realpathNative = promisify(realpath.native)

declare const canonicalNativeDirectoryPath: unique symbol

export type CanonicalNativeDirectoryPath = string & {
  readonly [canonicalNativeDirectoryPath]: true
}

export type RepositoryAccessFailureReason =
  | 'FilesystemFailure'
  | 'MalformedPath'
  | 'NotDirectory'
  | 'NotFound'
  | 'OutsideAllowedRoots'

export class RepositoryAccessFailure extends Data.TaggedError('RepositoryAccessFailure')<{
  readonly reason: RepositoryAccessFailureReason
  readonly nativePath: string
  readonly message: string
  readonly detail?: unknown
}> {}

export interface RepositoryAccess {
  readonly authorizeDirectory: (
    nativePath: string
  ) => Effect.Effect<CanonicalNativeDirectoryPath, RepositoryAccessFailure>
}

function malformedPathFailure(nativePath: string): RepositoryAccessFailure {
  return new RepositoryAccessFailure({
    reason: 'MalformedPath',
    nativePath,
    message: 'Repository paths must be native absolute paths without parent traversal'
  })
}

function isMalformedNativePath(nativePath: string): boolean {
  return (
    nativePath.length === 0 ||
    nativePath.includes('\0') ||
    !path.isAbsolute(nativePath) ||
    nativePath.split(/[\\/]+/).includes('..')
  )
}

function filesystemFailure(nativePath: string, detail: unknown): RepositoryAccessFailure {
  const errorCode =
    typeof detail === 'object' && detail !== null && 'code' in detail
      ? String(detail.code)
      : undefined
  if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') {
    return new RepositoryAccessFailure({
      reason: 'NotFound',
      nativePath,
      message: 'Repository path does not exist',
      detail
    })
  }
  return new RepositoryAccessFailure({
    reason: 'FilesystemFailure',
    nativePath,
    message: 'Repository path could not be inspected',
    detail
  })
}

function canonicalizeDirectory(
  nativePath: string
): Effect.Effect<CanonicalNativeDirectoryPath, RepositoryAccessFailure> {
  if (isMalformedNativePath(nativePath)) {
    return Effect.fail(malformedPathFailure(nativePath))
  }
  return Effect.gen(function* () {
    const canonicalPath = yield* Effect.tryPromise({
      try: () => realpathNative(nativePath),
      catch: (detail) => filesystemFailure(nativePath, detail)
    })
    const metadata = yield* Effect.tryPromise({
      try: () => stat(canonicalPath),
      catch: (detail) => filesystemFailure(nativePath, detail)
    })
    if (!metadata.isDirectory()) {
      return yield* Effect.fail(
        new RepositoryAccessFailure({
          reason: 'NotDirectory',
          nativePath,
          message: 'Repository path is not a directory'
        })
      )
    }
    return canonicalPath as CanonicalNativeDirectoryPath
  })
}

function isWithinRoot(
  rootPath: CanonicalNativeDirectoryPath,
  candidatePath: CanonicalNativeDirectoryPath
): boolean {
  const relativePath = path.relative(rootPath, candidatePath)
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  )
}

export function makeRepositoryAccess(
  allowedRootPaths: readonly string[]
): Effect.Effect<RepositoryAccess, RepositoryAccessFailure> {
  return Effect.gen(function* () {
    const canonicalAllowedRoots = yield* Effect.all(allowedRootPaths.map(canonicalizeDirectory))
    const uniqueAllowedRoots = [...new Set(canonicalAllowedRoots)]

    return {
      authorizeDirectory: (nativePath) =>
        canonicalizeDirectory(nativePath).pipe(
          Effect.flatMap((canonicalPath) =>
            uniqueAllowedRoots.some((rootPath) => isWithinRoot(rootPath, canonicalPath))
              ? Effect.succeed(canonicalPath)
              : Effect.fail(
                  new RepositoryAccessFailure({
                    reason: 'OutsideAllowedRoots',
                    nativePath,
                    message: 'Repository path is outside the allowed roots'
                  })
                )
          )
        )
    }
  })
}
