import fs from 'node:fs'
import path from 'node:path'

function hasParentSegment(inputPath: string): boolean {
  return inputPath.split(/[/\\]/).includes('..')
}

function directoryRoot(directoryPath: string): string {
  return directoryPath.endsWith(path.sep) ? directoryPath : `${directoryPath}${path.sep}`
}

export function isSafeAbsolutePathInput(inputPath: string): boolean {
  if (!inputPath || inputPath.includes('\0')) {
    return false
  }
  if (!path.isAbsolute(inputPath)) {
    return false
  }
  return !hasParentSegment(inputPath)
}

export function assertPathWithinDirectory(directoryPath: string, candidatePath: string): boolean {
  const resolvedDirectory = path.resolve(directoryPath)
  const resolvedCandidate = path.resolve(candidatePath)
  const root = directoryRoot(resolvedDirectory)
  return resolvedCandidate === resolvedDirectory || resolvedCandidate.startsWith(root)
}

export function resolveExistingDirectory(inputPath: string): string | null {
  if (!isSafeAbsolutePathInput(inputPath)) {
    return null
  }
  try {
    const resolved = path.resolve(inputPath)
    const canonical = fs.realpathSync.native(resolved)
    if (!fs.statSync(canonical).isDirectory()) {
      return null
    }
    return canonical
  } catch {
    return null
  }
}

export function resolveExistingRepoRoot(inputPath: string): string | null {
  return resolveExistingDirectory(inputPath)
}

export function resolveRepoRelativeFile(repoRoot: string, file: string): string | null {
  if (!file || file.includes('\0')) {
    return null
  }
  if (path.isAbsolute(file)) {
    return null
  }
  if (hasParentSegment(file)) {
    return null
  }
  const joined = path.resolve(repoRoot, file)
  if (!assertPathWithinDirectory(repoRoot, joined)) {
    return null
  }
  return path.relative(repoRoot, joined)
}
