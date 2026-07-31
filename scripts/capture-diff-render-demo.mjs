import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.join(currentDir, '..', 'out', 'main', 'index.js')

const windowWidth = 1280
const windowHeight = 800

const E2E_CONTROL_KEY = '__REBASE_E2E_CONTROL__'

const beat = (page, ms = 1000) => page.waitForTimeout(ms)

function gitRunner(repo) {
  return (args) => {
    execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'ignore', 'pipe'] })
  }
}

function pinDemoConfig(git) {
  git(['config', 'user.email', 'demo@example.com'])
  git(['config', 'user.name', 'Demo'])
  git(['config', 'commit.gpgsign', 'false'])
  git(['config', 'core.hooksPath', ''])
  git(['config', 'core.autocrlf', 'false'])
}

const write = (repo, file, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), content)
}

const SESSION_V1 = `export interface Session {
  id: string
  userId: string
  createdAt: number
}

export const SESSION_TTL_MINUTES = 60

export function isExpired(session: Session, nowMs: number): boolean {
  const ageMinutes = (nowMs - session.createdAt) / 60_000
  return ageMinutes > SESSION_TTL_MINUTES
}

export function describeSession(session: Session): string {
  return \`session \${session.id} for user \${session.userId}\`
}
`

const SESSION_V2 = `export interface Session {
  id: string
  userId: string
  deviceId: string
  createdAt: number
  lastSeenAt: number
}

export const SESSION_TTL_MINUTES = 30
export const SESSION_IDLE_MINUTES = 10

export function isExpired(session: Session, nowMs: number): boolean {
  const ageMinutes = (nowMs - session.createdAt) / 60_000
  const idleMinutes = (nowMs - session.lastSeenAt) / 60_000
  return ageMinutes > SESSION_TTL_MINUTES || idleMinutes > SESSION_IDLE_MINUTES
}

export function describeSession(session: Session): string {
  return \`session \${session.id} for user \${session.userId} on \${session.deviceId}\`
}
`

const LIMITS_V1 = `export const MAX_SESSIONS_PER_USER = 5
export const MAX_DEVICES_PER_USER = 3
`

const LIMITS_V2 = `export const MAX_SESSIONS_PER_USER = 25
export const MAX_DEVICES_PER_USER = 3
export const MAX_TOKENS_PER_SESSION = 12
`

function bigModule(revision) {
  const lines = ['export const registry = new Map<string, () => number>()', '']
  for (let index = 0; index < 400; index++) {
    const value = revision === 1 ? index : index % 7 === 0 ? index * 2 : index
    lines.push(`registry.set('entry-${index}', () => ${value})`)
    if (index % 40 === 0) {
      lines.push('')
    }
  }
  return `${lines.join('\n')}\n`
}

function makeDemoRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-diff-demo-'))
  const git = gitRunner(repo)
  git(['init', '-b', 'main'])
  pinDemoConfig(git)

  write(repo, 'README.md', '# session-service\n\nIssues session tokens for the web client.\n')
  write(repo, 'src/session.ts', SESSION_V1)
  write(repo, 'src/limits.ts', LIMITS_V1)
  write(repo, 'src/registry.ts', bigModule(1))
  git(['add', '.'])
  git(['commit', '-m', 'Add session service scaffolding'])

  write(repo, 'src/session.ts', SESSION_V2)
  write(repo, 'src/limits.ts', LIMITS_V2)
  write(repo, 'src/telemetry.ts', 'export const EVENTS = ["login", "logout", "refresh"]\n')
  fs.rmSync(path.join(repo, 'README.md'))
  git(['add', '-A'])
  git(['commit', '-m', 'Track per-device sessions with idle expiry'])

  write(repo, 'src/registry.ts', bigModule(2))
  git(['add', '-A'])
  git(['commit', '-m', 'Double the warm cache entries in the registry'])

  return repo
}

async function launchApp(userDataDir, videoDir) {
  const env = { ...process.env, NODE_ENV: 'test' }
  delete env.ELECTRON_RUN_AS_NODE
  if (process.platform === 'linux') {
    env.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
  }
  const app = await electron.launch({
    args: [
      mainEntry,
      `--user-data-dir=${userDataDir}`,
      '--e2e',
      ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : [])
    ],
    env,
    ...(videoDir
      ? { recordVideo: { dir: videoDir, size: { width: windowWidth, height: windowHeight } } }
      : {})
  })
  const page = await app.firstWindow()
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
    },
    { width: windowWidth, height: windowHeight }
  )
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

async function applyStore(app, page, repo) {
  await app.evaluate(
    (_, input) => {
      globalThis[input.key].replaceStore(input.overrides)
    },
    {
      key: E2E_CONTROL_KEY,
      overrides: {
        workspaces: [path.dirname(repo)],
        recentRepos: [],
        activeWorkspace: path.dirname(repo),
        workingDirectory: path.dirname(repo),
        onboardingComplete: true,
        persistedTabRepoPaths: [repo],
        persistedActiveTabIndex: 0
      }
    }
  )
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

async function openCommit(page, subject) {
  const row = page.locator('[data-testid="commit-row"]').filter({ hasText: subject })
  await row.first().waitFor({ timeout: 30_000 })
  await row.first().dblclick()
  await page.getByTestId('commit-details-panel').waitFor({ timeout: 30_000 })
  await beat(page, 800)
}

async function diffSurface(page) {
  const surface = page.getByTestId('diff-body')
  await surface.waitFor({ timeout: 30_000 })
  return surface
}

async function scrollDiff(page, steps, delta = 600, pause = 350) {
  const surface = await diffSurface(page)
  const box = await surface.boundingBox()
  if (!box) {
    return
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let index = 0; index < steps; index++) {
    await page.mouse.wheel(0, delta)
    await beat(page, pause)
  }
}

async function clickIfPresent(locator, pause, page) {
  if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
    await locator.first().click()
    await beat(page, pause)
    return true
  }
  return false
}

async function main() {
  const outputDir = process.argv[2]
  const label = process.argv[3] ?? 'capture'
  if (!outputDir) {
    console.error('usage: node scripts/capture-diff-render-demo.mjs <output-dir> [label]')
    process.exit(1)
  }
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })

  const repo = makeDemoRepo()
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-user-data-'))
  const shot = (page, name) =>
    page.screenshot({ path: path.join(outputDir, `${label}-${name}.png`) })

  let app
  let page
  try {
    ;({ app, page } = await launchApp(userDataDir, outputDir))

    await applyStore(app, page, repo)
    await openCommit(page, 'Track per-device sessions')
    await beat(page, 1500)
    await shot(page, 'overview')
    await scrollDiff(page, 4)
    await beat(page, 800)

    const splitToggle = page.getByRole('button', { name: /^split$/i })
    if (await clickIfPresent(splitToggle, 1600, page)) {
      await shot(page, 'split')
      await scrollDiff(page, 2)
      await clickIfPresent(page.getByRole('button', { name: /^unified$/i }), 1200, page)
    }

    await openCommit(page, 'Double the warm cache entries')
    await beat(page, 1200)
    await shot(page, 'large-diff')
    await scrollDiff(page, 8, 900, 220)
    await beat(page, 1500)
  } finally {
    const video = page && !page.isClosed() ? page.video() : null
    await page?.close().catch(() => {})
    await app?.close().catch(() => {})
    if (video) {
      await video.saveAs(path.join(outputDir, `${label}.webm`)).catch(() => {})
      await video.delete().catch(() => {})
    }
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(repo, { recursive: true, force: true })
  }
  console.log(`captured → ${outputDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
