import { Etag, FileSystem, HttpPlatform, Path } from '@effect/platform'
import { RpcSerialization, RpcServer } from '@effect/rpc'
import { GitError, RepoNotOpen, SidecarRpcs } from '@shared/rpc'
import { Effect, Layer } from 'effect'
import * as operations from './operations'
import { resolveExistingRepoRoot, resolveRepoRelativeFile } from './path-guards'

const INVALID_REPO_PATH = 'invalid repository path'

const resolveRepo = (repoPath: string): Effect.Effect<string, GitError> =>
  Effect.suspend(() => {
    const resolved = resolveExistingRepoRoot(repoPath)
    return resolved
      ? Effect.succeed(resolved)
      : Effect.fail(new GitError({ message: INVALID_REPO_PATH }))
  })

const handlersLayer = SidecarRpcs.toLayer({
  getStatus: ({ repoPath }) =>
    Effect.gen(function* () {
      const resolved = yield* resolveRepo(repoPath)
      const result = yield* Effect.promise(() => operations.getStatus(resolved))
      if (result._tag === 'RepoNotOpen') {
        return yield* Effect.fail(new RepoNotOpen())
      }
      if (result._tag === 'GitError') {
        return yield* Effect.fail(new GitError({ message: result.message }))
      }
      return { status: result.status }
    }),
  getBranches: ({ repoPath }) =>
    Effect.gen(function* () {
      const resolved = yield* resolveRepo(repoPath)
      const result = yield* Effect.promise(() => operations.getBranches(resolved))
      if (result._tag === 'RepoNotOpen') {
        return yield* Effect.fail(new RepoNotOpen())
      }
      if (result._tag === 'GitError') {
        return yield* Effect.fail(new GitError({ message: result.message }))
      }
      return { branches: result.branches }
    }),
  getLocalBranches: ({ repoPath }) =>
    Effect.gen(function* () {
      const resolved = yield* resolveRepo(repoPath)
      const result = yield* Effect.promise(() => operations.getLocalBranches(resolved))
      if (result._tag === 'RepoNotOpen') {
        return yield* Effect.fail(new RepoNotOpen())
      }
      if (result._tag === 'GitError') {
        return yield* Effect.fail(new GitError({ message: result.message }))
      }
      return { branches: result.branches }
    }),
  getRemoteRefs: ({ repoPath }) =>
    Effect.gen(function* () {
      const resolved = yield* resolveRepo(repoPath)
      const result = yield* Effect.promise(() => operations.getRemoteRefs(resolved))
      if (result._tag === 'RepoNotOpen') {
        return yield* Effect.fail(new RepoNotOpen())
      }
      if (result._tag === 'GitError') {
        return yield* Effect.fail(new GitError({ message: result.message }))
      }
      return { refs: result.refs }
    }),
  getLog: ({ repoPath, maxCount }) =>
    Effect.gen(function* () {
      const resolved = yield* resolveRepo(repoPath)
      const result = yield* Effect.promise(() => operations.getLog(resolved, maxCount))
      if (result._tag === 'RepoNotOpen') {
        return yield* Effect.fail(new RepoNotOpen())
      }
      if (result._tag === 'GitError') {
        return yield* Effect.fail(new GitError({ message: result.message }))
      }
      return { log: result.log }
    }),
  getDiff: ({ repoPath, file, staged }) =>
    Effect.gen(function* () {
      const resolved = yield* resolveRepo(repoPath)
      const relative = resolveRepoRelativeFile(resolved, file)
      if (!relative) {
        return yield* Effect.fail(new GitError({ message: INVALID_REPO_PATH }))
      }
      const result = yield* Effect.promise(() =>
        operations.getDiff(resolved, relative, staged === true)
      )
      if (result._tag === 'RepoNotOpen') {
        return yield* Effect.fail(new RepoNotOpen())
      }
      if (result._tag === 'GitError') {
        return yield* Effect.fail(new GitError({ message: result.message }))
      }
      return { diff: result.diff }
    }),
  stashList: ({ repoPath }) =>
    Effect.gen(function* () {
      const resolved = yield* resolveRepo(repoPath)
      const result = yield* Effect.promise(() => operations.stashList(resolved))
      if (result._tag === 'RepoNotOpen') {
        return yield* Effect.fail(new RepoNotOpen())
      }
      if (result._tag === 'GitError') {
        return yield* Effect.fail(new GitError({ message: result.message }))
      }
      return { stashes: result.stashes }
    })
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
