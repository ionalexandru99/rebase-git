import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GIT_EMPTY_TREE_OID } from '@shared/git-constants'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getDiff, openRepo } from '../index'

let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function writeLines(file: string, lines: string[]): void {
  fs.writeFileSync(path.join(repoDir, file), `${lines.join('\n')}\n`)
}

const baseLines = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`)

beforeAll(async () => {
  repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-diff-range-')))
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')

  writeLines('sample.txt', baseLines)
  git('add', '.')
  git('commit', '-m', 'base')

  const edited = [...baseLines]
  edited[0] = 'line 1 EDITED'
  writeLines('sample.txt', edited)
  git('add', '.')
  git('commit', '-m', 'edit line 1')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(repoDir, { recursive: true, force: true })
})

describe('getDiff with a commit range', () => {
  it("shows a committed file's change across HEAD~1..HEAD", async () => {
    const diff = await runOp(getDiff(repoDir, 'sample.txt', false, 'HEAD~1..HEAD'))

    expect(diff.diff.hunks).toHaveLength(1)
    expect(diff.diff.hunks[0].lines.some((line) => line.text === 'line 1 EDITED')).toBe(true)
  })

  it('lists a root commit as all additions against the empty tree', async () => {
    const diff = await runOp(getDiff(repoDir, 'sample.txt', false, `${GIT_EMPTY_TREE_OID}..HEAD~1`))

    expect(diff.diff.hunks).toHaveLength(1)
    const added = diff.diff.hunks[0].lines.filter((line) => line.kind === 'add')
    expect(added.map((line) => line.text)).toEqual(baseLines)
  })

  it('still produces the synthetic untracked diff when no range is given', async () => {
    writeLines('fresh.txt', ['alpha', 'beta'])

    const diff = await runOp(getDiff(repoDir, 'fresh.txt', false))

    expect(diff.diff.hunks).toHaveLength(1)
    expect(diff.diff.hunks[0].lines.map((line) => line.text)).toEqual(['alpha', 'beta'])
    expect(diff.diff.hunks[0].lines.every((line) => line.kind === 'add')).toBe(true)

    fs.rmSync(path.join(repoDir, 'fresh.txt'))
  })

  it('rejects an option-like range as a GitError', async () => {
    const result = await runOp(
      Effect.either(getDiff(repoDir, 'sample.txt', false, '--output=/tmp/pwned'))
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })
})
