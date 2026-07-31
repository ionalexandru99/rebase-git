import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

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

const RATE_LIMITER_V1 = `export interface Bucket {
  tokens: number
  updatedAt: number
}

export const BUCKET_SIZE = 10
export const REFILL_PER_SECOND = 1

export function take(bucket: Bucket, nowMs: number): Bucket | null {
  const elapsed = (nowMs - bucket.updatedAt) / 1000
  const tokens = Math.min(BUCKET_SIZE, bucket.tokens + elapsed * REFILL_PER_SECOND)
  if (tokens < 1) {
    return null
  }
  return { tokens: tokens - 1, updatedAt: nowMs }
}

export function isEmpty(bucket: Bucket): boolean {
  return bucket.tokens < 1
}
`

const RATE_LIMITER_V2 = `export interface Bucket {
  tokens: number
  updatedAt: number
}

export const BUCKET_SIZE = 10
export const REFILL_PER_SECOND = 1
export const BURST_SIZE = 40
export const BURST_WINDOW_MS = 5000

export function take(bucket: Bucket, nowMs: number): Bucket | null {
  const elapsed = (nowMs - bucket.updatedAt) / 1000
  const tokens = Math.min(BUCKET_SIZE, bucket.tokens + elapsed * REFILL_PER_SECOND)
  if (tokens < 1) {
    return null
  }
  return { tokens: tokens - 1, updatedAt: nowMs }
}

export function isEmpty(bucket: Bucket): boolean {
  return bucket.tokens <= 0
}
`

function makeDemoRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-line-stage-demo-'))
  const git = gitRunner(repo)
  git(['init', '-b', 'main'])
  pinDemoConfig(git)

  write(repo, 'README.md', '# rate-limiter\n\nToken buckets for the API edge.\n')
  write(repo, 'src/rate-limiter.ts', RATE_LIMITER_V1)
  git(['add', '.'])
  git(['commit', '-m', 'Add token bucket rate limiter'])

  write(repo, 'src/rate-limiter.ts', RATE_LIMITER_V2)

  return repo
}

async function launchApp(mainEntry, userDataDir, videoDir) {
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

const diffBody = (page) => page.getByTestId('diff-body')

const diffLine = (page, text) =>
  diffBody(page).locator('[data-line]').filter({ hasText: text }).first()

async function gutterCellForLine(page, lineText) {
  const row = diffLine(page, lineText)
  await row.waitFor({ timeout: 30_000 })
  const lineNumber = await row.getAttribute('data-line')
  const cell = diffBody(page).locator(`[data-column-number="${lineNumber}"]`).first()
  await cell.waitFor({ timeout: 10_000 })
  return cell
}

async function dragSelectLines(page, startText, endText) {
  const startCell = await gutterCellForLine(page, startText)
  const endCell = await gutterCellForLine(page, endText)
  const startBox = await startCell.boundingBox()
  const endBox = await endCell.boundingBox()
  if (!startBox || !endBox) {
    throw new Error('gutter cells are not visible')
  }
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2)
  await beat(page, 700)
  await page.mouse.down()
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 14 })
  await beat(page, 500)
  await page.mouse.up()
}

async function openWorktreeFile(page, group) {
  await page
    .getByRole('button', { name: 'Local changes', exact: true })
    .filter({ visible: true })
    .click()
  const row = page.locator(
    `[data-testid="status-file-row"][data-group="${group}"][data-file="src/rate-limiter.ts"]`
  )
  await row.getByRole('button', { name: 'src/rate-limiter.ts', exact: true }).click()
  await beat(page, 1200)
}

async function runAfterFlow(page, shot) {
  await openWorktreeFile(page, 'unstaged')

  await dragSelectLines(page, 'BURST_SIZE = 40', 'BURST_WINDOW_MS = 5000')
  await beat(page, 1200)
  await shot('selection')

  await page.getByRole('button', { name: 'Stage 2 selected lines', exact: true }).click()
  await beat(page, 1800)
  await shot('partially-staged')

  await openWorktreeFile(page, 'staged')
  await dragSelectLines(page, 'BURST_SIZE = 40', 'BURST_SIZE = 40')
  await beat(page, 1200)
  await shot('staged-selection')

  await page.getByRole('button', { name: 'Unstage 1 selected line', exact: true }).click()
  await beat(page, 1800)
  await shot('after-unstage')
}

async function runBeforeFlow(page, shot) {
  await openWorktreeFile(page, 'unstaged')

  await dragSelectLines(page, 'BURST_SIZE = 40', 'BURST_WINDOW_MS = 5000')
  await beat(page, 1500)
  await shot('no-selection')

  const line = diffLine(page, 'BURST_SIZE = 40')
  const box = await line.boundingBox()
  await line.hover(box ? { position: { x: Math.min(220, box.width / 4), y: box.height / 2 } } : {})
  await beat(page, 1500)
  await shot('hover-hunk-actions')
}

async function main() {
  const outputDir = process.argv[2]
  const mode = process.argv[3]
  const mainEntry = process.argv[4] ?? path.join(currentDir, '..', 'out', 'main', 'index.js')
  if (!outputDir || (mode !== 'after' && mode !== 'before')) {
    console.error(
      'usage: node scripts/capture-line-staging-demo.mjs <output-dir> <after|before> [main-entry]'
    )
    process.exit(1)
  }
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })

  const repo = makeDemoRepo()
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-user-data-'))

  let app
  let page
  try {
    ;({ app, page } = await launchApp(mainEntry, userDataDir, outputDir))
    const shot = (name) =>
      page.screenshot({ path: path.join(outputDir, `line-staging-${mode}-${name}.png`) })
    await applyStore(app, page, repo)
    if (mode === 'after') {
      await runAfterFlow(page, shot)
    } else {
      await runBeforeFlow(page, shot)
    }
    await beat(page, 800)
  } finally {
    const video = page && !page.isClosed() ? page.video() : null
    await page?.close().catch(() => {})
    await app?.close().catch(() => {})
    if (video) {
      await video.saveAs(path.join(outputDir, `line-staging-${mode}.webm`)).catch(() => {})
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
