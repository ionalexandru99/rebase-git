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

export function describeBucket(bucket: Bucket): string {
  return \`bucket with \${Math.floor(bucket.tokens)} tokens\`
}

export function isEmpty(bucket: Bucket): boolean {
  return bucket.tokens < 1
}
`

const RATE_LIMITER_V2 = `export interface Bucket {
  tokens: number
  updatedAt: number
  burstUntil: number
}

export const BUCKET_SIZE = 25
export const REFILL_PER_SECOND = 2

export function take(bucket: Bucket, nowMs: number): Bucket | null {
  const elapsed = (nowMs - bucket.updatedAt) / 1000
  const tokens = Math.min(BUCKET_SIZE, bucket.tokens + elapsed * REFILL_PER_SECOND)
  if (tokens < 1) {
    return null
  }
  return { tokens: tokens - 1, updatedAt: nowMs, burstUntil: bucket.burstUntil }
}

export function describeBucket(bucket: Bucket): string {
  return \`bucket with \${Math.floor(bucket.tokens)} tokens (burst until \${bucket.burstUntil})\`
}

export function isEmpty(bucket: Bucket): boolean {
  return bucket.tokens < 1
}
`

function makeDemoRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-hunk-demo-'))
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

const diffLine = (page, text) =>
  page.getByTestId('diff-body').locator('[data-line]').filter({ hasText: text }).first()

async function hoverLeft(page, line) {
  const box = await line.boundingBox()
  await line.hover(box ? { position: { x: Math.min(220, box.width / 4), y: box.height / 2 } } : {})
}

async function hoverAndClick(page, lineText, action, pauseBefore = 900) {
  const line = diffLine(page, lineText)
  await line.waitFor({ timeout: 30_000 })
  await hoverLeft(page, line)
  await beat(page, pauseBefore)
  await page.getByRole('button', { name: action, exact: true }).click()
}

async function main() {
  const outputDir = process.argv[2]
  const label = process.argv[3] ?? 'hunk-actions'
  if (!outputDir) {
    console.error('usage: node scripts/capture-hunk-actions-demo.mjs <output-dir> [label]')
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

    await page
      .getByRole('button', { name: 'Local changes', exact: true })
      .filter({ visible: true })
      .click()
    await page
      .getByRole('button', { name: 'src/rate-limiter.ts', exact: true })
      .first()
      .click()
    await beat(page, 1400)

    const stageLine = diffLine(page, 'burstUntil: number')
    await stageLine.waitFor({ timeout: 30_000 })
    await hoverLeft(page, stageLine)
    await beat(page, 1200)
    await shot(page, 'hover-actions')

    await page.getByRole('button', { name: 'Stage hunk', exact: true }).click()
    await beat(page, 1600)
    await shot(page, 'staged-hunk')

    await hoverAndClick(page, 'burst until', 'Discard hunk')
    await beat(page, 900)
    await shot(page, 'discard-confirm')
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click()
    await beat(page, 1800)
    await shot(page, 'after-discard')
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
