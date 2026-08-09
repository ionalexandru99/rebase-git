import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const allowedStorageAccess = new Map([
  ['src/renderer/features/diff/useDiffStyle.ts', ['rebase:diff-style']],
  ['src/renderer/features/history/CommitDetailPane.tsx', ['rebase:commit-files-width']],
  ['src/renderer/features/status/LocalChangesPane.tsx', ['rebase:local-files-width']]
])

function storageKeysInSource(source: string): string[] {
  const constants = new Map<string, string>()
  for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/g)) {
    constants.set(match[1], match[2])
  }
  const keys: string[] = []
  for (const match of source.matchAll(
    /(?:window\.)?(?:local|session)Storage\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)/g
  )) {
    const expression = match[1].trim()
    const literal = expression.match(/^['"]([^'"]+)['"]$/)?.[1]
    const resolved = literal ?? constants.get(expression)
    if (!resolved) {
      throw new Error(`Storage key is not statically resolvable: ${expression}`)
    }
    keys.push(resolved)
  }
  return keys
}

describe('browser storage ownership', () => {
  it('contains only allowlisted disposable presentation state', () => {
    for (const [relativePath, allowedKeys] of allowedStorageAccess) {
      const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8')
      expect(source).toMatch(/(?:local|session)Storage/)
      expect(new Set(storageKeysInSource(source))).toEqual(new Set(allowedKeys))
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
          const relativePath = path.relative(process.cwd(), absolutePath).split(path.sep).join('/')
          if (/(?:local|session)Storage/.test(source) && !allowedStorageAccess.has(relativePath)) {
            unexpectedStorageOwners.push(relativePath)
          }
        }
      }
    }
    expect(unexpectedStorageOwners).toEqual([])
  })

  it('rejects unapproved and dynamic storage keys', () => {
    expect(storageKeysInSource("localStorage.setItem('approved', 'value')")).toEqual([
      'approved'
    ])
    expect(() => storageKeysInSource('sessionStorage.getItem(dynamicKey)')).toThrow(
      'Storage key is not statically resolvable'
    )
  })
})
