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
import { RepoSessionsLive } from './repo-sessions'

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

const withResolvedRepo = <A, E, R>(
  repoPath: string,
  use: (repoRoot: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | GitError, R> => resolveRepo(repoPath).pipe(Effect.flatMap(use))

const withResolvedFile = <A, E, R>(
  repoRoot: string,
  file: string,
  use: (relative: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | GitError, R> => resolveFile(repoRoot, file).pipe(Effect.flatMap(use))

const withResolvedFiles = <A, E, R>(
  repoRoot: string,
  files: readonly string[],
  use: (relatives: string[]) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | GitError, R> => resolveFiles(repoRoot, files).pipe(Effect.flatMap(use))

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
    withResolvedRepo(repoPath, (repo) => operations.commit(repo, message)),
  getHeadCommit: ({ repoPath }) =>
    withResolvedRepo(repoPath, (repo) => operations.getHeadCommit(repo)),
  amendCommit: ({ repoPath, message, droppedHeadPaths }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFiles(repo, droppedHeadPaths, (relatives) =>
        operations.amendCommit(repo, message, relatives)
      )
    ),
  stageFile: ({ repoPath, file }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFile(repo, file, (relative) => operations.stageFile(repo, relative))
    ),
  unstageFile: ({ repoPath, file }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFile(repo, file, (relative) => operations.unstageFile(repo, relative))
    ),
  stageAll: ({ repoPath, files }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFiles(repo, files, (relatives) => operations.stageAll(repo, relatives))
    ),
  unstageAll: ({ repoPath, files }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFiles(repo, files, (relatives) => operations.unstageAll(repo, relatives))
    ),
  stageHunk: ({ repoPath, file, hunkHeader }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFile(repo, file, (relative) => operations.stageHunk(repo, relative, hunkHeader))
    ),
  unstageHunk: ({ repoPath, file, hunkHeader }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFile(repo, file, (relative) => operations.unstageHunk(repo, relative, hunkHeader))
    ),
  discardChanges: ({ repoPath, files }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFiles(repo, files, (relatives) => operations.discardChanges(repo, relatives))
    ),
  discardAll: ({ repoPath }) => withResolvedRepo(repoPath, (repo) => operations.discardAll(repo)),
  mergeBranch: ({ repoPath, ref }) =>
    withResolvedRepo(repoPath, (repo) => operations.mergeBranch(repo, ref)),
  revertCommit: ({ repoPath, sha }) =>
    withResolvedRepo(repoPath, (repo) => operations.revertCommit(repo, sha)),
  cherryPick: ({ repoPath, sha }) =>
    withResolvedRepo(repoPath, (repo) => operations.cherryPick(repo, sha)),
  checkout: ({ repoPath, refKind, fullPath }) =>
    withResolvedRepo(repoPath, (repo) => operations.checkoutRef(repo, refKind, fullPath)),
  createBranch: ({ repoPath, name, startPoint, checkout }) =>
    withResolvedRepo(repoPath, (repo) =>
      operations.createBranch(repo, name, startPoint || undefined, checkout === true)
    ),
  deleteBranch: ({ repoPath, name, force }) =>
    withResolvedRepo(repoPath, (repo) => operations.deleteBranch(repo, name, force === true)),
  renameBranch: ({ repoPath, oldName, newName }) =>
    withResolvedRepo(repoPath, (repo) => operations.renameBranch(repo, oldName, newName)),
  createTag: ({ repoPath, name, ref, message }) =>
    withResolvedRepo(repoPath, (repo) =>
      operations.createTag(repo, name, ref || undefined, message || undefined)
    ),
  deleteTag: ({ repoPath, name }) =>
    withResolvedRepo(repoPath, (repo) => operations.deleteTag(repo, name)),
  stashPop: ({ repoPath, index }) =>
    withResolvedRepo(repoPath, (repo) => operations.stashPop(repo, index)),
  stashApply: ({ repoPath, index }) =>
    withResolvedRepo(repoPath, (repo) => operations.stashApply(repo, index)),
  stashDrop: ({ repoPath, index }) =>
    withResolvedRepo(repoPath, (repo) => operations.stashDrop(repo, index)),
  stashPush: ({ repoPath, message, includeUntracked, files }) =>
    withResolvedRepo(repoPath, (repo) => {
      const resolvedFiles: Effect.Effect<string[] | undefined, GitError> =
        files === undefined ? Effect.succeed(undefined) : resolveFiles(repo, files)
      return resolvedFiles.pipe(
        Effect.flatMap((relatives) =>
          operations.stashPush(repo, message || undefined, includeUntracked === true, relatives)
        )
      )
    }),
  reset: ({ repoPath, sha, mode }) =>
    withResolvedRepo(repoPath, (repo) => operations.resetToCommit(repo, sha, mode)),
  fetch: ({ repoPath }) => withResolvedRepo(repoPath, (repo) => operations.fetchRepo(repo)),
  push: ({ repoPath, force, expectedRemoteSha }) =>
    withResolvedRepo(repoPath, (repo) => operations.pushRepo(repo, force, expectedRemoteSha)),
  pull: ({ repoPath }) => withResolvedRepo(repoPath, (repo) => operations.pullRepo(repo)),
  getStatus: ({ repoPath }) => withResolvedRepo(repoPath, (repo) => operations.getStatus(repo)),
  getBranches: ({ repoPath }) => withResolvedRepo(repoPath, (repo) => operations.getBranches(repo)),
  getLocalBranches: ({ repoPath }) =>
    withResolvedRepo(repoPath, (repo) => operations.getLocalBranches(repo)),
  getRemoteRefs: ({ repoPath }) =>
    withResolvedRepo(repoPath, (repo) => operations.getRemoteRefs(repo)),
  getLog: ({ repoPath, maxCount }) =>
    withResolvedRepo(repoPath, (repo) => operations.getLog(repo, maxCount)),
  getDiff: ({ repoPath, file, staged }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFile(repo, file, (relative) =>
        operations.getDiff(repo, relative, staged === true)
      )
    ),
  stashList: ({ repoPath }) => withResolvedRepo(repoPath, (repo) => operations.stashList(repo)),
  streamLog: ({ repoPath, skip, maxCount, streamId }) =>
    Stream.unwrap(
      resolveRepo(repoPath).pipe(
        Effect.map((resolved) => logChunkStream(resolved, { skip, maxCount, streamId }))
      )
    )
}).pipe(Layer.provide(RepoSessionsLive))

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
