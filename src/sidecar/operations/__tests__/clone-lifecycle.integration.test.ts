import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Effect, Exit, Fiber, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitError } from '../../git/errors'
import { cloneRepo, destinationClaimKey, forceRemove } from '../clone'

let homeRoot: string
let sourceRepo: string
let destination: string
// A server that accepts the connection and then answers nothing: git sits in the protocol
// handshake for as long as the test needs, without a network or a second git installation.
let stalledServer: net.Server
let stalledPort: number

const fileUrl = (repoPath: string): string => `file://${repoPath.split(path.sep).join('/')}`

// Runs a clone in the background and resolves once it has emitted its first chunk, which is the
// point where it has validated the request and taken the destination.
async function startCloneInBackground(request: {
  url: string
  parentDir: string
  folderName: string
}) {
  let markStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  // runFork, not Effect.fork: a child fiber would be interrupted the moment the parent effect that
  // spawned it completes, and the clone would never get off the ground.
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
    // Killing git resets the connection rather than closing it on Windows, and an unhandled
    // ECONNRESET here would fail the run even though every assertion passed.
    socket.on('error', () => {})
  })
  stalledServer.on('error', () => {})
  await new Promise<void>((resolve) => stalledServer.listen(0, '127.0.0.1', resolve))
  stalledPort = (stalledServer.address() as net.AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => stalledServer.close(() => resolve()))
  fs.rmSync(homeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('two clones aimed at one destination', () => {
  // Neither `existsSync` nor git itself can see a clone that has not written anything yet, so the
  // loser has to be turned away before it spawns — otherwise its cleanup deletes the winner's work.
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

  // The same contest wearing a different spelling. Whether this disk folds case is not knowable
  // without writing to it, so the claim folds it everywhere: better a needless wait on a
  // case-sensitive disk than one clone deleting the other's work on a folding one.
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

// One directory answers to several spellings: `Repo` and `repo` wherever the filesystem folds case,
// and NFC/NFD spellings of the same accented name on macOS. Which aliases a disk honours cannot be
// known without writing to it, so the key folds them everywhere rather than guessing by platform.
describe('destination claim keys', () => {
  it('gives one key to every spelling of the same directory', () => {
    const target = path.join('/home/user/code', 'Repo')
    expect(destinationClaimKey(target)).toBe(destinationClaimKey(target.toLowerCase()))

    const composed = '/home/user/code/caf\u00e9'
    const decomposed = '/home/user/code/cafe\u0301'
    expect(composed).not.toBe(decomposed)
    expect(destinationClaimKey(composed)).toBe(destinationClaimKey(decomposed))
  })

  it('still tells genuinely different destinations apart', () => {
    expect(destinationClaimKey('/home/user/code/one')).not.toBe(
      destinationClaimKey('/home/user/code/two')
    )
  })
})

// People pre-create the folder they mean to clone into, and git itself is happy to clone into an
// empty directory — refusing one would block the clone on a folder with nothing in it.
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

  // git writes into staging, not into the borrowed directory, so a failed clone leaves it exactly
  // as it found it.
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

  // git writes its objects and packs read-only, which Windows will not unlink: the staging directory
  // stayed behind, and no amount of retrying a permission error was going to change that.
  it('removes the read-only files git leaves in a pack directory', () => {
    const packDirectory = path.join(partial('read-only'), '.git', 'objects', 'pack')
    fs.mkdirSync(packDirectory, { recursive: true })
    const pack = path.join(packDirectory, 'pack-abc.pack')
    fs.writeFileSync(pack, 'pack\n')
    fs.chmodSync(pack, 0o444)

    forceRemove(partial('read-only'))

    expect(fs.existsSync(partial('read-only'))).toBe(false)
  })

  // chmod follows symlinks, and a hostile repository can check one out pointing anywhere on the
  // machine: clearing the read-only bits must not reach through the link and change the mode of
  // whatever it points at. Windows is skipped because creating symlinks there needs a privilege
  // the runner does not hold.
  it.skipIf(process.platform === 'win32')(
    'does not follow a symlink out of the clone while clearing read-only bits',
    () => {
      const outside = path.join(destination, 'outside-target.txt')
      fs.writeFileSync(outside, 'precious\n')
      fs.chmodSync(outside, 0o444)

      // A read-only subdirectory forces the plain rmSync to fail everywhere, so the clearing pass
      // actually walks the tree and meets the link.
      const lockedDirectory = path.join(partial('linked'), 'locked')
      fs.mkdirSync(lockedDirectory, { recursive: true })
      fs.symlinkSync(outside, path.join(lockedDirectory, 'escape'))
      fs.chmodSync(lockedDirectory, 0o500)

      try {
        forceRemove(partial('linked'))
      } finally {
        fs.chmodSync(outside, 0o600)
      }

      expect(fs.existsSync(partial('linked'))).toBe(false)
      expect(fs.existsSync(outside)).toBe(true)
      fs.rmSync(outside, { force: true })
    }
  )
})

// A sidecar crash mid-clone takes the sweep down with it: nothing in-process survives to remember
// the staging directory git was writing. The next attempt at the same folder has to clear it, or
// the crash leaves litter behind forever — and the destination itself must never be poisoned by a
// crash, which is the point of staging.
describe('what a crashed sidecar left behind', () => {
  it('is swept by the next clone of the same folder', async () => {
    const orphan = path.join(destination, '.crashy.rebase-clone-dead00')
    fs.mkdirSync(path.join(orphan, '.git'), { recursive: true })
    fs.writeFileSync(path.join(orphan, 'README.md'), 'half-written\n')

    const exit = await Effect.runPromiseExit(
      Stream.runDrain(
        cloneRepo({ url: fileUrl(sourceRepo), parentDir: destination, folderName: 'crashy' })
      )
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(fs.existsSync(path.join(destination, 'crashy', '.git'))).toBe(true)
    expect(fs.existsSync(orphan)).toBe(false)
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

    // The destination was never written to — git works in staging — and the detached sweep clears
    // the staging directory once the killed git lets go of it.
    expect(fs.existsSync(path.join(destination, 'interrupted'))).toBe(false)
    await expect
      .poll(
        () =>
          fs.readdirSync(destination).filter((entry) => entry.startsWith('.interrupted.')).length,
        { timeout: 10_000, interval: 250 }
      )
      .toBe(0)

    // The destination is claimed for the length of the operation; an interrupt has to release it,
    // or the tab that retries after a reload would be told it is already being cloned.
    const retry = await Effect.runPromiseExit(
      Stream.runDrain(cloneRepo({ ...request, url: fileUrl(sourceRepo) }))
    )
    expect(Exit.isSuccess(retry)).toBe(true)
    expect(fs.existsSync(path.join(destination, 'interrupted', '.git'))).toBe(true)
  })
})
