import { parseUnifiedDiff } from '@shared/unified-diff'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getDiff, openRepo } from '../index'

let repoDir: string
let repo: RepoFixture
let modifiedSha: string

beforeAll(async () => {
  repo = createRepoFixture({ prefix: 'rebase-diff-patch-' })
  repoDir = repo.path

  repo.write('sample.txt', 'alpha\nbravo\ncharlie\n')
  repo.write('logo.png', Buffer.from([0, 1, 2, 3, 0, 255]))
  repo.git('add', '-A')
  repo.commitStaged('base')

  repo.write('sample.txt', 'alpha\nBRAVO\ncharlie\n')
  repo.git('add', '-A')
  modifiedSha = repo.commitStaged('edit bravo')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  repo.cleanup()
})

describe('getDiff raw patch text', () => {
  it('returns the raw patch for a working-tree change', async () => {
    repo.write('sample.txt', 'alpha\nBRAVO\nCHARLIE\n')

    const { patch } = await runOp(getDiff(repoDir, 'sample.txt', false))

    expect(patch).toContain('diff --git a/sample.txt b/sample.txt')
    expect(patch).toContain('@@ ')
    expect(patch).toContain('+CHARLIE')
    expect(parseUnifiedDiff(patch).hunks).toHaveLength(1)

    repo.git('checkout', '--', 'sample.txt')
  })

  it('returns the raw patch for a staged change', async () => {
    repo.write('sample.txt', 'alpha\nBRAVO\nDELTA\n')
    repo.git('add', '--', 'sample.txt')

    const { patch } = await runOp(getDiff(repoDir, 'sample.txt', true))

    expect(patch).toContain('diff --git a/sample.txt b/sample.txt')
    expect(patch).toContain('+DELTA')

    repo.git('reset', '-q', 'HEAD', '--', 'sample.txt')
    repo.git('checkout', '--', 'sample.txt')
  })

  it('returns the raw patch for a commit', async () => {
    const { patch } = await runOp(getDiff(repoDir, 'sample.txt', false, { commit: modifiedSha }))

    expect(patch).toContain('diff --git a/sample.txt b/sample.txt')
    expect(patch).toContain('+BRAVO')
    expect(patch).toContain('-bravo')
  })

  it('returns the synthetic no-index patch for an untracked file', async () => {
    repo.write('brand-new.txt', 'fresh\n')

    const { patch } = await runOp(getDiff(repoDir, 'brand-new.txt', false))

    expect(patch).toContain('new file mode')
    expect(patch).toContain('+fresh')

    repo.removeFile('brand-new.txt')
  })

  it('returns an empty patch for a clean file', async () => {
    const { patch } = await runOp(getDiff(repoDir, 'sample.txt', false))

    expect(patch).toBe('')
    expect(parseUnifiedDiff(patch).hunks).toEqual([])
  })

  it('keeps the binary flag as the only binary signal, with the patch alongside it', async () => {
    repo.write('logo.png', Buffer.from([9, 8, 7, 0, 6]))

    const { patch, binary } = await runOp(getDiff(repoDir, 'logo.png', false))

    expect(binary).toBe(true)
    expect(parseUnifiedDiff(patch).hunks).toEqual([])
    expect(patch).toContain('Binary files ')

    repo.git('checkout', '--', 'logo.png')
  })

  it('returns the --ours patch, never a combined diff, for an unresolved conflict', async () => {
    repo.write('conflict.txt', 'base\n')
    repo.git('add', '--', 'conflict.txt')
    repo.commitStaged('conflict base')
    repo.git('checkout', '-q', '-b', 'conflict-side')
    repo.write('conflict.txt', 'side\n')
    repo.git('add', '--', 'conflict.txt')
    repo.commitStaged('side change')
    repo.git('checkout', '-q', 'main')
    repo.write('conflict.txt', 'main\n')
    repo.git('add', '--', 'conflict.txt')
    repo.commitStaged('main change')
    expect(() => repo.git('merge', 'conflict-side')).toThrow()

    try {
      const { patch } = await runOp(getDiff(repoDir, 'conflict.txt', false))

      expect(patch).not.toContain('@@@')
      expect(patch).toContain('@@ ')
      expect(patch).toContain('<<<<<<<')
    } finally {
      repo.git('merge', '--abort')
    }
  })
})
