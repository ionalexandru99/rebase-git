import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRepo, getDiff, getStatus, openRepo, stageHunk, unstageHunk } from '../operations'

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

  const opened = await openRepo(repoDir)
  expect(opened._tag).toBe('Ok')
})

afterAll(async () => {
  await closeRepo(repoDir)
  fs.rmSync(repoDir, { recursive: true, force: true })
})

describe('diff operations against a real repository', () => {
  it('stages a single hunk and leaves the other unstaged', async () => {
    const edited = [...baseLines]
    edited[0] = 'line 1 EDITED'
    edited[35] = 'line 36 EDITED'
    writeLines('sample.txt', edited)

    const unstaged = await getDiff(repoDir, 'sample.txt', false)
    if (unstaged._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${unstaged._tag}`)
    }
    expect(unstaged.diff.hunks).toHaveLength(2)

    const firstHeader = unstaged.diff.hunks[0].header
    const staging = await stageHunk(repoDir, 'sample.txt', firstHeader)
    expect(staging._tag).toBe('Ok')

    const stagedAfter = await getDiff(repoDir, 'sample.txt', true)
    if (stagedAfter._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${stagedAfter._tag}`)
    }
    expect(stagedAfter.diff.hunks).toHaveLength(1)
    expect(stagedAfter.diff.hunks[0].lines.some((line) => line.text === 'line 1 EDITED')).toBe(true)

    const unstagedAfter = await getDiff(repoDir, 'sample.txt', false)
    if (unstagedAfter._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${unstagedAfter._tag}`)
    }
    expect(unstagedAfter.diff.hunks).toHaveLength(1)
    expect(unstagedAfter.diff.hunks[0].lines.some((line) => line.text === 'line 36 EDITED')).toBe(
      true
    )
  })

  it('unstages a staged hunk back to the working tree', async () => {
    const staged = await getDiff(repoDir, 'sample.txt', true)
    if (staged._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${staged._tag}`)
    }
    expect(staged.diff.hunks).toHaveLength(1)

    const result = await unstageHunk(repoDir, 'sample.txt', staged.diff.hunks[0].header)
    expect(result._tag).toBe('Ok')

    const stagedAfter = await getDiff(repoDir, 'sample.txt', true)
    if (stagedAfter._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${stagedAfter._tag}`)
    }
    expect(stagedAfter.diff.hunks).toHaveLength(0)

    const unstagedAfter = await getDiff(repoDir, 'sample.txt', false)
    if (unstagedAfter._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${unstagedAfter._tag}`)
    }
    expect(unstagedAfter.diff.hunks).toHaveLength(2)
  })

  it('reports a fully staged file once every hunk is staged individually', async () => {
    const unstaged = await getDiff(repoDir, 'sample.txt', false)
    if (unstaged._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${unstaged._tag}`)
    }
    expect(unstaged.diff.hunks).toHaveLength(2)

    for (const hunk of unstaged.diff.hunks) {
      const refreshed = await getDiff(repoDir, 'sample.txt', false)
      if (refreshed._tag !== 'Ok') {
        throw new Error(`expected Ok, got ${refreshed._tag}`)
      }
      const liveHunk = refreshed.diff.hunks.find((candidate) =>
        candidate.lines.some((line) => hunk.lines.some((other) => other.text === line.text))
      )
      expect(liveHunk).toBeDefined()
      if (!liveHunk) {
        return
      }
      const staging = await stageHunk(repoDir, 'sample.txt', liveHunk.header)
      expect(staging._tag).toBe('Ok')
    }

    const status = await getStatus(repoDir)
    if (status._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${status._tag}`)
    }
    const entry = status.status.files?.find((candidate) => candidate.path === 'sample.txt')
    expect(entry).toEqual({ path: 'sample.txt', index: 'M', working_dir: ' ' })

    git('reset', 'HEAD', 'sample.txt')
  })

  it('returns HunkNotFound for a stale hunk header', async () => {
    const result = await stageHunk(repoDir, 'sample.txt', '@@ -999,1 +999,1 @@')
    expect(result._tag).toBe('HunkNotFound')
  })

  it('produces a synthetic diff for untracked files', async () => {
    writeLines('brand-new.txt', ['alpha', 'beta'])

    const diff = await getDiff(repoDir, 'brand-new.txt', false)
    if (diff._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${diff._tag}`)
    }
    expect(diff.diff.hunks).toHaveLength(1)
    expect(diff.diff.hunks[0].lines.map((line) => line.text)).toEqual(['alpha', 'beta'])
    expect(diff.diff.hunks[0].lines.every((line) => line.kind === 'add')).toBe(true)
  })

  it('produces a synthetic diff for an untracked unicode-named file', async () => {
    writeLines('café.txt', ['gamma', 'delta'])

    const diff = await getDiff(repoDir, 'café.txt', false)
    if (diff._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${diff._tag}`)
    }
    expect(diff.diff.hunks).toHaveLength(1)
    expect(diff.diff.hunks[0].lines.map((line) => line.text)).toEqual(['gamma', 'delta'])
    expect(diff.diff.hunks[0].lines.every((line) => line.kind === 'add')).toBe(true)
  })

  it('returns an empty diff for a clean tracked file', async () => {
    git('checkout', '--', 'sample.txt')
    git('reset', 'HEAD', 'sample.txt')
    git('checkout', '--', 'sample.txt')

    const diff = await getDiff(repoDir, 'sample.txt', false)
    if (diff._tag !== 'Ok') {
      throw new Error(`expected Ok, got ${diff._tag}`)
    }
    expect(diff.diff.hunks).toHaveLength(0)
  })
})
