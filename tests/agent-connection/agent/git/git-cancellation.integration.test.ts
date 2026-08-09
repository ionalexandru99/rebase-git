import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect, Fiber } from 'effect4'
import { describe, expect, it } from 'vitest'
import { discoverGit } from '../../../../src/agent/features/agent-connection/git/discover-git'
import { terminateProcessTree } from '../../../../src/agent/features/agent-connection/git/process-tree'

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      await readFile(filePath)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

async function waitForProcessExit(processId: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      process.kill(processId, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Process ${processId} remained alive`)
}

describe('Agent Git process ownership', () => {
  it.runIf(process.platform !== 'win32')(
    'escalates interrupted discovery from TERM to KILL and reaps the child',
    async () => {
      const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'rebase-agent-git-'))
      const executable = path.join(fixtureDirectory, 'git')
      const pidFile = path.join(fixtureDirectory, 'pid')
      const signalFile = path.join(fixtureDirectory, 'signal')
      const originalPath = process.env.PATH
      const originalPidFile = process.env.REBASE_AGENT_GIT_PID_FILE
      const originalSignalFile = process.env.REBASE_AGENT_GIT_SIGNAL_FILE

      try {
        await writeFile(
          executable,
          [
            '#!/bin/sh',
            'echo $$ > "$REBASE_AGENT_GIT_PID_FILE"',
            "trap 'echo TERM >> \"$REBASE_AGENT_GIT_SIGNAL_FILE\"' TERM",
            'while true',
            'do',
            '  sleep 1',
            'done'
          ].join('\n')
        )
        await chmod(executable, 0o755)
        process.env.PATH = `${fixtureDirectory}:${originalPath ?? ''}`
        process.env.REBASE_AGENT_GIT_PID_FILE = pidFile
        process.env.REBASE_AGENT_GIT_SIGNAL_FILE = signalFile

        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const discovery = yield* discoverGit(50).pipe(Effect.forkScoped)
              yield* Effect.promise(() => waitForFile(pidFile))
              yield* Fiber.interrupt(discovery)
            })
          )
        )

        const childPid = Number((await readFile(pidFile, 'utf8')).trim())
        expect(await readFile(signalFile, 'utf8')).toContain('TERM')
        await waitForProcessExit(childPid)
      } finally {
        for (const [name, value] of [
          ['PATH', originalPath],
          ['REBASE_AGENT_GIT_PID_FILE', originalPidFile],
          ['REBASE_AGENT_GIT_SIGNAL_FILE', originalSignalFile]
        ] as const) {
          if (value === undefined) {
            delete process.env[name]
          } else {
            process.env[name] = value
          }
        }
        await rm(fixtureDirectory, { recursive: true, force: true })
      }
    }
  )

  it.runIf(process.platform !== 'win32')(
    'kills a TERM-resistant descendant after the detached group leader exits',
    async () => {
      const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'rebase-agent-tree-'))
      const executable = path.join(fixtureDirectory, 'leader')
      const pidFile = path.join(fixtureDirectory, 'pids')
      await writeFile(
        executable,
        [
          '#!/bin/sh',
          '"$REBASE_NODE_BINARY" -e \'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)\' &',
          'descendant=$!',
          'echo "$$ $descendant" > "$REBASE_AGENT_TREE_PID_FILE"',
          "trap 'exit 0' TERM",
          'wait "$descendant"'
        ].join('\n')
      )
      await chmod(executable, 0o755)
      const target = spawn(executable, [], {
        detached: true,
        env: {
          ...process.env,
          REBASE_AGENT_TREE_PID_FILE: pidFile,
          REBASE_NODE_BINARY: process.execPath
        },
        stdio: 'ignore'
      })

      try {
        await waitForFile(pidFile)
        const [leaderPid, descendantPid] = (await readFile(pidFile, 'utf8'))
          .trim()
          .split(' ')
          .map(Number)
        await Effect.runPromise(terminateProcessTree(target, 50))
        await waitForProcessExit(leaderPid)
        await waitForProcessExit(descendantPid)
      } finally {
        if (target.pid) {
          try {
            process.kill(-target.pid, 'SIGKILL')
          } catch {}
        }
        await rm(fixtureDirectory, { recursive: true, force: true })
      }
    }
  )

  it.runIf(process.platform === 'win32')(
    'terminates and reaps a Windows process with its descendant',
    async () => {
      const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'rebase-agent-tree-'))
      const pidFile = path.join(fixtureDirectory, 'pids')
      const target = spawn(
        process.execPath,
        [
          '-e',
          [
            "const { spawn } = require('node:child_process')",
            "const { writeFileSync } = require('node:fs')",
            "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
            `writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]))`,
            'setInterval(() => {}, 1000)'
          ].join(';')
        ],
        { stdio: 'ignore', windowsHide: true }
      )

      try {
        await waitForFile(pidFile)
        const processIds = JSON.parse(await readFile(pidFile, 'utf8')) as number[]
        await Effect.runPromise(terminateProcessTree(target, 50))
        for (const processId of processIds) {
          await waitForProcessExit(processId)
        }
      } finally {
        if (target.exitCode === null && target.signalCode === null) {
          target.kill('SIGKILL')
        }
        await rm(fixtureDirectory, { recursive: true, force: true })
      }
    }
  )
})
