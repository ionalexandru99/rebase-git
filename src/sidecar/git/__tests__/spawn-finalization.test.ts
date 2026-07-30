import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHangingGit,
  type HangingGit,
  killIfAlive,
  processAlive,
  waitUntil
} from '../../test-support/hanging-git'
import { TrackedChildren, TrackedChildrenLive } from '../spawn'

interface ChildSpec {
  args: string[]
  env: NodeJS.ProcessEnv
  repoPath: string
}

interface StartedReport {
  gitPids: number[]
}

interface FinalizeReport {
  gitPids: number[]
  aliveBeforeFinalize: number[]
  aliveAfterFinalize: number[]
}

const spawnModule = pathToFileURL(path.resolve('src/sidecar/git/spawn.ts')).href

const runnerSource = `import { spawn } from 'node:child_process'
import fs from 'node:fs'
import {
  finalizeTrackedChildren,
  installTrackedChildShutdownHooks,
  registerRepoChild,
  runWithRequestChildren,
  startGit
} from ${JSON.stringify(spawnModule)}

const [mode, configPath] = process.argv.slice(2)
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const waitForParent = async () => {
  const deadline = Date.now() + 30_000
  while (!fs.existsSync(config.goPath)) {
    if (Date.now() > deadline) {
      throw new Error('parent handshake timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

if (mode === 'finalize') {
  const [requestSpec, repoSpec] = config.children
  let release
  const released = new Promise((resolve) => {
    release = resolve
  })
  let requestChild
  const request = runWithRequestChildren(new AbortController().signal, async () => {
    const running = startGit(requestSpec.args, { collectStdout: false, env: requestSpec.env })
    running.result.catch(() => {})
    requestChild = running.child
    await released
  })
  const repoChild = spawn('git', repoSpec.args, {
    detached: process.platform !== 'win32',
    env: repoSpec.env,
    stdio: 'ignore'
  })
  registerRepoChild(repoSpec.repoPath, repoChild)
  await waitForParent()

  const gitPids = [requestChild.pid, repoChild.pid]
  const aliveBeforeFinalize = gitPids.filter(alive)
  const finalized = finalizeTrackedChildren()
  release()
  await Promise.all([request, finalized])
  fs.writeFileSync(
    config.reportPath,
    JSON.stringify({ gitPids, aliveBeforeFinalize, aliveAfterFinalize: gitPids.filter(alive) })
  )
} else {
  installTrackedChildShutdownHooks()
  const [spec] = config.children
  const running = startGit(spec.args, { collectStdout: false, env: spec.env })
  running.result.catch(() => {})
  fs.writeFileSync(config.startedPath, JSON.stringify({ gitPids: [running.child.pid] }))
  await waitForParent()
  setTimeout(() => {
    throw new Error('unexpected sidecar failure')
  }, 0)
}
`

let tempDir: string
let runnerPath: string
let configPath: string
let startedPath: string
let goPath: string
let reportPath: string
let fakes: HangingGit[]
let runners: ChildProcess[]
let strayPids: (number | undefined)[]

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-spawn-finalization-'))
  runnerPath = path.join(tempDir, 'runner.mjs')
  configPath = path.join(tempDir, 'config.json')
  startedPath = path.join(tempDir, 'started.json')
  goPath = path.join(tempDir, 'go')
  reportPath = path.join(tempDir, 'report.json')
  fakes = []
  runners = []
  strayPids = []
  fs.writeFileSync(runnerPath, runnerSource)
})

afterEach(() => {
  for (const runner of runners) {
    killIfAlive(runner.pid)
  }
  for (const pid of strayPids) {
    killIfAlive(pid)
  }
  for (const fake of fakes) {
    killIfAlive(fake.childPid())
    fake.cleanup()
  }
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('sidecar child finalization', () => {
  it('awaits every tracked process group before finalization completes', async () => {
    const requestGit = newHangingGit('rebase-finalize-request-')
    const repoGit = newHangingGit('rebase-finalize-repo-')
    writeConfig([specOf(requestGit), specOf(repoGit)])

    const runner = startRunner('finalize')
    await waitUntil(
      () => requestGit.childPid() !== undefined && repoGit.childPid() !== undefined,
      10_000,
      'hanging git descendants'
    )
    const descendants = [requestGit.childPid(), repoGit.childPid()]
    strayPids.push(...descendants)
    fs.writeFileSync(goPath, '')
    const exitCode = await exitOf(runner)

    expect(exitCode).toBe(0)
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as FinalizeReport
    strayPids.push(...report.gitPids)
    expect(report.gitPids).toHaveLength(2)
    expect(report.aliveBeforeFinalize).toEqual(report.gitPids)
    expect(report.aliveAfterFinalize).toEqual([])
    for (const descendant of descendants) {
      await waitUntil(() => !processAlive(descendant), 10_000, 'tracked descendant exit')
    }
  }, 30_000)

  it('best-effort kills every tracked process group when the sidecar dies unexpectedly', async () => {
    const fake = newHangingGit('rebase-crash-')
    writeConfig([specOf(fake)])

    const runner = startRunner('crash')
    await waitUntil(() => fs.existsSync(startedPath), 10_000, 'runner start')
    const { gitPids } = JSON.parse(fs.readFileSync(startedPath, 'utf8')) as StartedReport
    strayPids.push(...gitPids)
    await waitUntil(() => fake.childPid() !== undefined, 10_000, 'hanging git descendant')
    const descendantPid = fake.childPid()
    strayPids.push(descendantPid)
    const aliveBeforeCrash = processAlive(gitPids[0])
    fs.writeFileSync(goPath, '')
    const exitCode = await exitOf(runner)

    expect(aliveBeforeCrash).toBe(true)
    expect(exitCode).not.toBe(0)
    expect(gitPids).toHaveLength(1)
    await waitUntil(() => !processAlive(gitPids[0]), 10_000, 'tracked git exit')
    await waitUntil(() => !processAlive(descendantPid), 10_000, 'tracked descendant exit')
  }, 30_000)

  it('closes the process child registry scope through its public finalizer', async () => {
    const fake = newHangingGit('rebase-scope-')
    const runtime = ManagedRuntime.make(TrackedChildrenLive)
    const registry = await runtime.runPromise(TrackedChildren)
    const child = spawn('git', fake.args, {
      detached: process.platform !== 'win32',
      env: fake.env,
      stdio: 'ignore'
    })
    strayPids.push(child.pid)
    registry.trackChild(child)
    await waitUntil(() => fake.childPid() !== undefined, 10_000, 'hanging git descendant')
    const descendant = fake.childPid()
    const aliveBeforeDispose = processAlive(child.pid) && processAlive(descendant)

    await runtime.dispose()

    expect(aliveBeforeDispose).toBe(true)
    expect(processAlive(child.pid)).toBe(false)
    await waitUntil(() => !processAlive(descendant), 10_000, 'tracked descendant exit')
  }, 30_000)
})

function newHangingGit(prefix: string): HangingGit {
  const fake = createHangingGit(prefix)
  fakes.push(fake)
  return fake
}

function startRunner(mode: 'finalize' | 'crash'): ChildProcess {
  const runner = spawn(process.execPath, [runnerPath, mode, configPath], { stdio: 'ignore' })
  runners.push(runner)
  return runner
}

function specOf(fake: HangingGit): ChildSpec {
  return { args: fake.args, env: fake.env, repoPath: fake.repoDir }
}

function writeConfig(children: ChildSpec[]): void {
  fs.writeFileSync(configPath, JSON.stringify({ children, startedPath, goPath, reportPath }))
}

function exitOf(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.once('close', (code) => resolve(code)))
}
