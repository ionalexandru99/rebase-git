import fs from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { encodeOrThrow } from '@shared/codec'
import { ScanForReposResponse } from '@shared/schemas/ipc'
import { simpleGit } from 'simple-git'
import * as operations from './operations'
import { resolveExistingRepoRoot, resolveRepoRelativeFile } from './path-guards'
import { SidecarOp } from './protocol'
import { storeValidatedScanRoot, takeValidatedScanRoot } from './scan-root-registry'

type Body = Record<string, unknown>

const str = (body: Body, key: string): string => {
  const value = body[key]
  return typeof value === 'string' ? value : ''
}

function safeRepoPath(body: Body): string | null {
  return resolveExistingRepoRoot(str(body, 'repoPath'))
}

const invalidScanDirectoryResponse = (): typeof ScanForReposResponse.Encoded =>
  encodeOrThrow(ScanForReposResponse, {
    _tag: 'GitError',
    message: 'invalid directory path'
  })

async function scanForReposSafely(
  requestedDirPath: string
): Promise<typeof ScanForReposResponse.Encoded> {
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
      if (!entry.isDirectory()) continue
      const childName = path.basename(entry.name)
      if (childName !== entry.name) continue
      const childPath = path.join(trustedScanRoot, childName)
      if (!childPath.startsWith(trustedPrefix)) continue
      try {
        const git = simpleGit(childPath)
        const isRepo = await git.checkIsRepo()
        if (isRepo) repos.push(childPath)
      } catch {}
    }
    return encodeOrThrow(ScanForReposResponse, { _tag: 'Ok', repos })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return encodeOrThrow(ScanForReposResponse, { _tag: 'GitError', message })
  }
}

async function dispatch(op: string, body: Body): Promise<unknown> {
  switch (op) {
    case SidecarOp.openRepo: {
      const repoPath = resolveExistingRepoRoot(str(body, 'repoPath'))
      if (!repoPath) return operations.openRepoRejected()
      return operations.openRepo(repoPath)
    }
    case SidecarOp.closeRepo: {
      const repoPath = safeRepoPath(body)
      if (!repoPath) return {}
      return operations.closeRepo(repoPath)
    }
    case SidecarOp.getBranches: {
      const repoPath = safeRepoPath(body)
      if (!repoPath) return operations.invalidRepoPath.branches()
      return operations.getBranches(repoPath)
    }
    case SidecarOp.getStatus: {
      const repoPath = safeRepoPath(body)
      if (!repoPath) return operations.invalidRepoPath.status()
      return operations.getStatus(repoPath)
    }
    case SidecarOp.stageFile: {
      const repoPath = safeRepoPath(body)
      if (!repoPath) return operations.invalidRepoPath.stage()
      const file = resolveRepoRelativeFile(repoPath, str(body, 'file'))
      if (!file) return operations.invalidRepoPath.stage()
      return operations.stageFile(repoPath, file)
    }
    case SidecarOp.unstageFile: {
      const repoPath = safeRepoPath(body)
      if (!repoPath) return operations.invalidRepoPath.unstage()
      const file = resolveRepoRelativeFile(repoPath, str(body, 'file'))
      if (!file) return operations.invalidRepoPath.unstage()
      return operations.unstageFile(repoPath, file)
    }
    case SidecarOp.commit: {
      const repoPath = safeRepoPath(body)
      if (!repoPath) return operations.invalidRepoPath.commit()
      return operations.commit(repoPath, str(body, 'message'))
    }
    case SidecarOp.fetchRepo: {
      const repoPath = safeRepoPath(body)
      if (!repoPath) return operations.invalidRepoPath.fetch()
      return operations.fetchRepo(repoPath)
    }
    case SidecarOp.getLog: {
      const repoPath = safeRepoPath(body)
      if (!repoPath) return operations.invalidRepoPath.log()
      return operations.getLog(
        repoPath,
        typeof body.maxCount === 'number' ? body.maxCount : undefined
      )
    }
    case SidecarOp.checkoutRef: {
      const repoPath = safeRepoPath(body)
      if (!repoPath) return operations.invalidRepoPath.checkout()
      return operations.checkoutRef(
        repoPath,
        body.refKind as 'local' | 'remote' | 'tag',
        str(body, 'fullPath')
      )
    }
    default:
      return undefined
  }
}

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      raw += chunk
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw) as Body)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400'
} as const

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', ...CORS_HEADERS })
  res.end(data)
}

async function handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    const requestedHeaders = req.headers['access-control-request-headers']
    res.writeHead(204, {
      ...CORS_HEADERS,
      'access-control-allow-headers':
        requestedHeaders ?? CORS_HEADERS['access-control-allow-headers'],
      'access-control-allow-private-network': 'true'
    })
    res.end()
    return
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.headers.authorization !== `Bearer ${token}`) {
    sendJson(res, 401, { error: 'unauthorized' })
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
      const result = await scanForReposSafely(str(body, 'dirPath'))
      sendJson(res, 200, result)
      return
    }
    const result = await dispatch(operation, body)
    if (result === undefined) {
      sendJson(res, 404, { error: `unknown op: ${match[1]}` })
      return
    }
    sendJson(res, 200, result)
  } catch {
    sendJson(res, 500, { error: 'internal error' })
  }
}

export function createSidecarServer(token: string): Server {
  return createServer((req, res) => {
    void handle(req, res, token)
  })
}
