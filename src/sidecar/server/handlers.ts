import fs from 'node:fs'
import nodePath from 'node:path'
import { Etag, FileSystem, HttpPlatform, Path } from '@effect/platform'
import { RpcSerialization, RpcServer } from '@effect/rpc'
import { GitError, SidecarRpcs } from '@shared/rpc'
import { Effect, Layer, Stream } from 'effect'
import { createGit, normalizeRepoPath } from '../git/instances'
import {
  resolveDirectoryWithinHome,
  resolveExistingRepoRoot,
  resolveRepoRelativeFile
} from '../git/path-guards'
import { isCloneStagingName } from '../operations/clone'
import { requireOpen } from '../operations/helpers'
import * as operations from '../operations/index'
import { clearLogContinuation, logChunkStream } from '../operations/log-stream'
import { RepoSessionsLive } from '../session/sessions'

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

const resolveDroppedHunks = (
  repoRoot: string,
  entries: readonly { file: string; hunks: readonly string[] }[]
): Effect.Effect<{ file: string; hunks: readonly string[] }[], GitError> =>
  Effect.suspend(() => {
    const resolved: { file: string; hunks: readonly string[] }[] = []
    for (const entry of entries) {
      const relative = resolveRepoRelativeFile(repoRoot, entry.file)
      if (!relative) {
        return Effect.fail(new GitError({ message: INVALID_REPO_PATH }))
      }
      resolved.push({ file: relative, hunks: entry.hunks })
    }
    return Effect.succeed(resolved)
  })

const scanForReposGuarded = (requestedDirPath: string): Effect.Effect<string[], GitError> =>
  Effect.tryPromise({
    try: async () => {
      const scanRoot = resolveDirectoryWithinHome(requestedDirPath)
      if (!scanRoot) {
        throw new Error(INVALID_DIRECTORY_PATH)
      }
      const scanRootPrefix = scanRoot.endsWith(nodePath.sep)
        ? scanRoot
        : `${scanRoot}${nodePath.sep}`

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
        // A clone in flight keeps a real working tree in its staging directory; offering it here
        // would let the user open a repository that is still being written.
        if (isCloneStagingName(childName)) {
          continue
        }
        const childPath = nodePath.join(scanRoot, childName)
        if (!childPath.startsWith(scanRootPrefix)) {
          continue
        }
        try {
          const isRepo = await createGit(childPath).checkIsRepo()
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
      const normalized = resolved ?? normalizeRepoPath(repoPath)
      return Effect.promise(() => clearLogContinuation(normalized)).pipe(
        Effect.zipRight(operations.closeRepo(normalized))
      )
    }),
  scanForRepos: ({ dirPath }) =>
    scanForReposGuarded(dirPath).pipe(Effect.map((repos) => ({ repos }))),
  cloneRepo: ({ url, parentDir, folderName }) =>
    operations.cloneRepo({ url, parentDir, folderName }),
  commit: ({ repoPath, message }) =>
    withResolvedRepo(repoPath, (repo) => operations.commit(repo, message)),
  getHeadCommit: ({ repoPath }) =>
    withResolvedRepo(repoPath, (repo) => operations.getHeadCommit(repo)),
  amendCommit: ({ repoPath, message, expectedHead, droppedHeadPaths, droppedHeadHunks }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFiles(repo, droppedHeadPaths, (relatives) =>
        resolveDroppedHunks(repo, droppedHeadHunks).pipe(
          Effect.flatMap((hunks) =>
            operations.amendCommit(repo, message, relatives, hunks, expectedHead)
          )
        )
      )
    ),
  stageFile: ({ repoPath, file }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFile(repo, file, (relative) => operations.stageFile(repo, relative))
    ),
  unstageFile: ({ repoPath, file, renameSource }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFiles(repo, renameSource ? [renameSource, file] : [file], (relatives) =>
        operations.unstageFile(
          repo,
          relatives[relatives.length - 1],
          relatives.length === 2 ? relatives[0] : undefined
        )
      )
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
  mergeBranch: ({ repoPath, refKind, fullPath }) =>
    withResolvedRepo(repoPath, (repo) => operations.mergeBranch(repo, refKind, fullPath)),
  revertCommit: ({ repoPath, sha }) =>
    withResolvedRepo(repoPath, (repo) => operations.revertCommit(repo, sha)),
  cherryPick: ({ repoPath, sha }) =>
    withResolvedRepo(repoPath, (repo) => operations.cherryPick(repo, sha)),
  checkout: ({ repoPath, refKind, fullPath }) =>
    withResolvedRepo(repoPath, (repo) => operations.checkoutRef(repo, refKind, fullPath)),
  createBranch: ({ repoPath, name, startPoint, startPointKind, checkout }) =>
    withResolvedRepo(repoPath, (repo) =>
      operations.createBranch(
        repo,
        name,
        startPoint || undefined,
        checkout === true,
        startPointKind
      )
    ),
  deleteBranch: ({ repoPath, name, force }) =>
    withResolvedRepo(repoPath, (repo) => operations.deleteBranch(repo, name, force === true)),
  renameBranch: ({ repoPath, oldName, newName }) =>
    withResolvedRepo(repoPath, (repo) => operations.renameBranch(repo, oldName, newName)),
  createTag: ({ repoPath, name, ref, refKind, message }) =>
    withResolvedRepo(repoPath, (repo) =>
      operations.createTag(repo, name, ref || undefined, message || undefined, refKind)
    ),
  deleteTag: ({ repoPath, name }) =>
    withResolvedRepo(repoPath, (repo) => operations.deleteTag(repo, name)),
  stashPop: ({ repoPath, index, expectedOid }) =>
    withResolvedRepo(repoPath, (repo) => operations.stashPop(repo, index, expectedOid)),
  stashApply: ({ repoPath, index, expectedOid }) =>
    withResolvedRepo(repoPath, (repo) => operations.stashApply(repo, index, expectedOid)),
  stashDrop: ({ repoPath, index, expectedOid }) =>
    withResolvedRepo(repoPath, (repo) => operations.stashDrop(repo, index, expectedOid)),
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
  getLocalBranches: ({ repoPath }) =>
    withResolvedRepo(repoPath, (repo) => operations.getLocalBranches(repo)),
  getRemoteRefs: ({ repoPath }) =>
    withResolvedRepo(repoPath, (repo) => operations.getRemoteRefs(repo)),
  getDiff: ({ repoPath, file, staged, range, commit, renameSource }) =>
    withResolvedRepo(repoPath, (repo) =>
      withResolvedFiles(repo, renameSource ? [renameSource, file] : [file], (relatives) =>
        operations.getDiff(repo, relatives[relatives.length - 1], staged === true, {
          range,
          commit,
          renameSource: relatives.length === 2 ? relatives[0] : undefined
        })
      )
    ),
  getCommitDetail: ({ repoPath, sha }) =>
    withResolvedRepo(repoPath, (repo) => operations.getCommitDetail(repo, sha)),
  stashList: ({ repoPath }) => withResolvedRepo(repoPath, (repo) => operations.stashList(repo)),
  streamLog: ({ repoPath, skip, maxCount, streamId }) =>
    Stream.unwrap(
      resolveRepo(repoPath).pipe(
        Effect.flatMap((resolved) =>
          requireOpen(resolved).pipe(
            Effect.as(logChunkStream(resolved, { skip, maxCount, streamId }))
          )
        )
      )
    )
}).pipe(Layer.provide(RepoSessionsLive))

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
