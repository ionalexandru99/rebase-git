import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CloneProgress } from '@shared/schemas/git'
import { Effect, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitError } from '../../git/errors'
import { cloneFailureMessage, cloneRepo, parseCloneProgress } from '../clone'

let homeRoot: string
let sourceRepo: string
let destination: string

const collect = (request: {
  url: string
  parentDir: string
  folderName: string
}): Promise<CloneProgress[]> =>
  Effect.runPromise(Stream.runCollect(cloneRepo(request)).pipe(Effect.map((chunks) => [...chunks])))

const collectError = async (request: {
  url: string
  parentDir: string
  folderName: string
}): Promise<GitError> => {
  const exit = await Effect.runPromiseExit(Stream.runDrain(cloneRepo(request)))
  if (exit._tag === 'Success') {
    throw new Error('expected the clone to fail')
  }
  const failure = exit.cause
  const error = failure._tag === 'Fail' ? failure.error : undefined
  if (!(error instanceof GitError)) {
    throw new Error(`expected a GitError, got ${JSON.stringify(failure)}`)
  }
  return error
}

const fileUrl = (repoPath: string): string => `file://${repoPath.split(path.sep).join('/')}`

beforeAll(() => {
  homeRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.homedir(), '.rebase-clone-')))
  sourceRepo = path.join(homeRoot, 'source')
  destination = path.join(homeRoot, 'destination')
  fs.mkdirSync(destination)
  fs.mkdirSync(sourceRepo)
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', sourceRepo, ...args], { stdio: 'ignore' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(sourceRepo, 'README.md'), '# source\n')
  git('add', '.')
  git('commit', '-m', 'initial')
})

afterAll(() => {
  fs.rmSync(homeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('parseCloneProgress', () => {
  it('reads the phase and percentage out of a git progress line', () => {
    expect(parseCloneProgress('Receiving objects:  47% (470/1000)')).toEqual({
      phase: 'Receiving objects',
      percent: 47
    })
    expect(parseCloneProgress('remote: Counting objects: 100% (12/12), done.')).toEqual({
      phase: 'Counting objects',
      percent: 100
    })
  })

  it('ignores the lines that carry no progress', () => {
    expect(parseCloneProgress("Cloning into '/tmp/repo'...")).toBeNull()
    expect(parseCloneProgress('')).toBeNull()
    expect(parseCloneProgress('fatal: repository not found')).toBeNull()
  })
})

describe('cloneFailureMessage', () => {
  it('keeps the reason git gave and drops the progress redraws around it', () => {
    const stderr = [
      "Cloning into '/home/user/code/repo'...",
      'remote: Enumerating objects: 12, done.\r',
      'Receiving objects:  50% (6/12)\rReceiving objects: 100% (12/12)\r',
      'remote: Repository not found.',
      "fatal: repository 'https://github.com/owner/repo.git/' not found"
    ].join('\n')

    expect(cloneFailureMessage(stderr, 128)).toBe(
      [
        'remote: Enumerating objects: 12, done.',
        'remote: Repository not found.',
        "fatal: repository 'https://github.com/owner/repo.git/' not found"
      ].join('\n')
    )
  })

  it('falls back to the exit code when git said nothing usable', () => {
    expect(cloneFailureMessage('Receiving objects: 100% (2/2)\r', 1)).toBe(
      'git clone exited with code 1'
    )
  })
})

describe('cloneRepo', () => {
  it('clones a repository and reports the finished location on the last chunk', async () => {
    const chunks = await collect({
      url: fileUrl(sourceRepo),
      parentDir: destination,
      folderName: 'cloned'
    })

    const last = chunks[chunks.length - 1]
    expect(last.done).toBe(true)
    expect(last.path).toBe(path.join(destination, 'cloned'))
    expect(chunks.filter((chunk) => chunk.done)).toHaveLength(1)
    expect(chunks[0]).toEqual({ phase: 'Connecting', done: false })
    expect(fs.existsSync(path.join(destination, 'cloned', '.git'))).toBe(true)
    expect(fs.readFileSync(path.join(destination, 'cloned', 'README.md'), 'utf8')).toBe(
      '# source\n'
    )
  })

  it('refuses a destination folder that already exists', async () => {
    const error = await collectError({
      url: fileUrl(sourceRepo),
      parentDir: destination,
      folderName: 'cloned'
    })
    expect(error.message).toBe('cloned already exists in that folder')
  })

  it('rejects a URL git could read as a flag', async () => {
    const error = await collectError({
      url: '--upload-pack=touch pwned',
      parentDir: destination,
      folderName: 'flagged'
    })
    expect(error.message).toBe('that does not look like a repository URL')
    expect(fs.existsSync(path.join(destination, 'flagged'))).toBe(false)
  })

  it('rejects a folder name that escapes the destination', async () => {
    const error = await collectError({
      url: fileUrl(sourceRepo),
      parentDir: destination,
      folderName: '../escaped'
    })
    expect(error.message).toBe('invalid folder name for the clone')
    expect(fs.existsSync(path.join(homeRoot, 'escaped'))).toBe(false)
  })

  it('rejects a destination outside the user home tree', async () => {
    const error = await collectError({
      url: fileUrl(sourceRepo),
      parentDir: path.parse(os.homedir()).root,
      folderName: 'outside'
    })
    expect(error.message).toBe('invalid destination folder')
  })

  // The tight timeout is the point: git rejects this URL almost immediately, so a clone whose
  // outcome was wired up after the process could already have exited would hang here instead.
  it('reports a git that exits immediately, leaving no partial folder behind', async () => {
    const error = await collectError({
      url: fileUrl(path.join(homeRoot, 'not-a-repo')),
      parentDir: destination,
      folderName: 'failed'
    })
    expect(error.message).toMatch(/does not appear to be a git repository|not found|unable to/i)
    expect(fs.existsSync(path.join(destination, 'failed'))).toBe(false)
  }, 5_000)
})
