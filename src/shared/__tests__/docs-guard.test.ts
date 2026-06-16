import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function readDoc(relativePath: string): string {
  return readFileSync(path.resolve(repoRoot, relativePath), 'utf8')
}

const docs = ['CLAUDE.md', 'AGENTS.md']

describe('docs ground truth', () => {
  for (const doc of docs) {
    describe(doc, () => {
      const contents = readDoc(doc)

      it('does not call the renderer SolidJS', () => {
        expect(contents).not.toMatch(/SolidJS/i)
      })

      it('does not reference the removed getSidecarConfig preload bootstrap', () => {
        expect(contents).not.toContain('getSidecarConfig')
      })

      it('does not claim the renderer uses native fetch', () => {
        expect(contents).not.toContain('native fetch')
      })
    })
  }
})

const rendererDir = path.resolve(repoRoot, 'src/renderer')
const shimFilePattern = /[/\\]src[/\\]renderer[/\\]lib[/\\]react-[a-z-]*compat\.(ts|tsx)$/
const compatImportPattern = /from\s+['"][^'"]*\/react-[a-z-]*compat['"]/

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath))
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function countCompatImporters(): number {
  let count = 0
  for (const file of listSourceFiles(rendererDir)) {
    if (shimFilePattern.test(file)) {
      continue
    }
    if (compatImportPattern.test(readFileSync(file, 'utf8'))) {
      count += 1
    }
  }
  return count
}

// Snapshot of the current tree (files importing a react-*-compat shim, computed by
// scanning src/renderer). The compat shim is being removed in later remediation phases,
// so this number may only DECREASE — never raise it. A higher count means new code took
// a fresh dependency on the shim.
const BASELINE = 65

describe('react-compat shim usage', () => {
  it('does not grow the number of files importing from a react-compat shim', () => {
    expect(countCompatImporters()).toBeLessThanOrEqual(BASELINE)
  })
})
