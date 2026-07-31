import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fingerprintHunk } from '@shared/hunk-fingerprint'
import type { DiffLine } from '@shared/unified-diff'
import { parseUnifiedDiff } from '@shared/unified-diff'
import { Effect, Either } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeGit } from '../../test-support/git-cli'
import {
  conflictedPaths,
  makeConflictedRepo,
  removeRepoDir
} from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getDiff, openRepo, stageLines, unstageLines } from '../index'

const hunksOf = (result: { patch: string }) => parseUnifiedDiff(result.patch).hunks
let repoDir: string
let git: ReturnType<typeof makeGit>

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(repoDir, file)), { recursive: true })
  fs.writeFileSync(path.join(repoDir, file), content)
}

function writeLines(file: string, lines: string[]): void {
  write(file, `${lines.join('\n')}\n`)
}

function commitAll(message: string): void {
  git('add', '-A')
  git('-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '-m', message)
}

function indexBlob(file: string): string {
  return git('show', `:${file}`)
}

async function selectLines(
  file: string,
  staged: boolean,
  pick: (line: DiffLine, index: number, hunkIndex: number) => boolean
) {
  const { patch } = await runOp(getDiff(repoDir, file, staged))
  return parseUnifiedDiff(patch).hunks.flatMap((hunk, hunkIndex) => {
    const lineIndexes = hunk.lines
      .map((line, index) => (pick(line, index, hunkIndex) ? index : -1))
      .filter((index) => index !== -1)
    if (lineIndexes.length === 0) {
      return []
    }
    const fingerprint = fingerprintHunk(patch, hunk.header)
    if (fingerprint === null) {
      throw new Error(`no fingerprint for ${hunk.header}`)
    }
    return [{ hunkHeader: hunk.header, lineIndexes, fingerprint }]
  })
}

beforeEach(async () => {
  repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-line-stage-')))
  git = makeGit(repoDir)
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeLines('file.txt', ['one', 'two', 'three'])
  commitAll('base')
  await runOp(openRepo(repoDir))
})

afterEach(async () => {
  await runOp(closeRepo(repoDir))
  removeRepoDir(repoDir)
})

describe('stageLines', () => {
  it('stages one of two added lines and leaves the other unstaged', async () => {
    writeLines('file.txt', ['one', 'added-1', 'added-2', 'two', 'three'])

    const selections = await selectLines(
      'file.txt',
      false,
      (line) => line.kind === 'add' && line.text === 'added-1'
    )
    await runOp(stageLines(repoDir, 'file.txt', selections))

    expect(indexBlob('file.txt')).toBe('one\nadded-1\ntwo\nthree\n')
    expect(fs.readFileSync(path.join(repoDir, 'file.txt'), 'utf8')).toBe(
      'one\nadded-1\nadded-2\ntwo\nthree\n'
    )

    const remaining = await runOp(getDiff(repoDir, 'file.txt', false))
    expect(hunksOf(remaining)).toHaveLength(1)
    const addedTexts = hunksOf(remaining)[0]
      .lines.filter((line) => line.kind === 'add')
      .map((line) => line.text)
    expect(addedTexts).toEqual(['added-2'])
  })

  it('demotes an unselected deletion to context and keeps it in the index', async () => {
    writeLines('file.txt', ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'])
    commitAll('eight lines')
    writeLines('file.txt', ['one', 'three', 'four', 'five', 'six', 'eight'])

    const selections = await selectLines(
      'file.txt',
      false,
      (line) => line.kind === 'del' && line.text === 'two'
    )
    await runOp(stageLines(repoDir, 'file.txt', selections))

    expect(indexBlob('file.txt')).toBe('one\nthree\nfour\nfive\nsix\nseven\neight\n')
  })

  it('stages a deletion without its paired addition', async () => {
    writeLines('file.txt', ['one', 'TWO', 'three'])

    const selections = await selectLines('file.txt', false, (line) => line.kind === 'del')
    await runOp(stageLines(repoDir, 'file.txt', selections))

    expect(indexBlob('file.txt')).toBe('one\nthree\n')
    expect(fs.readFileSync(path.join(repoDir, 'file.txt'), 'utf8')).toBe('one\nTWO\nthree\n')
  })

  it('stages selections across multiple hunks and skips hunks without a selection', async () => {
    const base = Array.from({ length: 30 }, (_, index) => `L${index + 1}`)
    writeLines('file.txt', base)
    commitAll('thirty lines')
    const edited = [...base]
    edited[14] = 'L15-edited'
    edited[27] = 'L28-edited'
    edited.splice(2, 0, 'inserted')
    writeLines('file.txt', edited)

    const selections = await selectLines(
      'file.txt',
      false,
      (line, _index, hunkIndex) =>
        (hunkIndex === 0 && line.kind === 'add') ||
        (hunkIndex === 2 && (line.kind === 'add' || line.kind === 'del'))
    )
    expect(selections).toHaveLength(2)
    await runOp(stageLines(repoDir, 'file.txt', selections))

    const expected = [...base]
    expected[27] = 'L28-edited'
    expected.splice(2, 0, 'inserted')
    expect(indexBlob('file.txt')).toBe(`${expected.join('\n')}\n`)

    const remaining = await runOp(getDiff(repoDir, 'file.txt', false))
    expect(hunksOf(remaining)).toHaveLength(1)
    expect(hunksOf(remaining)[0].lines.some((line) => line.text === 'L15-edited')).toBe(true)
  })

  it('unstages one of two staged added lines', async () => {
    writeLines('file.txt', ['one', 'added-1', 'added-2', 'two', 'three'])
    git('add', '--', 'file.txt')

    const selections = await selectLines(
      'file.txt',
      true,
      (line) => line.kind === 'add' && line.text === 'added-2'
    )
    await runOp(unstageLines(repoDir, 'file.txt', selections))

    expect(indexBlob('file.txt')).toBe('one\nadded-1\ntwo\nthree\n')
    expect(fs.readFileSync(path.join(repoDir, 'file.txt'), 'utf8')).toBe(
      'one\nadded-1\nadded-2\ntwo\nthree\n'
    )
  })

  it('unstages the deletion of a replace pair, restoring the deleted line before the kept one', async () => {
    writeLines('file.txt', ['one', 'TWO', 'three'])
    git('add', '--', 'file.txt')

    const selections = await selectLines('file.txt', true, (line) => line.kind === 'del')
    await runOp(unstageLines(repoDir, 'file.txt', selections))

    expect(indexBlob('file.txt')).toBe('one\ntwo\nTWO\nthree\n')
  })

  it('stages the full replacement of a final line that loses its trailing newline', async () => {
    write('file.txt', 'one\ntwo\nthree')
    commitAll('no trailing newline')
    write('file.txt', 'one\ntwo')

    const selections = await selectLines(
      'file.txt',
      false,
      (line) => line.kind === 'add' || line.kind === 'del'
    )
    await runOp(stageLines(repoDir, 'file.txt', selections))

    expect(indexBlob('file.txt')).toBe('one\ntwo')
  })

  it('stages only the deletion of the final no-newline line, keeping the newline before it', async () => {
    write('file.txt', 'one\ntwo\nthree')
    commitAll('no trailing newline')
    write('file.txt', 'one\ntwo')

    const selections = await selectLines(
      'file.txt',
      false,
      (line) => line.kind === 'del' && line.text === 'three'
    )
    await runOp(stageLines(repoDir, 'file.txt', selections))

    expect(indexBlob('file.txt')).toBe('one\ntwo\n')
  })

  it('stages an appended line after an unselected no-newline pair by splitting the context line', async () => {
    write('file.txt', 'one\ntwo')
    commitAll('no trailing newline')
    write('file.txt', 'one\ntwo\nthree')

    const selections = await selectLines(
      'file.txt',
      false,
      (line) => line.kind === 'add' && line.text === 'three'
    )
    await runOp(stageLines(repoDir, 'file.txt', selections))

    expect(indexBlob('file.txt')).toBe('one\ntwo\nthree')
  })

  it('unstages a staged no-newline final line back out of the index', async () => {
    write('file.txt', 'one\ntwo\n')
    commitAll('trailing newline')
    write('file.txt', 'one\ntwo\nthree')
    git('add', '--', 'file.txt')

    const selections = await selectLines(
      'file.txt',
      true,
      (line) => line.kind === 'add' && line.text === 'three'
    )
    await runOp(unstageLines(repoDir, 'file.txt', selections))

    expect(indexBlob('file.txt')).toBe('one\ntwo\n')
    expect(fs.readFileSync(path.join(repoDir, 'file.txt'), 'utf8')).toBe('one\ntwo\nthree')
  })

  it('stages part of a file deletion, leaving the unselected lines in the index', async () => {
    fs.rmSync(path.join(repoDir, 'file.txt'))

    const selections = await selectLines(
      'file.txt',
      false,
      (line) => line.kind === 'del' && line.text === 'two'
    )
    await runOp(stageLines(repoDir, 'file.txt', selections))

    expect(indexBlob('file.txt')).toBe('one\nthree\n')
    expect(git('status', '--porcelain', '--', 'file.txt').slice(0, 2)).toBe('MD')
  })

  it('stages the whole deletion when every deleted line is selected', async () => {
    fs.rmSync(path.join(repoDir, 'file.txt'))

    const selections = await selectLines('file.txt', false, (line) => line.kind === 'del')
    await runOp(stageLines(repoDir, 'file.txt', selections))

    expect(git('status', '--porcelain', '--', 'file.txt').slice(0, 2)).toBe('D ')
  })

  it('partially unstages a staged new file, keeping the unselected lines staged', async () => {
    writeLines('brand-new.txt', ['alpha', 'beta', 'gamma'])
    git('add', '--', 'brand-new.txt')

    const selections = await selectLines(
      'brand-new.txt',
      true,
      (line) => line.kind === 'add' && line.text === 'beta'
    )
    await runOp(unstageLines(repoDir, 'brand-new.txt', selections))

    expect(indexBlob('brand-new.txt')).toBe('alpha\ngamma\n')
    expect(git('status', '--porcelain', '--', 'brand-new.txt').slice(0, 2)).toBe('AM')
  })

  it('fully unstages a staged new file back to untracked when every line is selected', async () => {
    writeLines('brand-new.txt', ['alpha', 'beta'])
    git('add', '--', 'brand-new.txt')

    const selections = await selectLines('brand-new.txt', true, (line) => line.kind === 'add')
    await runOp(unstageLines(repoDir, 'brand-new.txt', selections))

    expect(git('status', '--porcelain', '--', 'brand-new.txt').slice(0, 2)).toBe('??')
    expect(fs.readFileSync(path.join(repoDir, 'brand-new.txt'), 'utf8')).toBe('alpha\nbeta\n')
  })

  it('stages a subset of an untracked file through the no-index fallback diff', async () => {
    writeLines('brand-new.txt', ['alpha', 'beta', 'gamma'])

    const selections = await selectLines(
      'brand-new.txt',
      false,
      (line) => line.kind === 'add' && line.text !== 'beta'
    )
    await runOp(stageLines(repoDir, 'brand-new.txt', selections))

    expect(indexBlob('brand-new.txt')).toBe('alpha\ngamma\n')
    expect(fs.readFileSync(path.join(repoDir, 'brand-new.txt'), 'utf8')).toBe(
      'alpha\nbeta\ngamma\n'
    )
  })

  it('round-trips CRLF content byte-for-byte through a partial stage', async () => {
    write('crlf.txt', 'one\r\ntwo\r\nthree\r\n')
    commitAll('crlf base')
    write('crlf.txt', 'one\r\nadded-1\r\nadded-2\r\ntwo\r\nthree\r\n')

    const selections = await selectLines(
      'crlf.txt',
      false,
      (line) => line.kind === 'add' && line.text === 'added-1\r'
    )
    await runOp(stageLines(repoDir, 'crlf.txt', selections))

    expect(indexBlob('crlf.txt')).toBe('one\r\nadded-1\r\ntwo\r\nthree\r\n')
  })

  it('fails with HunkNotFound for a stale hunk header', async () => {
    writeLines('file.txt', ['one', 'added', 'two', 'three'])

    const result = await runOp(
      Effect.either(
        stageLines(repoDir, 'file.txt', [
          { hunkHeader: '@@ -999,1 +999,1 @@', lineIndexes: [0], fingerprint: '00000000' }
        ])
      )
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('HunkNotFound')
    }
  })

  it('fails with HunkNotFound when the fingerprint does not match the hunk body', async () => {
    writeLines('file.txt', ['one', 'added', 'two', 'three'])

    const selections = await selectLines('file.txt', false, (line) => line.kind === 'add')
    const tampered = selections.map((selection) => ({ ...selection, fingerprint: 'deadbeef' }))
    const result = await runOp(Effect.either(stageLines(repoDir, 'file.txt', tampered)))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('HunkNotFound')
    }
    expect(git('diff', '--cached', '--name-only')).toBe('')
  })

  it('rejects line staging on a conflicted file instead of corrupting the index', async () => {
    const fixture = makeConflictedRepo('merge')
    await runOp(openRepo(fixture.path))
    try {
      const conflicted = conflictedPaths(fixture.path)[0]
      const stageResult = await runOp(
        Effect.either(
          stageLines(fixture.path, conflicted, [
            { hunkHeader: '@@ -1,1 +1,1 @@', lineIndexes: [0], fingerprint: '00000000' }
          ])
        )
      )
      expect(Either.isLeft(stageResult)).toBe(true)
      if (Either.isLeft(stageResult)) {
        expect(stageResult.left._tag).toBe('GitError')
      }
      const unstageResult = await runOp(
        Effect.either(
          unstageLines(fixture.path, conflicted, [
            { hunkHeader: '@@ -1,1 +1,1 @@', lineIndexes: [0], fingerprint: '00000000' }
          ])
        )
      )
      expect(Either.isLeft(unstageResult)).toBe(true)
      if (Either.isLeft(unstageResult)) {
        expect(unstageResult.left._tag).toBe('OperationInProgress')
      }
    } finally {
      await runOp(closeRepo(fixture.path))
      removeRepoDir(fixture.path)
    }
  })

  it('fails with HunkNotFound when only context lines are selected', async () => {
    writeLines('file.txt', ['one', 'added', 'two', 'three'])

    const selections = await selectLines('file.txt', false, (line) => line.kind === 'context')
    const result = await runOp(Effect.either(stageLines(repoDir, 'file.txt', selections)))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('HunkNotFound')
    }
  })
})
