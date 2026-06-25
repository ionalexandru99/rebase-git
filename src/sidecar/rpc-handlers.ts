import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
import { Etag, FileSystem, HttpPlatform, Path } from '@effect/platform'
import { RpcSerialization, RpcServer } from '@effect/rpc'
import { GitError, SidecarRpcs } from '@shared/rpc'
import { Effect, Layer, Stream } from 'effect'
import { simpleGit } from 'simple-git'
import { normalizeRepoPath } from './git/instances'
import { logChunkStream } from './log-stream'
import * as operations from './operations'
import { resolveExistingRepoRoot, resolveRepoRelativeFile } from './path-guards'

const INVALID_REPO_PATH = 'invalid repository path'
const INVALID_DIRECTORY_PATH = 'invalid directory path'

const resolveRepo = (repoPath: string): Effect.Effect<string, GitError> =>
  Effect.suspend(() => {
    const resolved = resolveExistingRepoRoot(repoPath)
    return resolved
      ? Effect.succeed(resolved)
      : Effect.fail(new GitError({ message: INVALID_REPO_PATH }))
  })

const resolveFile = (repoRoot: string, file: string): Effect.Effect<string, GitError> =>
  Effect.suspend(() => {
    const relative = resolveRepoRelativeFile(repoRoot, file)
    return relative
      ? Effect.succeed(relative)
      : Effect.fail(new GitError({ message: INVALID_REPO_PATH }))
  })

const resolveFiles = (
  repoRoot: string,
  files: readonly string[]
): Effect.Effect<string[], GitError> =>
  Effect.suspend(() => {
    const resolved: string[] = []
    for (const file of files) {
      const relative = resolveRepoRelativeFile(repoRoot, file)
      if (!relative) {
        return Effect.fail(new GitError({ message: INVALID_REPO_PATH }))
      }
      resolved.push(relative)
    }
    return Effect.succeed(resolved)
  })

// scanForRepos confines enumeration to the user's home tree. The guard mirrors the previous
// scanForReposSafely: absolute, no `..`/NUL, realpath must be a directory under the realpath'd home
// root. Any violation fails with the typed GitError('invalid directory path').
const scanForReposGuarded = (requestedDirPath: string): Effect.Effect<string[], GitError> =>
  Effect.tryPromise({
    try: async () => {
      if (!requestedDirPath || requestedDirPath.includes('\0')) {
        throw new Error(INVALID_DIRECTORY_PATH)
      }
      if (!nodePath.isAbsolute(requestedDirPath)) {
        throw new Error(INVALID_DIRECTORY_PATH)
      }
      if (requestedDirPath.split(/[/\\]/).includes('..')) {
        throw new Error(INVALID_DIRECTORY_PATH)
      }

      let scanRoot: string
      let homeRoot: string
      try {
        scanRoot = fs.realpathSync.native(nodePath.resolve(requestedDirPath))
        if (!fs.statSync(scanRoot).isDirectory()) {
          throw new Error(INVALID_DIRECTORY_PATH)
        }
        homeRoot = fs.realpathSync.native(os.homedir())
      } catch {
        throw new Error(INVALID_DIRECTORY_PATH)
      }

      const resolvedPath = nodePath.resolve(requestedDirPath)
      const scanRootPrefix = scanRoot.endsWith(nodePath.sep)
        ? scanRoot
        : `${scanRoot}${nodePath.sep}`
      if (resolvedPath !== scanRoot && !resolvedPath.startsWith(scanRootPrefix)) {
        throw new Error(INVALID_DIRECTORY_PATH)
      }

      const homePrefix = homeRoot.endsWith(nodePath.sep) ? homeRoot : `${homeRoot}${nodePath.sep}`
      if (scanRoot !== homeRoot && !scanRoot.startsWith(homePrefix)) {
        throw new Error(INVALID_DIRECTORY_PATH)
      }

      const entries = await fs.promises.readdir(scanRoot, { withFileTypes: true })
      const repos: string[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }
        const childName = nodePath.basename(entry.name)
        if (childName !== entry.name) {
          continue
        }
        const childPath = nodePath.join(scanRoot, childName)
        if (!childPath.startsWith(scanRootPrefix)) {
          continue
        }
        try {
          const isRepo = await simpleGit(childPath).checkIsRepo()
          if (isRepo) {
            repos.push(childPath)
          }
        } catch {}
      }
      return repos
    },
    catch: (error) =>
      new GitError({ message: error instanceof Error ? error.message : String(error) })
  })

export const handlersLayer = SidecarRpcs.toLayer({
  openRepo: ({ repoPath }) =>
    Effect.suspend(() => {
      const resolved = resolveExistingRepoRoot(repoPath)
      if (!resolved) {
        return Effect.fail(new GitError({ message: INVALID_REPO_PATH }))
      }
      return operations.openRepo(resolved)
    }),
  closeRepo: ({ repoPath }) =>
    Effect.suspend(() => {
      const resolved = resolveExistingRepoRoot(repoPath)
      return operations.closeRepo(resolved ?? normalizeRepoPath(repoPath))
    }),
  scanForRepos: ({ dirPath }) =>
    scanForReposGuarded(dirPath).pipe(Effect.map((repos) => ({ repos }))),
  commit: ({ repoPath, message }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.commit(resolved, message))),
  stageFile: ({ repoPath, file }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFile(resolved, file).pipe(
          Effect.flatMap((relative) => operations.stageFile(resolved, relative))
        )
      )
    ),
  unstageFile: ({ repoPath, file }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFile(resolved, file).pipe(
          Effect.flatMap((relative) => operations.unstageFile(resolved, relative))
        )
      )
    ),
  stageAll: ({ repoPath, files }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFiles(resolved, files).pipe(
          Effect.flatMap((relatives) => operations.stageAll(resolved, relatives))
        )
      )
    ),
  unstageAll: ({ repoPath, files }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFiles(resolved, files).pipe(
          Effect.flatMap((relatives) => operations.unstageAll(resolved, relatives))
        )
      )
    ),
  stageHunk: ({ repoPath, file, hunkHeader }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFile(resolved, file).pipe(
          Effect.flatMap((relative) => operations.stageHunk(resolved, relative, hunkHeader))
        )
      )
    ),
  unstageHunk: ({ repoPath, file, hunkHeader }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFile(resolved, file).pipe(
          Effect.flatMap((relative) => operations.unstageHunk(resolved, relative, hunkHeader))
        )
      )
    ),
  discardChanges: ({ repoPath, files }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        resolveFiles(resolved, files).pipe(
          Effect.flatMap((relatives) => operations.discardChanges(resolved, relatives))
        )
      )
    ),
  discardAll: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.discardAll(resolved))),
  mergeBranch: ({ repoPath, ref }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.mergeBranch(resolved, ref))),
  revertCommit: ({ repoPath, sha }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => operations.revertCommit(resolved, sha))
    ),
  cherryPick: ({ repoPath, sha }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.cherryPick(resolved, sha))),
  checkout: ({ repoPath, refKind, fullPath }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => operations.checkoutRef(resolved, refKind, fullPath))
    ),
  createBranch: ({ repoPath, name, startPoint, checkout }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.createBranch(resolved, name, startPoint || undefined, checkout === true)
      )
    ),
  deleteBranch: ({ repoPath, name, force }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => operations.deleteBranch(resolved, name, force === true))
    ),
  renameBranch: ({ repoPath, oldName, newName }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => operations.renameBranch(resolved, oldName, newName))
    ),
  createTag: ({ repoPath, name, ref, message }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) =>
        operations.createTag(resolved, name, ref || undefined, message || undefined)
      )
    ),
  deleteTag: ({ repoPath, name }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.deleteTag(resolved, name))),
  stashPop: ({ repoPath, index }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.stashPop(resolved, index))),
  stashApply: ({ repoPath, index }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => operations.stashApply(resolved, index))
    ),
  stashDrop: ({ repoPath, index }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.stashDrop(resolved, index))),
  stashPush: ({ repoPath, message, includeUntracked, files }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => {
        const resolvedFiles: Effect.Effect<string[] | undefined, GitError> =
          files === undefined ? Effect.succeed(undefined) : resolveFiles(resolved, files)
        return resolvedFiles.pipe(
          Effect.flatMap((relatives) =>
            operations.stashPush(
              resolved,
              message || undefined,
              includeUntracked === true,
              relatives
            )
          )
        )
      })
    ),
  reset: ({ repoPath, sha, mode }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => operations.resetToCommit(resolved, sha, mode))
    ),
  fetch: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.fetchRepo(resolved))),
  push: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.pushRepo(resolved))),
  pull: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.pullRepo(resolved))),
  getStatus: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.getStatus(resolved))),
  getBranches: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.getBranches(resolved))),
  getLocalBranches: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.getLocalBranches(resolved))),
  getRemoteRefs: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.getRemoteRefs(resolved))),
  getLog: ({ repoPath, maxCount }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.getLog(resolved, maxCount))),
  getDiff: ({ repoPath, file, staged }) =>
    resolveRepo(repoPath).pipe(
      Effect.flatMap((resolved) => {
        const relative = resolveRepoRelativeFile(resolved, file)
        if (!relative) {
          return Effect.fail(new GitError({ message: INVALID_REPO_PATH }))
        }
        return operations.getDiff(resolved, relative, staged === true)
      })
    ),
  stashList: ({ repoPath }) =>
    resolveRepo(repoPath).pipe(Effect.flatMap((resolved) => operations.stashList(resolved))),
  streamLog: ({ repoPath, skip, maxCount, streamId }) =>
    Stream.unwrap(
      resolveRepo(repoPath).pipe(
        Effect.map((resolved) => logChunkStream(resolved, { skip, maxCount, streamId }))
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
