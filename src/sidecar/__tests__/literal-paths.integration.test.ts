import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { GitError } from '@shared/git-rpc-errors'
import { SidecarRpcs } from '@shared/rpc'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { amendCommit, checkoutRef, closeRepo, openRepo, stashPush } from '../operations'
import { handlersLayer } from '../rpc-handlers'
import { runOp } from './run-op'

interface TestRepo {
  dir: string
  git: (...args: string[]) => string
  write: (name: string, contents: string) => void
  read: (name: string) => string
}

function createRepo(prefix: string): TestRepo {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  const dir = path.join(base, 'repo')
  fs.mkdirSync(dir)
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  return {
    dir,
    git,
    write: (name, contents) => fs.writeFileSync(path.join(dir, name), contents),
    read: (name) => fs.readFileSync(path.join(dir, name), 'utf8')
  }
}

function destroyRepo(repo: TestRepo): void {
  fs.rmSync(path.dirname(repo.dir), { recursive: true, force: true })
}

const splitNul = (raw: string): string[] => raw.split('\0').filter((entry) => entry.length > 0)
const stagedNames = (repo: TestRepo): string[] =>
  splitNul(repo.git('diff', '--cached', '--name-only', '-z'))
const unstagedNames = (repo: TestRepo): string[] => splitNul(repo.git('diff', '--name-only', '-z'))
const untrackedNames = (repo: TestRepo): string[] =>
  splitNul(repo.git('ls-files', '--others', '--exclude-standard', '-z'))

const resetRepo = (repo: TestRepo): void => {
  repo.git('reset', '--hard', 'HEAD')
  repo.git('clean', '-fd')
  repo.git('stash', 'clear')
}

const rpcStageFile = (payload: { repoPath: string; file: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.stageFile(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const rpcStageAll = (payload: { repoPath: string; files: string[] }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.stageAll(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const rpcUnstageFile = (payload: { repoPath: string; file: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.unstageFile(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const rpcUnstageAll = (payload: { repoPath: string; files: string[] }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.unstageAll(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const rpcDiscardChanges = (payload: { repoPath: string; files: string[] }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.discardChanges(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const rpcGetDiff = (payload: { repoPath: string; file: string; staged?: boolean }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.getDiff(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

// `*` and `:` are illegal in Win32 filenames, so these fixtures cannot exist there. The
// bracket-glob suite below covers the same literal-pathspec contract with Windows-legal names.
describe.skipIf(process.platform === 'win32')('glob-named files are matched literally', () => {
  let repo: TestRepo

  beforeAll(async () => {
    repo = createRepo('rebase-literal-glob-')
    repo.write('*.txt', 'star base\n')
    repo.write('other.txt', 'other base\n')
    repo.write(':(weird).txt', 'weird base\n')
    repo.git('add', '.')
    repo.git('commit', '-m', 'base')
    await runOp(openRepo(repo.dir))
  })

  afterAll(async () => {
    await runOp(closeRepo(repo.dir))
    destroyRepo(repo)
  })

  beforeEach(() => {
    resetRepo(repo)
  })

  it('stageFile stages only the file literally named *.txt', async () => {
    repo.write('*.txt', 'star changed\n')
    repo.write('other.txt', 'other changed\n')
    const result = await rpcStageFile({ repoPath: repo.dir, file: '*.txt' })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['*.txt'])
    expect(unstagedNames(repo)).toEqual(['other.txt'])
  })

  it('stageAll stages only the file literally named *.txt', async () => {
    repo.write('*.txt', 'star changed\n')
    repo.write('other.txt', 'other changed\n')
    const result = await rpcStageAll({ repoPath: repo.dir, files: ['*.txt'] })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['*.txt'])
    expect(unstagedNames(repo)).toEqual(['other.txt'])
  })

  it('unstageFile unstages only the file literally named *.txt', async () => {
    repo.write('*.txt', 'star changed\n')
    repo.write('other.txt', 'other changed\n')
    repo.git('add', '.')
    const result = await rpcUnstageFile({ repoPath: repo.dir, file: '*.txt' })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['other.txt'])
    expect(unstagedNames(repo)).toEqual(['*.txt'])
  })

  it('unstageAll unstages only the file literally named *.txt', async () => {
    repo.write('*.txt', 'star changed\n')
    repo.write('other.txt', 'other changed\n')
    repo.git('add', '.')
    const result = await rpcUnstageAll({ repoPath: repo.dir, files: ['*.txt'] })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['other.txt'])
    expect(unstagedNames(repo)).toEqual(['*.txt'])
  })

  it('discardChanges reverts only the file literally named *.txt', async () => {
    repo.write('*.txt', 'star changed\n')
    repo.write('other.txt', 'other changed\n')
    const result = await rpcDiscardChanges({ repoPath: repo.dir, files: ['*.txt'] })
    expect(Either.isRight(result)).toBe(true)
    expect(repo.read('*.txt')).toBe('star base\n')
    expect(repo.read('other.txt')).toBe('other changed\n')
    expect(unstagedNames(repo)).toEqual(['other.txt'])
  })

  it('getDiff for *.txt does not leak sibling .txt diffs', async () => {
    repo.write('other.txt', 'other changed\n')
    const result = await rpcGetDiff({ repoPath: repo.dir, file: '*.txt' })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.diff.hunks).toHaveLength(0)
    }
  })

  it('stages and discards a file whose name starts with pathspec magic', async () => {
    repo.write(':(weird).txt', 'weird changed\n')
    const staged = await rpcStageFile({ repoPath: repo.dir, file: ':(weird).txt' })
    expect(Either.isRight(staged)).toBe(true)
    expect(stagedNames(repo)).toEqual([':(weird).txt'])

    resetRepo(repo)
    repo.write(':(weird).txt', 'weird changed\n')
    const discarded = await rpcDiscardChanges({ repoPath: repo.dir, files: [':(weird).txt'] })
    expect(Either.isRight(discarded)).toBe(true)
    expect(repo.read(':(weird).txt')).toBe('weird base\n')
  })

  it('stashPush stashes only the file literally named *.txt', async () => {
    repo.write('*.txt', 'star changed\n')
    repo.write('other.txt', 'other changed\n')
    repo.git('add', '--', ':(literal)*.txt')
    await runOp(stashPush(repo.dir, 'partial', false, ['*.txt']))
    expect(repo.read('*.txt')).toBe('star base\n')
    expect(repo.read('other.txt')).toBe('other changed\n')
  })
})

// `[abc]` is a glob character class that Win32 permits in filenames, so this runs everywhere.
// `a.txt` is the decoy the class would match if a pathspec were ever passed unescaped.
describe('bracket-globbed files are matched literally', () => {
  let repo: TestRepo

  beforeAll(async () => {
    repo = createRepo('rebase-literal-bracket-')
    repo.write('[abc].txt', 'bracket base\n')
    repo.write('a.txt', 'decoy base\n')
    repo.git('add', '.')
    repo.git('commit', '-m', 'base')
    await runOp(openRepo(repo.dir))
  })

  afterAll(async () => {
    await runOp(closeRepo(repo.dir))
    destroyRepo(repo)
  })

  beforeEach(() => {
    resetRepo(repo)
  })

  it('stageFile stages only the file literally named [abc].txt', async () => {
    repo.write('[abc].txt', 'bracket changed\n')
    repo.write('a.txt', 'decoy changed\n')
    const result = await rpcStageFile({ repoPath: repo.dir, file: '[abc].txt' })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['[abc].txt'])
    expect(unstagedNames(repo)).toEqual(['a.txt'])
  })

  it('stageAll stages only the file literally named [abc].txt', async () => {
    repo.write('[abc].txt', 'bracket changed\n')
    repo.write('a.txt', 'decoy changed\n')
    const result = await rpcStageAll({ repoPath: repo.dir, files: ['[abc].txt'] })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['[abc].txt'])
    expect(unstagedNames(repo)).toEqual(['a.txt'])
  })

  it('unstageFile unstages only the file literally named [abc].txt', async () => {
    repo.write('[abc].txt', 'bracket changed\n')
    repo.write('a.txt', 'decoy changed\n')
    repo.git('add', '.')
    const result = await rpcUnstageFile({ repoPath: repo.dir, file: '[abc].txt' })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['a.txt'])
    expect(unstagedNames(repo)).toEqual(['[abc].txt'])
  })

  it('unstageAll unstages only the file literally named [abc].txt', async () => {
    repo.write('[abc].txt', 'bracket changed\n')
    repo.write('a.txt', 'decoy changed\n')
    repo.git('add', '.')
    const result = await rpcUnstageAll({ repoPath: repo.dir, files: ['[abc].txt'] })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['a.txt'])
    expect(unstagedNames(repo)).toEqual(['[abc].txt'])
  })

  it('discardChanges reverts only the file literally named [abc].txt', async () => {
    repo.write('[abc].txt', 'bracket changed\n')
    repo.write('a.txt', 'decoy changed\n')
    const result = await rpcDiscardChanges({ repoPath: repo.dir, files: ['[abc].txt'] })
    expect(Either.isRight(result)).toBe(true)
    expect(repo.read('[abc].txt')).toBe('bracket base\n')
    expect(repo.read('a.txt')).toBe('decoy changed\n')
    expect(unstagedNames(repo)).toEqual(['a.txt'])
  })

  it('getDiff for [abc].txt does not leak the decoy diff', async () => {
    repo.write('a.txt', 'decoy changed\n')
    const result = await rpcGetDiff({ repoPath: repo.dir, file: '[abc].txt' })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.diff.hunks).toHaveLength(0)
    }
  })

  it('stashPush stashes only the file literally named [abc].txt', async () => {
    repo.write('[abc].txt', 'bracket changed\n')
    repo.write('a.txt', 'decoy changed\n')
    repo.git('add', '--', ':(literal)[abc].txt')
    await runOp(stashPush(repo.dir, 'partial', false, ['[abc].txt']))
    expect(repo.read('[abc].txt')).toBe('bracket base\n')
    expect(repo.read('a.txt')).toBe('decoy changed\n')
  })
})

describe('dash-named files are file arguments, not options', () => {
  let repo: TestRepo

  beforeAll(async () => {
    repo = createRepo('rebase-literal-dash-')
    repo.write('-n.txt', 'dash base\n')
    repo.write('tracked.txt', 'base\n')
    repo.git('add', '.')
    repo.git('commit', '-m', 'base')
    await runOp(openRepo(repo.dir))
  })

  afterAll(async () => {
    await runOp(closeRepo(repo.dir))
    destroyRepo(repo)
  })

  beforeEach(() => {
    resetRepo(repo)
  })

  it('stageFile stages the untracked file named -u instead of acting like git add -u', async () => {
    repo.write('-u', 'dash u\n')
    repo.write('tracked.txt', 'changed\n')
    const result = await rpcStageFile({ repoPath: repo.dir, file: '-u' })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['-u'])
    expect(unstagedNames(repo)).toEqual(['tracked.txt'])
  })

  it('stageFile stages a file named --chmod=+x', async () => {
    repo.write('--chmod=+x', 'chmod file\n')
    const result = await rpcStageFile({ repoPath: repo.dir, file: '--chmod=+x' })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['--chmod=+x'])
  })

  it('discardChanges restores a tracked dash-named file', async () => {
    repo.write('-n.txt', 'dash changed\n')
    const result = await rpcDiscardChanges({ repoPath: repo.dir, files: ['-n.txt'] })
    expect(Either.isRight(result)).toBe(true)
    expect(repo.read('-n.txt')).toBe('dash base\n')
  })

  it('discardChanges deletes an untracked dash-named file', async () => {
    repo.write('-f', 'junk\n')
    const result = await rpcDiscardChanges({ repoPath: repo.dir, files: ['-f'] })
    expect(Either.isRight(result)).toBe(true)
    expect(fs.existsSync(path.join(repo.dir, '-f'))).toBe(false)
    expect(untrackedNames(repo)).toEqual([])
  })

  it('stashPush stashes a dash-named file', async () => {
    repo.write('-n.txt', 'dash changed\n')
    repo.write('tracked.txt', 'changed\n')
    repo.git('add', '--', '-n.txt')
    await runOp(stashPush(repo.dir, undefined, false, ['-n.txt']))
    expect(repo.read('-n.txt')).toBe('dash base\n')
    expect(repo.read('tracked.txt')).toBe('changed\n')
  })

  it('getDiff surfaces an untracked dash-named file via the no-index fallback', async () => {
    repo.write('-w', 'dash diff\n')
    const result = await rpcGetDiff({ repoPath: repo.dir, file: '-w' })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.diff.hunks.length).toBeGreaterThan(0)
    }
  })
})

// Win32 forbids tab characters and silently strips trailing spaces, so these names are
// uncreatable there — the fixture itself cannot be built, not just the assertions.
describe.skipIf(process.platform === 'win32')('whitespace-edged names survive end to end', () => {
  let repo: TestRepo

  beforeAll(async () => {
    repo = createRepo('rebase-literal-space-')
    repo.write(' padded.txt ', 'padded base\n')
    repo.write('padded.txt', 'decoy base\n')
    repo.write('a\tb.txt', 'tab base\n')
    repo.git('add', '.')
    repo.git('commit', '-m', 'base')
    await runOp(openRepo(repo.dir))
  })

  afterAll(async () => {
    await runOp(closeRepo(repo.dir))
    destroyRepo(repo)
  })

  beforeEach(() => {
    resetRepo(repo)
  })

  it('stageFile stages the space-padded file, not its trimmed decoy', async () => {
    repo.write(' padded.txt ', 'padded changed\n')
    repo.write('padded.txt', 'decoy changed\n')
    const result = await rpcStageFile({ repoPath: repo.dir, file: ' padded.txt ' })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual([' padded.txt '])
    expect(unstagedNames(repo)).toEqual(['padded.txt'])
  })

  it('discardChanges reverts the space-padded file, not its trimmed decoy', async () => {
    repo.write(' padded.txt ', 'padded changed\n')
    repo.write('padded.txt', 'decoy changed\n')
    const result = await rpcDiscardChanges({ repoPath: repo.dir, files: [' padded.txt '] })
    expect(Either.isRight(result)).toBe(true)
    expect(repo.read(' padded.txt ')).toBe('padded base\n')
    expect(repo.read('padded.txt')).toBe('decoy changed\n')
  })

  it('stageFile stages a tab-in-name file', async () => {
    repo.write('a\tb.txt', 'tab changed\n')
    const result = await rpcStageFile({ repoPath: repo.dir, file: 'a\tb.txt' })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toEqual(['a\tb.txt'])
  })
})

describe('unicode names survive end to end', () => {
  let repo: TestRepo

  beforeAll(async () => {
    repo = createRepo('rebase-literal-unicode-')
    repo.write('café.txt', 'unicode base\n')
    repo.git('add', '.')
    repo.git('commit', '-m', 'base')
    await runOp(openRepo(repo.dir))
  })

  afterAll(async () => {
    await runOp(closeRepo(repo.dir))
    destroyRepo(repo)
  })

  beforeEach(() => {
    resetRepo(repo)
  })

  it('stageFile stages a unicode-named file', async () => {
    repo.write('café.txt', 'unicode changed\n')
    const result = await rpcStageFile({ repoPath: repo.dir, file: 'café.txt' })
    expect(Either.isRight(result)).toBe(true)
    expect(stagedNames(repo)).toContain('café.txt')
  })
})

describe('amend drops use literal pathspecs', () => {
  let repo: TestRepo

  beforeAll(async () => {
    repo = createRepo('rebase-literal-amend-')
    repo.write('*.txt', 'star base\n')
    repo.write('other.txt', 'other base\n')
    repo.git('add', '.')
    repo.git('commit', '-m', 'base')
    repo.write('*.txt', 'star changed\n')
    repo.write('other.txt', 'other changed\n')
    repo.git('add', '.')
    repo.git('commit', '-m', 'change both')
    await runOp(openRepo(repo.dir))
  })

  afterAll(async () => {
    await runOp(closeRepo(repo.dir))
    destroyRepo(repo)
  })

  it('dropping the file literally named *.txt keeps sibling .txt changes committed', async () => {
    await runOp(
      amendCommit(repo.dir, 'change both', ['*.txt'], [], repo.git('rev-parse', 'HEAD').trim())
    )
    expect(repo.git('show', 'HEAD:other.txt')).toBe('other changed\n')
    expect(repo.git('show', 'HEAD:*.txt')).toBe('star base\n')
    expect(repo.read('*.txt')).toBe('star changed\n')
    expect(unstagedNames(repo)).toEqual(['*.txt'])
  })
})

describe('derived checkout short names cannot inject options', () => {
  let repo: TestRepo

  beforeAll(async () => {
    repo = createRepo('rebase-literal-checkout-')
    repo.write('file.txt', 'base\n')
    repo.git('add', '.')
    repo.git('commit', '-m', 'base')
    const headSha = repo.git('rev-parse', 'HEAD').trim()
    fs.mkdirSync(path.join(repo.dir, '.git', 'refs', 'remotes', 'origin'), { recursive: true })
    fs.writeFileSync(path.join(repo.dir, '.git', 'refs', 'remotes', 'origin', '-b'), `${headSha}\n`)
    await runOp(openRepo(repo.dir))
  })

  afterAll(async () => {
    await runOp(closeRepo(repo.dir))
    destroyRepo(repo)
  })

  it('rejects a remote branch whose derived local name starts with a dash', async () => {
    const result = await runOp(Effect.either(checkoutRef(repo.dir, 'remote', 'origin/-b')))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
      expect((result.left as GitError).message).toBe('invalid ref name')
    }
  })
})
