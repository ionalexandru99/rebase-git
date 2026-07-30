import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deriveCloneFolderName } from '@shared/clone-url'
import { Effect, Stream } from 'effect'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cloneRepo } from '../clone'

const describeOnPosix = process.platform === 'win32' ? describe.skip : describe

let homeRoot: string
let sourceRepo: string
let destination: string
let originalSshCommand: string | undefined

beforeAll(() => {
  homeRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.homedir(), '.rebase-clone-ssh-')))
  sourceRepo = path.join(homeRoot, 'over-ssh')
  destination = path.join(homeRoot, 'destination')
  fs.mkdirSync(sourceRepo)
  fs.mkdirSync(destination)
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', sourceRepo, ...args], { stdio: 'ignore' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(sourceRepo, 'README.md'), '# over ssh\n')
  git('add', '.')
  git('commit', '-m', 'initial')

  const stub = path.join(homeRoot, 'ssh-stub.mjs')
  fs.writeFileSync(
    stub,
    [
      "import { spawn } from 'node:child_process'",
      'const command = process.argv[process.argv.length - 1]',
      "const child = spawn(command, { shell: true, stdio: 'inherit' })",
      "child.on('exit', (code) => process.exit(code ?? 1))",
      ''
    ].join('\n')
  )
  originalSshCommand = process.env.GIT_SSH_COMMAND
  process.env.GIT_SSH_COMMAND = `"${process.execPath}" "${stub}"`
})

afterAll(() => {
  if (originalSshCommand === undefined) {
    delete process.env.GIT_SSH_COMMAND
  } else {
    process.env.GIT_SSH_COMMAND = originalSshCommand
  }
  fs.rmSync(homeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

afterEach(() => {
  for (const entry of fs.readdirSync(destination)) {
    fs.rmSync(path.join(destination, entry), { recursive: true, force: true })
  }
})

const cloneOver = (url: string, folderName: string) =>
  Effect.runPromise(
    Stream.runCollect(cloneRepo({ url, parentDir: destination, folderName })).pipe(
      Effect.map((chunks) => [...chunks])
    )
  )

describeOnPosix('cloning over ssh', () => {
  it('clones an ssh:// URL and lands the working tree', async () => {
    const url = `ssh://git@rebase-stub-host${sourceRepo}`
    expect(deriveCloneFolderName(url)).toBe('over-ssh')

    const chunks = await cloneOver(url, 'over-ssh')

    expect(chunks.at(-1)).toMatchObject({ done: true, path: path.join(destination, 'over-ssh') })
    expect(fs.readFileSync(path.join(destination, 'over-ssh', 'README.md'), 'utf8')).toBe(
      '# over ssh\n'
    )
  })

  it('clones the scp-style form GitHub hands out', async () => {
    const url = `git@rebase-stub-host:${sourceRepo}`
    expect(deriveCloneFolderName(url)).toBe('over-ssh')

    const chunks = await cloneOver(url, 'over-ssh')

    expect(chunks.at(-1)).toMatchObject({ done: true, path: path.join(destination, 'over-ssh') })
    expect(fs.existsSync(path.join(destination, 'over-ssh', '.git'))).toBe(true)
  })

  it('honours the caller’s GIT_SSH_COMMAND rather than overriding it', async () => {
    const chunks = await cloneOver(`ssh://git@rebase-stub-host${sourceRepo}`, 'honoured')
    expect(chunks.at(-1)?.done).toBe(true)
  })
})
