import fs from 'node:fs'
import path from 'node:path'

export function normalizeRepoPath(repoPath: string): string {
  try {
    return fs.realpathSync.native(repoPath)
  } catch {
    return path.resolve(repoPath)
  }
}

function hasParentSegment(dirPath: string): boolean {
  return dirPath.split(/[/\\]/).includes('..')
}

export function resolveScanDirectory(dirPath: string): string | null {
  if (!dirPath || dirPath.includes('\0') || hasParentSegment(dirPath)) return null
  if (!path.isAbsolute(dirPath)) return null

  try {
    const canonical = fs.realpathSync.native(dirPath)
    if (!fs.statSync(canonical).isDirectory()) return null
    return canonical
  } catch {
    return null
  }
}
