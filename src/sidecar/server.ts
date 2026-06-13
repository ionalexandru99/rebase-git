import fs from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { parseOrThrow } from '@shared/codec'
import {
  RefKindSchema,
  ResetModeSchema,
  type ScanForReposResponse,
  ScanForReposResponseSchema
} from '@shared/schemas/ipc'
import { simpleGit } from 'simple-git'
import { streamGitLog } from './log-stream'
import * as operations from './operations'
import { resolveExistingRepoRoot, resolveRepoRelativeFile } from './path-guards'
import { SidecarOp } from './protocol'
import { storeValidatedScanRoot, takeValidatedScanRoot } from './scan-root-registry'

type Body = Record<string, unknown>

const MAX_BODY_BYTES = 1024 * 1024
const BAD_REQUEST = Symbol('bad-request')

class BodyTooLargeError extends Error {
  override readonly name = 'BodyTooLargeError'
}

const requiredString = (body: Body, key: string): string | null => {
  const value = body[key]
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  return trimmed
}

function safeRepoPath(body: Body): string | null | typeof BAD_REQUEST {
  const raw = requiredString(body, 'repoPath')
  if (!raw) {
    return BAD_REQUEST
  }
  return resolveExistingRepoRoot(raw)
}

const resolveRepoRelativeFiles = (repoPath: string, body: Body): string[] | null => {
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

const invalidScanDirectoryResponse = (): ScanForReposResponse =>
  parseOrThrow(ScanForReposResponseSchema, {
    _tag: 'GitError',
    message: 'invalid directory path'
  })

async function scanForReposSafely(requestedDirPath: string): Promise<ScanForReposResponse> {
  if (!requestedDirPath || requestedDirPath.includes('\0')) {
    return invalidScanDirectoryResponse()
  }
  if (!path.isAbsolute(requestedDirPath)) {
    return invalidScanDirectoryResponse()
  }
  if (requestedDirPath.split(/[/\\]/).includes('..')) {
    return invalidScanDirectoryResponse()
  }

  let scanRoot: string
  try {
    scanRoot = fs.realpathSync.native(path.resolve(requestedDirPath))
    if (!fs.statSync(scanRoot).isDirectory()) {
      return invalidScanDirectoryResponse()
    }
  } catch {
    return invalidScanDirectoryResponse()
  }

  const resolvedPath = path.resolve(requestedDirPath)
  const scanRootPrefix = scanRoot.endsWith(path.sep) ? scanRoot : `${scanRoot}${path.sep}`
  if (resolvedPath !== scanRoot && !resolvedPath.startsWith(scanRootPrefix)) {
    return invalidScanDirectoryResponse()
  }

  const scanRootId = storeValidatedScanRoot(scanRoot)
  const trustedScanRoot = takeValidatedScanRoot(scanRootId)
  if (!trustedScanRoot) {
    return invalidScanDirectoryResponse()
  }

  const trustedPrefix = trustedScanRoot.endsWith(path.sep)
    ? trustedScanRoot
    : `${trustedScanRoot}${path.sep}`

  try {
    const entries = await fs.promises.readdir(trustedScanRoot, { withFileTypes: true })
    const repos: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      const childName = path.basename(entry.name)
      if (childName !== entry.name) {
        continue
      }
      const childPath = path.join(trustedScanRoot, childName)
      if (!childPath.startsWith(trustedPrefix)) {
        continue
      }
      try {
        const git = simpleGit(childPath)
        const isRepo = await git.checkIsRepo()
        if (isRepo) {
          repos.push(childPath)
        }
      } catch {}
    }
    return parseOrThrow(ScanForReposResponseSchema, { _tag: 'Ok', repos })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return parseOrThrow(ScanForReposResponseSchema, { _tag: 'GitError', message })
  }
}

async function dispatch(op: string, body: Body): Promise<unknown> {
  switch (op) {
    case SidecarOp.openRepo: {
      const raw = requiredString(body, 'repoPath')
      if (!raw) {
        return BAD_REQUEST
      }
      const repoPath = resolveExistingRepoRoot(raw)
      if (!repoPath) {
        return operations.openRepoRejected()
      }
      return operations.openRepo(repoPath)
    }
    case SidecarOp.closeRepo: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return {}
      }
      return operations.closeRepo(repoPath)
    }
    case SidecarOp.getBranches: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.branches()
      }
      return operations.getBranches(repoPath)
    }
    case SidecarOp.getLocalBranches: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.localBranches()
      }
      return operations.getLocalBranches(repoPath)
    }
    case SidecarOp.getRemoteRefs: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.remoteRefs()
      }
      return operations.getRemoteRefs(repoPath)
    }
    case SidecarOp.getStatus: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.status()
      }
      return operations.getStatus(repoPath)
    }
    case SidecarOp.stageFile: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.stage()
      }
      const file = requiredString(body, 'file')
      if (!file) {
        return BAD_REQUEST
      }
      const relative = resolveRepoRelativeFile(repoPath, file)
      if (!relative) {
        return operations.invalidRepoPath.stage()
      }
      return operations.stageFile(repoPath, relative)
    }
    case SidecarOp.unstageFile: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.unstage()
      }
      const file = requiredString(body, 'file')
      if (!file) {
        return BAD_REQUEST
      }
      const relative = resolveRepoRelativeFile(repoPath, file)
      if (!relative) {
        return operations.invalidRepoPath.unstage()
      }
      return operations.unstageFile(repoPath, relative)
    }
    case SidecarOp.stageAll: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.stage()
      }
      const files = resolveRepoRelativeFiles(repoPath, body)
      if (!files) {
        return BAD_REQUEST
      }
      return operations.stageAll(repoPath, files)
    }
    case SidecarOp.unstageAll: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.unstage()
      }
      const files = resolveRepoRelativeFiles(repoPath, body)
      if (!files) {
        return BAD_REQUEST
      }
      return operations.unstageAll(repoPath, files)
    }
    case SidecarOp.getDiff: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.diff()
      }
      const file = requiredString(body, 'file')
      if (!file) {
        return BAD_REQUEST
      }
      const relative = resolveRepoRelativeFile(repoPath, file)
      if (!relative) {
        return operations.invalidRepoPath.diff()
      }
      return operations.getDiff(repoPath, relative, body.staged === true)
    }
    case SidecarOp.stageHunk:
    case SidecarOp.unstageHunk: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.stageHunk()
      }
      const file = requiredString(body, 'file')
      const hunkHeader = requiredString(body, 'hunkHeader')
      if (!file || !hunkHeader) {
        return BAD_REQUEST
      }
      const relative = resolveRepoRelativeFile(repoPath, file)
      if (!relative) {
        return operations.invalidRepoPath.stageHunk()
      }
      if (op === SidecarOp.stageHunk) {
        return operations.stageHunk(repoPath, relative, hunkHeader)
      }
      return operations.unstageHunk(repoPath, relative, hunkHeader)
    }
    case SidecarOp.commit: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.commit()
      }
      const message = requiredString(body, 'message')
      if (!message) {
        return BAD_REQUEST
      }
      return operations.commit(repoPath, message)
    }
    case SidecarOp.fetchRepo: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.fetch()
      }
      return operations.fetchRepo(repoPath)
    }
    case SidecarOp.pushRepo: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.push()
      }
      return operations.pushRepo(repoPath)
    }
    case SidecarOp.pullRepo: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.pull()
      }
      return operations.pullRepo(repoPath)
    }
    case SidecarOp.getLog: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.log()
      }
      return operations.getLog(
        repoPath,
        typeof body.maxCount === 'number' ? body.maxCount : undefined
      )
    }
    case SidecarOp.checkoutRef: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.checkout()
      }
      const fullPath = requiredString(body, 'fullPath')
      if (!fullPath) {
        return BAD_REQUEST
      }
      const refKind = RefKindSchema.safeParse(body.refKind)
      if (!refKind.success) {
        return BAD_REQUEST
      }
      return operations.checkoutRef(repoPath, refKind.data, fullPath)
    }
    case SidecarOp.createBranch: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.mutation()
      }
      const name = requiredString(body, 'name')
      if (!name) {
        return BAD_REQUEST
      }
      const startPoint = requiredString(body, 'startPoint') ?? undefined
      return operations.createBranch(repoPath, name, startPoint, body.checkout === true)
    }
    case SidecarOp.deleteBranch: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.mutation()
      }
      const name = requiredString(body, 'name')
      if (!name) {
        return BAD_REQUEST
      }
      return operations.deleteBranch(repoPath, name, body.force === true)
    }
    case SidecarOp.renameBranch: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.mutation()
      }
      const oldName = requiredString(body, 'oldName')
      const newName = requiredString(body, 'newName')
      if (!oldName || !newName) {
        return BAD_REQUEST
      }
      return operations.renameBranch(repoPath, oldName, newName)
    }
    case SidecarOp.mergeBranch: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.conflictable()
      }
      const ref = requiredString(body, 'ref')
      if (!ref) {
        return BAD_REQUEST
      }
      return operations.mergeBranch(repoPath, ref)
    }
    case SidecarOp.resetToCommit: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.mutation()
      }
      const sha = requiredString(body, 'sha')
      if (!sha) {
        return BAD_REQUEST
      }
      const mode = ResetModeSchema.safeParse(body.mode)
      if (!mode.success) {
        return BAD_REQUEST
      }
      return operations.resetToCommit(repoPath, sha, mode.data)
    }
    case SidecarOp.revertCommit: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.conflictable()
      }
      const sha = requiredString(body, 'sha')
      if (!sha) {
        return BAD_REQUEST
      }
      return operations.revertCommit(repoPath, sha)
    }
    case SidecarOp.cherryPick: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.conflictable()
      }
      const sha = requiredString(body, 'sha')
      if (!sha) {
        return BAD_REQUEST
      }
      return operations.cherryPick(repoPath, sha)
    }
    case SidecarOp.createTag: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.mutation()
      }
      const name = requiredString(body, 'name')
      if (!name) {
        return BAD_REQUEST
      }
      const ref = requiredString(body, 'ref') ?? undefined
      const message = requiredString(body, 'message') ?? undefined
      return operations.createTag(repoPath, name, ref, message)
    }
    case SidecarOp.deleteTag: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.mutation()
      }
      const name = requiredString(body, 'name')
      if (!name) {
        return BAD_REQUEST
      }
      return operations.deleteTag(repoPath, name)
    }
    case SidecarOp.stashList: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.stashList()
      }
      return operations.stashList(repoPath)
    }
    case SidecarOp.stashPush: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.mutation()
      }
      const message = requiredString(body, 'message') ?? undefined
      let stashFiles: string[] | undefined
      if (body.files !== undefined) {
        const resolved = resolveRepoRelativeFiles(repoPath, body)
        if (!resolved) {
          return BAD_REQUEST
        }
        stashFiles = resolved
      }
      return operations.stashPush(repoPath, message, body.includeUntracked === true, stashFiles)
    }
    case SidecarOp.stashApply:
    case SidecarOp.stashPop: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.conflictable()
      }
      if (typeof body.index !== 'number') {
        return BAD_REQUEST
      }
      if (op === SidecarOp.stashApply) {
        return operations.stashApply(repoPath, body.index)
      }
      return operations.stashPop(repoPath, body.index)
    }
    case SidecarOp.stashDrop: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.mutation()
      }
      if (typeof body.index !== 'number') {
        return BAD_REQUEST
      }
      return operations.stashDrop(repoPath, body.index)
    }
    case SidecarOp.discardChanges: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.mutation()
      }
      const files = resolveRepoRelativeFiles(repoPath, body)
      if (!files) {
        return BAD_REQUEST
      }
      return operations.discardChanges(repoPath, files)
    }
    case SidecarOp.discardAll: {
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST) {
        return BAD_REQUEST
      }
      if (!repoPath) {
        return operations.invalidRepoPath.mutation()
      }
      return operations.discardAll(repoPath)
    }
    default:
      return undefined
  }
}

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let rejected = false
    req.on('data', (chunk: Buffer) => {
      if (rejected) {
        return
      }
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        rejected = true
        chunks.length = 0
        req.resume()
        reject(new BodyTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (rejected) {
        return
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        return resolve({})
      }
      try {
        resolve(JSON.parse(raw) as Body)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(data)
}

async function handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    res.writeHead(403)
    res.end()
    return
  }

  if (req.headers.authorization !== `Bearer ${token}`) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (url.pathname === '/stream/log' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const repoPath = safeRepoPath(body)
      if (repoPath === BAD_REQUEST || !repoPath) {
        sendJson(res, 400, { error: 'bad request' })
        return
      }
      const skip = typeof body.skip === 'number' ? body.skip : undefined
      const maxCount = typeof body.maxCount === 'number' ? body.maxCount : undefined
      streamGitLog(repoPath, res, { skip, maxCount })
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(res, 413, { error: 'payload too large' })
        return
      }
      sendJson(res, 500, { error: 'internal error' })
    }
    return
  }

  const match = url.pathname.match(/^\/op\/(.+)$/)
  if (!match || req.method !== 'POST') {
    sendJson(res, 404, { error: 'not found' })
    return
  }

  try {
    const body = await readBody(req)
    const operation = match[1]
    if (operation === SidecarOp.scanForRepos) {
      const dirPath = requiredString(body, 'dirPath')
      if (!dirPath) {
        sendJson(res, 400, { error: 'bad request' })
        return
      }
      const result = await scanForReposSafely(dirPath)
      sendJson(res, 200, result)
      return
    }
    const result = await dispatch(operation, body)
    if (result === BAD_REQUEST) {
      sendJson(res, 400, { error: 'bad request' })
      return
    }
    if (result === undefined) {
      sendJson(res, 404, { error: `unknown op: ${match[1]}` })
      return
    }
    sendJson(res, 200, result)
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      sendJson(res, 413, { error: 'payload too large' })
      return
    }
    sendJson(res, 500, { error: 'internal error' })
  }
}

export function createSidecarServer(token: string): Server {
  return createServer((req, res) => {
    void handle(req, res, token)
  })
}
