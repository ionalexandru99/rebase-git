import fs from 'node:fs'
import path from 'node:path'

export function normalizeRepoPath(repoPath: string): string {
  try {
    return fs.realpathSync.native(repoPath)
  } catch {
    return path.resolve(repoPath)
  }
}

export function resolveScanDirectory(dirPath: string): string | null {
  if (!dirPath || dirPath.includes('\0')) return null

  const normalizedInput = path.normalize(dirPath)
  if (normalizedInput.split(path.sep).includes('..')) return null

  const resolved = path.resolve(dirPath)
  try {
    const canonical = fs.realpathSync.native(resolved)
    if (!fs.statSync(canonical).isDirectory()) return null
    return canonical
  } catch {
    return null
  }
}
