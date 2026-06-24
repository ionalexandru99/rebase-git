import { Etag, FileSystem, HttpPlatform, Path } from '@effect/platform'
import { RpcSerialization, RpcServer } from '@effect/rpc'
import {
  Conflict as RpcConflict,
  FetchSkipped as RpcFetchSkipped,
  GitError as RpcGitError,
  HunkNotFound as RpcHunkNotFound,
  RepoNotOpen as RpcRepoNotOpen,
  SidecarRpcs
} from '@shared/rpc'
import { Effect, Layer } from 'effect'
import type { Conflict, FetchSkipped, GitError, HunkNotFound, RepoNotOpen } from './git-errors'
import * as operations from './operations'
import { resolveExistingRepoRoot, resolveRepoRelativeFile } from './path-guards'

const INVALID_REPO_PATH = 'invalid repository path'

const resolveRepo = (repoPath: string): Effect.Effect<string, RpcGitError> =>
  Effect.suspend(() => {
    const resolved = resolveExistingRepoRoot(repoPath)
    return resolved
      ? Effect.succeed(resolved)
      : Effect.fail(new RpcGitError({ message: INVALID_REPO_PATH }))
  })

const resolveFile = (repoRoot: string, file: string): Effect.Effect<string, RpcGitError> =>
  Effect.suspend(() => {
    const relative = resolveRepoRelativeFile(repoRoot, file)
    return relative
      ? Effect.succeed(relative)
      : Effect.fail(new RpcGitError({ message: INVALID_REPO_PATH }))
  })

const resolveFiles = (
  repoRoot: string,
  files: readonly string[]
): Effect.Effect<string[], RpcGitError> =>
  Effect.suspend(() => {
    const resolved: string[] = []
    for (const file of files) {
      const relative = resolveRepoRelativeFile(repoRoot, file)
      if (!relative) {
        return Effect.fail(new RpcGitError({ message: INVALID_REPO_PATH }))
      }
      resolved.push(relative)
    }
    return Effect.succeed(resolved)
  })

// Read ops fail only with the sidecar-internal RepoNotOpen/GitError; project them onto the RPC
// group's Schema-defined error classes so they serialize on the typed error channel.
const toReadError = (error: RepoNotOpen | GitError): RpcRepoNotOpen | RpcGitError =>
  error._tag === 'RepoNotOpen' ? new RpcRepoNotOpen() : new RpcGitError({ message: error.message })

const toHunkError = (
  error: RepoNotOpen | GitError | HunkNotFound
): RpcRepoNotOpen | RpcGitError | RpcHunkNotFound =>
  error._tag === 'HunkNotFound' ? new RpcHunkNotFound() : toReadError(error)

const toConflictError = (
  error: RepoNotOpen | GitError | Conflict
): RpcRepoNotOpen | RpcGitError | RpcConflict =>
  error._tag === 'Conflict' ? new RpcConflict({ message: error.message }) : toReadError(error)

const toFetchError = (
  error: RepoNotOpen | GitError | FetchSkipped
): RpcRepoNotOpen | RpcGitError | RpcFetchSkipped =>
  error._tag === 'FetchSkipped' ? new RpcFetchSkipped() : toReadError(error)

export const handlersLayer = SidecarRpcs.toLayer({
  commit: ({ repoPath, message }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.commit(resolved, message).pipe(Effect.mapError(toReadError))
      )
    ),
  stageFile: ({ repoPath, file }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFile(resolved, file).pipe(
          Effect.flatMap((relative) =>
            operations.stageFile(resolved, relative).pipe(Effect.mapError(toReadError))
          )
        )
      )
    ),
  unstageFile: ({ repoPath, file }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFile(resolved, file).pipe(
          Effect.flatMap((relative) =>
            operations.unstageFile(resolved, relative).pipe(Effect.mapError(toReadError))
          )
        )
      )
    ),
  stageAll: ({ repoPath, files }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFiles(resolved, files).pipe(
          Effect.flatMap((relatives) =>
            operations.stageAll(resolved, relatives).pipe(Effect.mapError(toReadError))
          )
        )
      )
    ),
  unstageAll: ({ repoPath, files }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFiles(resolved, files).pipe(
          Effect.flatMap((relatives) =>
            operations.unstageAll(resolved, relatives).pipe(Effect.mapError(toReadError))
          )
        )
      )
    ),
  stageHunk: ({ repoPath, file, hunkHeader }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFile(resolved, file).pipe(
          Effect.flatMap((relative) =>
            operations.stageHunk(resolved, relative, hunkHeader).pipe(Effect.mapError(toHunkError))
          )
        )
      )
    ),
  unstageHunk: ({ repoPath, file, hunkHeader }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFile(resolved, file).pipe(
          Effect.flatMap((relative) =>
            operations
              .unstageHunk(resolved, relative, hunkHeader)
              .pipe(Effect.mapError(toHunkError))
          )
        )
      )
    ),
  discardChanges: ({ repoPath, files }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFiles(resolved, files).pipe(
          Effect.flatMap((relatives) =>
            operations.discardChanges(resolved, relatives).pipe(Effect.mapError(toReadError))
          )
        )
      )
    ),
  discardAll: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.discardAll(resolved).pipe(Effect.mapError(toReadError))
      )
    ),
  mergeBranch: ({ repoPath, ref }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.mergeBranch(resolved, ref).pipe(Effect.mapError(toConflictError))
      )
    ),
  revertCommit: ({ repoPath, sha }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.revertCommit(resolved, sha).pipe(Effect.mapError(toConflictError))
      )
    ),
  cherryPick: ({ repoPath, sha }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.cherryPick(resolved, sha).pipe(Effect.mapError(toConflictError))
      )
    ),
  checkout: ({ repoPath, refKind, fullPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.checkoutRef(resolved, refKind, fullPath).pipe(Effect.mapError(toReadError))
      )
    ),
  createBranch: ({ repoPath, name, startPoint, checkout }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations
          .createBranch(resolved, name, startPoint || undefined, checkout === true)
          .pipe(Effect.mapError(toReadError))
      )
    ),
  deleteBranch: ({ repoPath, name, force }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.deleteBranch(resolved, name, force === true).pipe(Effect.mapError(toReadError))
      )
    ),
  renameBranch: ({ repoPath, oldName, newName }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.renameBranch(resolved, oldName, newName).pipe(Effect.mapError(toReadError))
      )
    ),
  createTag: ({ repoPath, name, ref, message }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations
          .createTag(resolved, name, ref || undefined, message || undefined)
          .pipe(Effect.mapError(toReadError))
      )
    ),
  deleteTag: ({ repoPath, name }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.deleteTag(resolved, name).pipe(Effect.mapError(toReadError))
      )
    ),
  stashPop: ({ repoPath, index }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.stashPop(resolved, index).pipe(Effect.mapError(toConflictError))
      )
    ),
  stashApply: ({ repoPath, index }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.stashApply(resolved, index).pipe(Effect.mapError(toConflictError))
      )
    ),
  stashDrop: ({ repoPath, index }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.stashDrop(resolved, index).pipe(Effect.mapError(toReadError))
      )
    ),
  stashPush: ({ repoPath, message, includeUntracked, files }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => {
        const resolvedFiles: Effect.Effect<string[] | undefined, RpcGitError> =
          files === undefined ? Effect.succeed(undefined) : resolveFiles(resolved, files)
        return resolvedFiles.pipe(
          Effect.flatMap((relatives) =>
            operations
              .stashPush(resolved, message || undefined, includeUntracked === true, relatives)
              .pipe(Effect.mapError(toReadError))
          )
        )
      })
    ),
  reset: ({ repoPath, sha, mode }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.resetToCommit(resolved, sha, mode).pipe(Effect.mapError(toReadError))
      )
    ),
  fetch: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.fetchRepo(resolved).pipe(Effect.mapError(toFetchError))
      )
    ),
  push: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => operations.pushRepo(resolved).pipe(Effect.mapError(toReadError)))
    ),
  pull: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => operations.pullRepo(resolved).pipe(Effect.mapError(toReadError)))
    ),
  getStatus: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.getStatus(resolved).pipe(Effect.mapError(toReadError))
      )
    ),
  getBranches: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.getBranches(resolved).pipe(Effect.mapError(toReadError))
      )
    ),
  getLocalBranches: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.getLocalBranches(resolved).pipe(Effect.mapError(toReadError))
      )
    ),
  getRemoteRefs: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.getRemoteRefs(resolved).pipe(Effect.mapError(toReadError))
      )
    ),
  getLog: ({ repoPath, maxCount }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.getLog(resolved, maxCount).pipe(Effect.mapError(toReadError))
      )
    ),
  getDiff: ({ repoPath, file, staged }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => {
        const relative = resolveRepoRelativeFile(resolved, file)
        if (!relative) {
          return Effect.fail(new RpcGitError({ message: INVALID_REPO_PATH }))
        }
        return operations
          .getDiff(resolved, relative, staged === true)
          .pipe(Effect.mapError(toReadError))
      })
    ),
  stashList: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.stashList(resolved).pipe(Effect.mapError(toReadError))
      )
    )
})

// toWebHandler is built on HttpRouter, so it asks for the HTTP platform services even though the
// RPC path never touches the filesystem — a no-op FileSystem keeps platform-node (and its native
// @parcel/watcher build) out of the dependency tree.
const fileSystemLayer = FileSystem.layerNoop({})
const platformLayer = Layer.mergeAll(
  fileSystemLayer,
  Path.layer,
  Etag.layer,
  HttpPlatform.layer.pipe(Layer.provide(fileSystemLayer))
)

const rpcLayer = Layer.mergeAll(handlersLayer, RpcSerialization.layerNdjson, platformLayer)

const webHandler = RpcServer.toWebHandler(SidecarRpcs, { layer: rpcLayer })

export const handleRpcRequest = (request: Request): Promise<Response> => webHandler.handler(request)
