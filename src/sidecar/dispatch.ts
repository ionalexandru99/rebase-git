import { SidecarOp, type SidecarOpName } from '@shared/sidecar-ops'
import { type SidecarRequest, sidecarRegistry } from '@shared/sidecar-registry'
import { Cause, Effect, Either, ManagedRuntime, Option, Schema } from 'effect'
import type { GitOpError } from './git-errors'
import * as operations from './operations'
import { resolveExistingRepoRoot, resolveRepoRelativeFile } from './path-guards'
import { RepoSessionsLive } from './repo-sessions'

export const BAD_REQUEST = Symbol('bad-request')

type Body = Record<string, unknown>

const INVALID_REPO_PATH = 'invalid repository path'
const invalidRepoWire = { _tag: 'GitError', message: INVALID_REPO_PATH } as const

const runtime = ManagedRuntime.make(RepoSessionsLive)

type WireResult = Record<string, unknown>

const errorToWire = (error: GitOpError): WireResult => {
  switch (error._tag) {
    case 'GitError':
    case 'Conflict':
      return { _tag: error._tag, message: error.message }
    default:
      return { _tag: error._tag }
  }
}

// Fold an operation's Effect back onto the legacy `{ _tag, ... }` wire envelope the renderer's
// response schemas validate: success spreads the bare payload under `Ok`, each tagged error becomes
// its matching `_tag` (+ message where it carries one). A defect (an unexpected throw outside the
// typed error channel) collapses to a `GitError` so an op never escalates to an HTTP 500 — matching
// the previous all-in-try/catch behavior. Output is trusted (typed constructors), not re-validated.
const foldToWire = (effect: Effect.Effect<unknown, GitOpError>): Effect.Effect<WireResult> =>
  Effect.matchCause(effect, {
    onSuccess: (value: unknown): WireResult =>
      value === undefined || value === null ? { _tag: 'Ok' } : { _tag: 'Ok', ...(value as object) },
    onFailure: (cause: Cause.Cause<GitOpError>): WireResult => {
      const failure = Cause.failureOption(cause)
      if (Option.isSome(failure)) {
        return errorToWire(failure.value)
      }
      const defect = Cause.squash(cause)
      return {
        _tag: 'GitError',
        message: defect instanceof Error ? defect.message : String(defect)
      }
    }
  })

const runOp = (effect: Effect.Effect<unknown, GitOpError>): Promise<WireResult> =>
  runtime.runPromise(foldToWire(effect))

export const resolveRepoRelativeFiles = (repoPath: string, body: Body): string[] | null => {
  const value = body.files
  if (!Array.isArray(value)) {
    return null
  }
  const resolved: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return null
    }
    const relative = resolveRepoRelativeFile(repoPath, entry)
    if (!relative) {
      return null
    }
    resolved.push(relative)
  }
  return resolved
}

// Ops with bespoke repoPath handling (open/close) and the dirPath-based scan are dispatched
// outside the uniform table.
type DispatchOp = Exclude<
  SidecarOpName,
  typeof SidecarOp.openRepo | typeof SidecarOp.closeRepo | typeof SidecarOp.scanForRepos
>

interface HandlerCtx<Op extends SidecarOpName> {
  repoPath: string
  request: SidecarRequest<Op>
  file: string
  files: string[]
}

interface OpHandler<Op extends SidecarOpName> {
  file?: 'single' | 'array' | 'optionalArray'
  handle: (ctx: HandlerCtx<Op>) => Effect.Effect<unknown, GitOpError>
}

const opHandlers: { [Op in DispatchOp]: OpHandler<Op> } = {
  [SidecarOp.getBranches]: {
    handle: ({ repoPath }) => operations.getBranches(repoPath)
  },
  [SidecarOp.getLocalBranches]: {
    handle: ({ repoPath }) => operations.getLocalBranches(repoPath)
  },
  [SidecarOp.getRemoteRefs]: {
    handle: ({ repoPath }) => operations.getRemoteRefs(repoPath)
  },
  [SidecarOp.getStatus]: {
    handle: ({ repoPath }) => operations.getStatus(repoPath)
  },
  [SidecarOp.getDiff]: {
    file: 'single',
    handle: ({ repoPath, file, request }) =>
      operations.getDiff(repoPath, file, request.staged === true)
  },
  [SidecarOp.getLog]: {
    handle: ({ repoPath, request }) => operations.getLog(repoPath, request.maxCount)
  },
  [SidecarOp.stashList]: {
    handle: ({ repoPath }) => operations.stashList(repoPath)
  }
}

type ErasedEntry = {
  file?: 'single' | 'array' | 'optionalArray'
  handle: (ctx: {
    repoPath: string
    request: Record<string, unknown>
    file: string
    files: string[]
  }) => Effect.Effect<unknown, GitOpError>
}

const handlerTable = opHandlers as unknown as Record<string, ErasedEntry | undefined>

const decodeRequest = (op: SidecarOpName, body: Body): Record<string, unknown> | null => {
  const schema = sidecarRegistry[op].request as unknown as Schema.Schema<Record<string, unknown>>
  return Either.getOrUndefined(Schema.decodeUnknownEither(schema)(body)) ?? null
}

export async function dispatch(op: string, body: Body): Promise<unknown> {
  if (op === SidecarOp.openRepo) {
    const decoded = decodeRequest(SidecarOp.openRepo, body)
    if (!decoded) {
      return BAD_REQUEST
    }
    const repoPath = resolveExistingRepoRoot(decoded.repoPath as string)
    return repoPath ? runOp(operations.openRepo(repoPath)) : { ...invalidRepoWire }
  }

  if (op === SidecarOp.closeRepo) {
    const decoded = decodeRequest(SidecarOp.closeRepo, body)
    if (!decoded) {
      return BAD_REQUEST
    }
    const repoPath = resolveExistingRepoRoot(decoded.repoPath as string)
    if (repoPath) {
      return await runOp(operations.closeRepo(repoPath))
    }
    return { _tag: 'Ok' }
  }

  const entry = handlerTable[op]
  if (!entry) {
    return undefined
  }

  const decoded = decodeRequest(op as SidecarOpName, body)
  if (!decoded) {
    return BAD_REQUEST
  }

  const repoPath = resolveExistingRepoRoot(decoded.repoPath as string)
  if (!repoPath) {
    return { ...invalidRepoWire }
  }

  let file = ''
  let files: string[] = []
  if (entry.file === 'single') {
    const resolved = resolveRepoRelativeFile(repoPath, decoded.file as string)
    if (!resolved) {
      return { ...invalidRepoWire }
    }
    file = resolved
  } else if (entry.file === 'array') {
    const resolved = resolveRepoRelativeFiles(repoPath, body)
    if (!resolved) {
      return BAD_REQUEST
    }
    files = resolved
  } else if (entry.file === 'optionalArray' && decoded.files !== undefined) {
    const resolved = resolveRepoRelativeFiles(repoPath, body)
    if (!resolved) {
      return BAD_REQUEST
    }
    files = resolved
  }

  return runOp(entry.handle({ repoPath, request: decoded, file, files }))
}
