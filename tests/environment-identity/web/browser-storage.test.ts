import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const allowedStorageAccess = new Map([
  ['src/renderer/features/diff/useDiffStyle.ts', ['rebase:diff-style']],
  ['src/renderer/features/history/CommitDetailPane.tsx', ['rebase:commit-files-width']],
  ['src/renderer/features/status/LocalChangesPane.tsx', ['rebase:local-files-width']]
])

describe('browser storage ownership', () => {
  it('contains only allowlisted disposable presentation state', () => {
    for (const [relativePath, allowedKeys] of allowedStorageAccess) {
      const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8')
      expect(source).toMatch(/localStorage/)
      for (const allowedKey of allowedKeys) {
        expect(source).toContain(allowedKey)
      }
    }

    const sourceRoots = ['src/renderer', 'src/web']
    const pending = sourceRoots.map((relativePath) => path.join(process.cwd(), relativePath))
    const unexpectedStorageOwners: string[] = []
    while (pending.length > 0) {
      const directory = pending.pop()
      if (!directory) {
        continue
      }
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') {
            pending.push(absolutePath)
          }
        } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
          const source = readFileSync(absolutePath, 'utf8')
          const relativePath = path.relative(process.cwd(), absolutePath)
          if (/(?:local|session)Storage/.test(source) && !allowedStorageAccess.has(relativePath)) {
            unexpectedStorageOwners.push(relativePath)
          }
        }
      }
    }
    expect(unexpectedStorageOwners).toEqual([])
  })
})
