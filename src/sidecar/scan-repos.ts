import fs from 'node:fs'
import path from 'node:path'
import { encodeOrThrow } from '@shared/codec'
import { ScanForReposResponse } from '@shared/schemas/ipc'
import { simpleGit } from 'simple-git'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function listGitReposInDirectory(
  scanRoot: string
): Promise<typeof ScanForReposResponse.Encoded> {
  try {
    const entries = await fs.promises.readdir(scanRoot, { withFileTypes: true })
    const repos: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const childName = path.basename(entry.name)
      if (childName !== entry.name) continue
      const fullPath = path.join(scanRoot, childName)
      try {
        const git = simpleGit(fullPath)
        const isRepo = await git.checkIsRepo()
        if (isRepo) repos.push(fullPath)
      } catch {}
    }
    return encodeOrThrow(ScanForReposResponse, { _tag: 'Ok', repos })
  } catch (error) {
    return encodeOrThrow(ScanForReposResponse, { _tag: 'GitError', message: errorMessage(error) })
  }
}
