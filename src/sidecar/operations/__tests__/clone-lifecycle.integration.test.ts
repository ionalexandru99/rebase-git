import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Effect, Exit, Fiber, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitError } from '../../git/errors'
import { cloneRepo, destinationClaimKey, forceRemove, promoteClone } from '../clone'

let homeRoot: string
let sourceRepo: string
let destination: string
let stalledServer: net.Server
let stalledPort: number

const fileUrl = (repoPath: string): string => `file://${repoPath.split(path.sep).join('/')}`

async function startCloneInBackground(request: {
  url: string
  parentDir: string
  folderName: string
}) {
  let markStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const fiber = Effect.runFork(
    Stream.runForEach(cloneRepo(request), () => Effect.sync(() => markStarted())).pipe(
      Effect.ignore
    )
  )
  await started
  return fiber
}

const failureOf = (exit: Exit.Exit<unknown, unknown>): GitError => {
  const cause = exit._tag === 'Failure' ? exit.cause : undefined
  const error = cause?._tag === 'Fail' ? cause.error : undefined
  if (!(error instanceof GitError)) {
    throw new Error(`expected a GitError, got ${JSON.stringify(exit)}`)
  }
  return error
}

beforeAll(async () => {
  homeRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.homedir(), '.rebase-clone-life-')))
  sourceRepo = path.join(homeRoot, 'source')
  destination = path.join(homeRoot, 'destination')
  fs.mkdirSync(sourceRepo)
  fs.mkdirSync(destination)
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', sourceRepo, ...args], { stdio: 'ignore' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('commit', '--allow-empty', '-m', 'initial')

  stalledServer = net.createServer((socket) => {
    socket.on('data', () => {})
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve, reject) => {
    stalledServer.once('error', reject)
    stalledServer.listen(0, '127.0.0.1', () => {
      stalledServer.off('error', reject)
      stalledServer.on('error', () => {})
      resolve()
    })
  })
  stalledPort = (stalledServer.address() as net.AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => stalledServer.close(() => resolve()))
  fs.rmSync(homeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('two clones aimed at one destination', () => {
  it('turns the second one away instead of letting it delete the first one’s work', async () => {
    const request = {
      url: `git://127.0.0.1:${stalledPort}/stalled.git`,
      parentDir: destination,
      folderName: 'contested'
    }

    const first = await startCloneInBackground(request)

    const second = await Effect.runPromiseExit(
      Stream.runDrain(cloneRepo({ ...request, url: fileUrl(sourceRepo), folderName: 'contested' }))
    )
    expect(failureOf(second).message).toBe('contested is already being cloned')

    await Effect.runPromise(Fiber.interrupt(first))
  })

  it('turns away a destination that differs only in case', async () => {
    const first = await startCloneInBackground({
      url: `git://127.0.0.1:${stalledPort}/stalled.git`,
      parentDir: destination,
      folderName: 'CasedRepo'
    })

    const second = await Effect.runPromiseExit(
      Stream.runDrain(
        cloneRepo({
          url: fileUrl(sourceRepo),
          parentDir: destination,
          folderName: 'casedrepo'
        })
      )
    )

    expect(failureOf(second).message).toBe('casedrepo is already being cloned')

    await Effect.runPromise(Fiber.interrupt(first))
  })

  it('frees the destination again once the first clone is over', async () => {
    const request = {
      url: fileUrl(sourceRepo),
      parentDir: destination,
      folderName: 'released'
    }
    await Effect.runPromise(Stream.runDrain(cloneRepo(request)))
    fs.rmSync(path.join(destination, 'released'), { recursive: true, force: true })

    const second = await Effect.runPromiseExit(Stream.runDrain(cloneRepo(request)))
    expect(Exit.isSuccess(second)).toBe(true)
    expect(fs.existsSync(path.join(destination, 'released', '.git'))).toBe(true)
  })
})

describe('destination claim keys', () => {
  it('gives one key to every spelling of the same directory', () => {
    const target = path.join('/home/user/code', 'Repo')
    expect(destinationClaimKey(target)).toBe(destinationClaimKey(target.toLowerCase()))

    const composed = '/home/user/code/caf\u00e9'
    const decomposed = '/home/user/code/cafe\u0301'
    expect(composed).not.toBe(decomposed)
    expect(destinationClaimKey(composed)).toBe(destinationClaimKey(decomposed))
  })

  it('folds the trailing dots and spaces Win32 ignores', () => {
    expect(destinationClaimKey('/home/user/code/repo.')).toBe(
      destinationClaimKey('/home/user/code/repo')
    )
    expect(destinationClaimKey('/home/user/code/repo .')).toBe(
      destinationClaimKey('/home/user/code/repo')
    )
  })

  it('still tells genuinely different destinations apart', () => {
    expect(destinationClaimKey('/home/user/code/one')).not.toBe(
      destinationClaimKey('/home/user/code/two')
    )
  })
})

describe('an empty directory on the destination', () => {
  it('is cloned into rather than refused', async () => {
    const folderName = 'left-empty'
    fs.mkdirSync(path.join(destination, folderName))

    const exit = await Effect.runPromiseExit(
      Stream.runDrain(cloneRepo({ url: fileUrl(sourceRepo), parentDir: destination, folderName }))
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(fs.existsSync(path.join(destination, folderName, '.git'))).toBe(true)
  })

  it('is given back rather than deleted when the clone fails', async () => {
    const folderName = 'borrowed'
    const borrowed = path.join(destination, folderName)
    fs.mkdirSync(borrowed)

    const exit = await Effect.runPromiseExit(
      Stream.runDrain(
        cloneRepo({
          url: fileUrl(path.join(homeRoot, 'not-a-repo')),
          parentDir: destination,
          folderName
        })
      )
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(fs.existsSync(borrowed)).toBe(true)
    expect(fs.readdirSync(borrowed)).toEqual([])
  })

  it('is still refused once it holds anything at all', async () => {
    const folderName = 'not-empty'
    fs.mkdirSync(path.join(destination, folderName))
    fs.writeFileSync(path.join(destination, folderName, 'notes.txt'), 'mine\n')

    const exit = await Effect.runPromiseExit(
      Stream.runDrain(cloneRepo({ url: fileUrl(sourceRepo), parentDir: destination, folderName }))
    )

    expect(failureOf(exit).message).toBe('not-empty already exists in that folder')
    expect(fs.readFileSync(path.join(destination, folderName, 'notes.txt'), 'utf8')).toBe('mine\n')
  })
})

describe('clearing what a dead clone left in staging', () => {
  const partial = (name: string): string => path.join(destination, name)

  it('removes the read-only files git leaves in a pack directory', async () => {
    const packDirectory = path.join(partial('read-only'), '.git', 'objects', 'pack')
    fs.mkdirSync(packDirectory, { recursive: true })
    const pack = path.join(packDirectory, 'pack-abc.pack')
    fs.writeFileSync(pack, 'pack\n')
    fs.chmodSync(pack, 0o444)

    await forceRemove(partial('read-only'))

    expect(fs.existsSync(partial('read-only'))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'does not follow a symlink out of the clone while clearing read-only bits',
    async () => {
      const outside = path.join(destination, 'outside-target.txt')
      fs.writeFileSync(outside, 'precious\n')
      fs.chmodSync(outside, 0o444)

      const lockedDirectory = path.join(partial('linked'), 'locked')
      fs.mkdirSync(lockedDirectory, { recursive: true })
      fs.symlinkSync(outside, path.join(lockedDirectory, 'escape'))
      fs.chmodSync(lockedDirectory, 0o500)

      try {
        await forceRemove(partial('linked'))
      } finally {
        fs.chmodSync(outside, 0o600)
      }

      expect(fs.existsSync(partial('linked'))).toBe(false)
      expect(fs.existsSync(outside)).toBe(true)
      fs.rmSync(outside, { force: true })
    }
  )
})

describe('what a crashed sidecar left behind', () => {
  it('is swept by the next clone of the same folder', async () => {
    const orphan = path.join(destination, '.crashy.rebase-clone-dead00ab')
    fs.mkdirSync(path.join(orphan, '.git'), { recursive: true })
    fs.writeFileSync(path.join(orphan, 'README.md'), 'half-written\n')
    const nearMiss = path.join(destination, '.crashy.rebase-clone-backup')
    fs.mkdirSync(nearMiss)
    fs.writeFileSync(path.join(nearMiss, 'notes.txt'), 'mine\n')

    const exit = await Effect.runPromiseExit(
      Stream.runDrain(
        cloneRepo({ url: fileUrl(sourceRepo), parentDir: destination, folderName: 'crashy' })
      )
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(fs.existsSync(path.join(destination, 'crashy', '.git'))).toBe(true)
    await expect.poll(() => fs.existsSync(orphan), { timeout: 10_000, interval: 250 }).toBe(false)
    expect(fs.readFileSync(path.join(nearMiss, 'notes.txt'), 'utf8')).toBe('mine\n')
    fs.rmSync(nearMiss, { recursive: true, force: true })
  })
})

describe('a promotion that cannot land', () => {
  it('gives a borrowed empty destination back', { timeout: 15_000 }, async () => {
    const borrowed = path.join(destination, 'borrowed-back')
    fs.mkdirSync(borrowed)

    await expect(
      promoteClone(path.join(destination, '.borrowed-back.rebase-clone-00000000'), borrowed)
    ).rejects.toThrow()

    expect(fs.existsSync(borrowed)).toBe(true)
    expect(fs.readdirSync(borrowed)).toEqual([])
  })
})

describe('interrupting a clone in flight', () => {
  it('kills git, removes the partial folder, and frees the destination', async () => {
    const request = {
      url: `git://127.0.0.1:${stalledPort}/stalled.git`,
      parentDir: destination,
      folderName: 'interrupted'
    }

    const fiber = await startCloneInBackground(request)
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(fs.existsSync(path.join(destination, 'interrupted'))).toBe(false)
    await expect
      .poll(
        () =>
          fs.readdirSync(destination).filter((entry) => entry.startsWith('.interrupted.')).length,
        { timeout: 10_000, interval: 250 }
      )
      .toBe(0)

    const retry = await Effect.runPromiseExit(
      Stream.runDrain(cloneRepo({ ...request, url: fileUrl(sourceRepo) }))
    )
    expect(Exit.isSuccess(retry)).toBe(true)
    expect(fs.existsSync(path.join(destination, 'interrupted', '.git'))).toBe(true)
  })
})
