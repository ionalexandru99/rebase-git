import { SidecarOp, type SidecarOpName } from '@shared/sidecar-ops'
import { type SidecarRequest, sidecarRegistry } from '@shared/sidecar-registry'
import { Either, Schema } from 'effect'
import * as operations from './operations'
import { resolveExistingRepoRoot, resolveRepoRelativeFile } from './path-guards'

export const BAD_REQUEST = Symbol('bad-request')

type Body = Record<string, unknown>

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
  onInvalidRepo: () => unknown
  file?: 'single' | 'array' | 'optionalArray'
  onInvalidFile?: () => unknown
  handle: (ctx: HandlerCtx<Op>) => Promise<unknown> | unknown
}

const { invalidRepoPath } = operations

const opHandlers: { [Op in DispatchOp]: OpHandler<Op> } = {
  [SidecarOp.getBranches]: {
    onInvalidRepo: invalidRepoPath.branches,
    handle: ({ repoPath }) => operations.getBranches(repoPath)
  },
  [SidecarOp.getLocalBranches]: {
    onInvalidRepo: invalidRepoPath.localBranches,
    handle: ({ repoPath }) => operations.getLocalBranches(repoPath)
  },
  [SidecarOp.getRemoteRefs]: {
    onInvalidRepo: invalidRepoPath.remoteRefs,
    handle: ({ repoPath }) => operations.getRemoteRefs(repoPath)
  },
  [SidecarOp.getStatus]: {
    onInvalidRepo: invalidRepoPath.status,
    handle: ({ repoPath }) => operations.getStatus(repoPath)
  },
  [SidecarOp.stageFile]: {
    onInvalidRepo: invalidRepoPath.stage,
    file: 'single',
    onInvalidFile: invalidRepoPath.stage,
    handle: ({ repoPath, file }) => operations.stageFile(repoPath, file)
  },
  [SidecarOp.unstageFile]: {
    onInvalidRepo: invalidRepoPath.unstage,
    file: 'single',
    onInvalidFile: invalidRepoPath.unstage,
    handle: ({ repoPath, file }) => operations.unstageFile(repoPath, file)
  },
  [SidecarOp.stageAll]: {
    onInvalidRepo: invalidRepoPath.stage,
    file: 'array',
    handle: ({ repoPath, files }) => operations.stageAll(repoPath, files)
  },
  [SidecarOp.unstageAll]: {
    onInvalidRepo: invalidRepoPath.unstage,
    file: 'array',
    handle: ({ repoPath, files }) => operations.unstageAll(repoPath, files)
  },
  [SidecarOp.commit]: {
    onInvalidRepo: invalidRepoPath.commit,
    handle: ({ repoPath, request }) => operations.commit(repoPath, request.message)
  },
  [SidecarOp.getDiff]: {
    onInvalidRepo: invalidRepoPath.diff,
    file: 'single',
    onInvalidFile: invalidRepoPath.diff,
    handle: ({ repoPath, file, request }) =>
      operations.getDiff(repoPath, file, request.staged === true)
  },
  [SidecarOp.stageHunk]: {
    onInvalidRepo: invalidRepoPath.stageHunk,
    file: 'single',
    onInvalidFile: invalidRepoPath.stageHunk,
    handle: ({ repoPath, file, request }) =>
      operations.stageHunk(repoPath, file, request.hunkHeader)
  },
  [SidecarOp.unstageHunk]: {
    onInvalidRepo: invalidRepoPath.stageHunk,
    file: 'single',
    onInvalidFile: invalidRepoPath.stageHunk,
    handle: ({ repoPath, file, request }) =>
      operations.unstageHunk(repoPath, file, request.hunkHeader)
  },
  [SidecarOp.fetchRepo]: {
    onInvalidRepo: invalidRepoPath.fetch,
    handle: ({ repoPath }) => operations.fetchRepo(repoPath)
  },
  [SidecarOp.pushRepo]: {
    onInvalidRepo: invalidRepoPath.push,
    handle: ({ repoPath }) => operations.pushRepo(repoPath)
  },
  [SidecarOp.pullRepo]: {
    onInvalidRepo: invalidRepoPath.pull,
    handle: ({ repoPath }) => operations.pullRepo(repoPath)
  },
  [SidecarOp.getLog]: {
    onInvalidRepo: invalidRepoPath.log,
    handle: ({ repoPath, request }) => operations.getLog(repoPath, request.maxCount)
  },
  [SidecarOp.checkoutRef]: {
    onInvalidRepo: invalidRepoPath.checkout,
    handle: ({ repoPath, request }) =>
      operations.checkoutRef(repoPath, request.refKind, request.fullPath)
  },
  [SidecarOp.createBranch]: {
    onInvalidRepo: invalidRepoPath.mutation,
    handle: ({ repoPath, request }) =>
      operations.createBranch(
        repoPath,
        request.name,
        request.startPoint || undefined,
        request.checkout === true
      )
  },
  [SidecarOp.deleteBranch]: {
    onInvalidRepo: invalidRepoPath.mutation,
    handle: ({ repoPath, request }) =>
      operations.deleteBranch(repoPath, request.name, request.force === true)
  },
  [SidecarOp.renameBranch]: {
    onInvalidRepo: invalidRepoPath.mutation,
    handle: ({ repoPath, request }) =>
      operations.renameBranch(repoPath, request.oldName, request.newName)
  },
  [SidecarOp.mergeBranch]: {
    onInvalidRepo: invalidRepoPath.conflictable,
    handle: ({ repoPath, request }) => operations.mergeBranch(repoPath, request.ref)
  },
  [SidecarOp.resetToCommit]: {
    onInvalidRepo: invalidRepoPath.mutation,
    handle: ({ repoPath, request }) => operations.resetToCommit(repoPath, request.sha, request.mode)
  },
  [SidecarOp.revertCommit]: {
    onInvalidRepo: invalidRepoPath.conflictable,
    handle: ({ repoPath, request }) => operations.revertCommit(repoPath, request.sha)
  },
  [SidecarOp.cherryPick]: {
    onInvalidRepo: invalidRepoPath.conflictable,
    handle: ({ repoPath, request }) => operations.cherryPick(repoPath, request.sha)
  },
  [SidecarOp.createTag]: {
    onInvalidRepo: invalidRepoPath.mutation,
    handle: ({ repoPath, request }) =>
      operations.createTag(
        repoPath,
        request.name,
        request.ref || undefined,
        request.message || undefined
      )
  },
  [SidecarOp.deleteTag]: {
    onInvalidRepo: invalidRepoPath.mutation,
    handle: ({ repoPath, request }) => operations.deleteTag(repoPath, request.name)
  },
  [SidecarOp.stashList]: {
    onInvalidRepo: invalidRepoPath.stashList,
    handle: ({ repoPath }) => operations.stashList(repoPath)
  },
  [SidecarOp.stashPush]: {
    onInvalidRepo: invalidRepoPath.mutation,
    file: 'optionalArray',
    handle: ({ repoPath, request, files }) =>
      operations.stashPush(
        repoPath,
        request.message || undefined,
        request.includeUntracked === true,
        request.files !== undefined ? files : undefined
      )
  },
  [SidecarOp.stashApply]: {
    onInvalidRepo: invalidRepoPath.conflictable,
    handle: ({ repoPath, request }) => operations.stashApply(repoPath, request.index)
  },
  [SidecarOp.stashPop]: {
    onInvalidRepo: invalidRepoPath.conflictable,
    handle: ({ repoPath, request }) => operations.stashPop(repoPath, request.index)
  },
  [SidecarOp.stashDrop]: {
    onInvalidRepo: invalidRepoPath.mutation,
    handle: ({ repoPath, request }) => operations.stashDrop(repoPath, request.index)
  },
  [SidecarOp.discardChanges]: {
    onInvalidRepo: invalidRepoPath.mutation,
    file: 'array',
    handle: ({ repoPath, files }) => operations.discardChanges(repoPath, files)
  },
  [SidecarOp.discardAll]: {
    onInvalidRepo: invalidRepoPath.mutation,
    handle: ({ repoPath }) => operations.discardAll(repoPath)
  }
}

type ErasedHandler = (ctx: {
  repoPath: string
  request: Record<string, unknown>
  file: string
  files: string[]
}) => Promise<unknown> | unknown

interface ErasedEntry {
  onInvalidRepo: () => unknown
  file?: 'single' | 'array' | 'optionalArray'
  onInvalidFile?: () => unknown
  handle: ErasedHandler
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
    return repoPath ? operations.openRepo(repoPath) : operations.openRepoRejected()
  }

  if (op === SidecarOp.closeRepo) {
    const decoded = decodeRequest(SidecarOp.closeRepo, body)
    if (!decoded) {
      return BAD_REQUEST
    }
    const repoPath = resolveExistingRepoRoot(decoded.repoPath as string)
    return repoPath ? operations.closeRepo(repoPath) : {}
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
    return entry.onInvalidRepo()
  }

  let file = ''
  let files: string[] = []
  if (entry.file === 'single') {
    const resolved = resolveRepoRelativeFile(repoPath, decoded.file as string)
    if (!resolved) {
      return entry.onInvalidFile?.() ?? BAD_REQUEST
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

  return entry.handle({ repoPath, request: decoded, file, files })
}
