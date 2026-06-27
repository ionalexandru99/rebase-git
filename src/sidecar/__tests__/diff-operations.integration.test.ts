import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  closeRepo,
  getDiff,
  getStatus,
  openRepo,
  stageHunk,
  unstageFile,
  unstageHunk
} from '../operations'
import { runOp } from './run-op'

let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function writeLines(file: string, lines: string[]): void {
  fs.writeFileSync(path.join(repoDir, file), `${lines.join('\n')}\n`)
}

const baseLines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)

beforeAll(async () => {
  repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-diff-test-')))
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeLines('sample.txt', baseLines)
  git('add', '.')
  git('commit', '-m', 'base')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(repoDir, { recursive: true, force: true })
})

describe('diff operations against a real repository', () => {
  it('stages a single hunk and leaves the other unstaged', async () => {
    const edited = [...baseLines]
    edited[0] = 'line 1 EDITED'
    edited[35] = 'line 36 EDITED'
    writeLines('sample.txt', edited)

    const unstaged = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(unstaged.diff.hunks).toHaveLength(2)

    const firstHeader = unstaged.diff.hunks[0].header
    await runOp(stageHunk(repoDir, 'sample.txt', firstHeader))

    const stagedAfter = await runOp(getDiff(repoDir, 'sample.txt', true))
    expect(stagedAfter.diff.hunks).toHaveLength(1)
    expect(stagedAfter.diff.hunks[0].lines.some((line) => line.text === 'line 1 EDITED')).toBe(true)

    const unstagedAfter = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(unstagedAfter.diff.hunks).toHaveLength(1)
    expect(unstagedAfter.diff.hunks[0].lines.some((line) => line.text === 'line 36 EDITED')).toBe(
      true
    )
  })

  it('unstages a staged hunk back to the working tree', async () => {
    const staged = await runOp(getDiff(repoDir, 'sample.txt', true))
    expect(staged.diff.hunks).toHaveLength(1)

    await runOp(unstageHunk(repoDir, 'sample.txt', staged.diff.hunks[0].header))

    const stagedAfter = await runOp(getDiff(repoDir, 'sample.txt', true))
    expect(stagedAfter.diff.hunks).toHaveLength(0)

    const unstagedAfter = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(unstagedAfter.diff.hunks).toHaveLength(2)
  })

  it('reports a fully staged file once every hunk is staged individually', async () => {
    const unstaged = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(unstaged.diff.hunks).toHaveLength(2)

    for (const hunk of unstaged.diff.hunks) {
      const refreshed = await runOp(getDiff(repoDir, 'sample.txt', false))
      const liveHunk = refreshed.diff.hunks.find((candidate) =>
        candidate.lines.some((line) => hunk.lines.some((other) => other.text === line.text))
      )
      expect(liveHunk).toBeDefined()
      if (!liveHunk) {
        return
      }
      await runOp(stageHunk(repoDir, 'sample.txt', liveHunk.header))
    }

    const status = await runOp(getStatus(repoDir))
    const entry = status.status.files?.find((candidate) => candidate.path === 'sample.txt')
    expect(entry).toEqual({ path: 'sample.txt', index: 'M', working_dir: ' ' })

    git('reset', 'HEAD', 'sample.txt')
  })

  it('returns HunkNotFound for a stale hunk header', async () => {
    const result = await runOp(
      Effect.either(stageHunk(repoDir, 'sample.txt', '@@ -999,1 +999,1 @@'))
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('HunkNotFound')
    }
  })

  it('produces a synthetic diff for untracked files', async () => {
    writeLines('brand-new.txt', ['alpha', 'beta'])

    const diff = await runOp(getDiff(repoDir, 'brand-new.txt', false))
    expect(diff.diff.hunks).toHaveLength(1)
    expect(diff.diff.hunks[0].lines.map((line) => line.text)).toEqual(['alpha', 'beta'])
    expect(diff.diff.hunks[0].lines.every((line) => line.kind === 'add')).toBe(true)
  })

  it('produces a synthetic diff for an untracked unicode-named file', async () => {
    writeLines('café.txt', ['gamma', 'delta'])

    const diff = await runOp(getDiff(repoDir, 'café.txt', false))
    expect(diff.diff.hunks).toHaveLength(1)
    expect(diff.diff.hunks[0].lines.map((line) => line.text)).toEqual(['gamma', 'delta'])
    expect(diff.diff.hunks[0].lines.every((line) => line.kind === 'add')).toBe(true)
  })

  it('returns an empty diff for a clean tracked file', async () => {
    git('checkout', '--', 'sample.txt')
    git('reset', 'HEAD', 'sample.txt')
    git('checkout', '--', 'sample.txt')

    const diff = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(diff.diff.hunks).toHaveLength(0)
  })

  it('unstages an option-like filename as a path, never as a flag', async () => {
    const canary = 'reset-canary.txt'
    fs.writeFileSync(path.join(repoDir, canary), 'committed\n')
    git('add', '--', canary)
    git('commit', '-m', 'add reset canary')
    fs.writeFileSync(path.join(repoDir, canary), 'uncommitted edit\n')

    const optionLikeName = '--hard'
    fs.writeFileSync(path.join(repoDir, optionLikeName), 'staged\n')
    git('add', '--', optionLikeName)

    await runOp(unstageFile(repoDir, optionLikeName))

    expect(git('diff', '--cached', '--name-only')).not.toContain(optionLikeName)
    expect(fs.readFileSync(path.join(repoDir, canary), 'utf8')).toBe('uncommitted edit\n')

    fs.rmSync(path.join(repoDir, optionLikeName))
    git('checkout', '--', canary)
  })
})
