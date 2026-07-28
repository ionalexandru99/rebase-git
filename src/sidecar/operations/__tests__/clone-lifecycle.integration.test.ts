import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Effect, Exit, Fiber, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitError } from '../../git/errors'
import { cloneRepo, destinationClaimKey } from '../clone'

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

  // On a case-insensitive filesystem this is the same contest as above wearing a different hat; on
  // Linux the two really are different directories and both are allowed to proceed.
  it('treats a differently-cased destination the way the filesystem does', async () => {
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

    if (destinationClaimKey('a') === destinationClaimKey('A')) {
      expect(failureOf(second).message).toBe('casedrepo is already being cloned')
    } else {
      expect(Exit.isSuccess(second)).toBe(true)
    }

    await Effect.runPromise(Fiber.interrupt(first))
    fs.rmSync(path.join(destination, 'casedrepo'), { recursive: true, force: true })
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

// Two tabs asking for `Repo` and `repo` name one directory on Windows and macOS and two on Linux,
// so the key the claim is stored under has to follow the filesystem rather than the string.
describe('destination claim keys', () => {
  it('folds case where the filesystem does, and keeps it where it does not', () => {
    const target = path.join('/home/user/code', 'Repo')

    expect(destinationClaimKey(target, true)).toBe(destinationClaimKey(target.toLowerCase(), true))
    expect(destinationClaimKey(target, false)).not.toBe(
      destinationClaimKey(target.toLowerCase(), false)
    )
    expect(destinationClaimKey(target, false)).toBe(target)
  })

  it('defaults to the running platform’s filesystem convention', () => {
    const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'
    const key = destinationClaimKey('/home/user/code/Repo')
    expect(key).toBe(caseInsensitive ? '/home/user/code/repo' : '/home/user/code/Repo')
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

    // The destination is claimed for the length of the operation; an interrupt has to release it,
    // or the tab that retries after a reload would be told it is already being cloned.
    const retry = await Effect.runPromiseExit(
      Stream.runDrain(cloneRepo({ ...request, url: fileUrl(sourceRepo) }))
    )
    expect(Exit.isSuccess(retry)).toBe(true)
    expect(fs.existsSync(path.join(destination, 'interrupted', '.git'))).toBe(true)
  })
})
