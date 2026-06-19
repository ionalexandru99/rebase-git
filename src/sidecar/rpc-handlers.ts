import { Etag, FileSystem, HttpPlatform, Path } from '@effect/platform'
import { RpcSerialization, RpcServer } from '@effect/rpc'
import { GitError as RpcGitError, RepoNotOpen as RpcRepoNotOpen, SidecarRpcs } from '@shared/rpc'
import { Effect, Layer } from 'effect'
import type { GitError, RepoNotOpen } from './git-errors'
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

// Read ops fail only with the sidecar-internal RepoNotOpen/GitError; project them onto the RPC
// group's Schema-defined error classes so they serialize on the typed error channel.
const toReadError = (error: RepoNotOpen | GitError): RpcRepoNotOpen | RpcGitError =>
  error._tag === 'RepoNotOpen' ? new RpcRepoNotOpen() : new RpcGitError({ message: error.message })

const handlersLayer = SidecarRpcs.toLayer({
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
