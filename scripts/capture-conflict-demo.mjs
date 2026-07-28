// Records a walkthrough of the conflict-resolution flow against the built app in out/.
// Run with `pnpm build` done first: `node scripts/capture-conflict-demo.mjs`.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.join(currentDir, '..', 'out', 'main', 'index.js')

const outputDir = '/tmp/rebase-conflict-demo'
const videoDir = path.join(outputDir, 'video')
const windowWidth = 1280
const windowHeight = 800

const E2E_CONTROL_KEY = '__REBASE_E2E_CONTROL__'

const beat = (page, ms = 1000) => page.waitForTimeout(ms)

const MAIN_APP = `export interface Session {
  id: string
  userId: string
}

// Sessions expire after eight hours of inactivity.
export const SESSION_TTL_MINUTES = 480

export function isExpired(session: Session, ageMinutes: number): boolean {
  return ageMinutes > SESSION_TTL_MINUTES
}
`

const FEATURE_APP = `export interface Session {
  id: string
  userId: string
}

// Sessions expire after thirty minutes of inactivity.
export const SESSION_TTL_MINUTES = 30

export function isExpired(session: Session, ageMinutes: number): boolean {
  return ageMinutes >= SESSION_TTL_MINUTES
}
`

const BASE_APP = `export interface Session {
  id: string
  userId: string
}

export const SESSION_TTL_MINUTES = 60

export function isExpired(session: Session, ageMinutes: number): boolean {
  return ageMinutes > SESSION_TTL_MINUTES
}
`

function createDemoRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-demo-repo-'))
  const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  const appFile = path.join(repo, 'src', 'app.ts')
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'demo@example.com'])
  git(['config', 'user.name', 'Demo'])
  fs.writeFileSync(path.join(repo, 'README.md'), '# session-service\n')
  fs.mkdirSync(path.join(repo, 'src'))
  fs.writeFileSync(appFile, BASE_APP)
  git(['add', '.'])
  git(['commit', '-m', 'Add session expiry helper'])

  git(['checkout', '-b', 'feature'])
  fs.writeFileSync(appFile, FEATURE_APP)
  git(['add', '.'])
  git(['commit', '-m', 'Shorten idle sessions to thirty minutes'])

  git(['checkout', 'main'])
  fs.writeFileSync(appFile, MAIN_APP)
  git(['add', '.'])
  git(['commit', '-m', 'Extend idle sessions to a full working day'])
  return repo
}

async function openRepo(app, page, repo) {
  await app.evaluate((_, input) => {
    globalThis[input.key].replaceStore(input.overrides)
  }, {
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
  })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

const shot = (page, name) => page.screenshot({ path: path.join(outputDir, name) })

async function main() {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(videoDir, { recursive: true })

  const repo = createDemoRepo()
  // The main process only installs its E2E control for a temp dir with this exact prefix.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-user-data-'))

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
    recordVideo: { dir: videoDir, size: { width: windowWidth, height: windowHeight } }
  })

  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
  }, { width: windowWidth, height: windowHeight })
  await page.waitForLoadState('domcontentloaded')

  await openRepo(app, page, repo)
  await page.getByRole('button', { name: 'main current' }).waitFor({ timeout: 20_000 })
  await beat(page, 1400)

  // Merge feature into main from the ref tree, which stops on the conflict.
  await page.getByTestId('ref-tree-scroll').getByTitle('feature', { exact: true }).click({ button: 'right' })
  await beat(page, 1000)
  await page.getByRole('menuitem', { name: /Merge into main/ }).click()
  await beat(page, 1600)

  await page.getByRole('button', { name: 'Local changes', exact: true }).filter({ visible: true }).click()
  await beat(page, 1200)

  const banner = page.getByRole('status').filter({ hasText: 'Merging feature into main' })
  await banner.waitFor({ timeout: 20_000 })
  const conflictRow = page.getByTestId('status-file-row').filter({ hasText: 'app.ts' })
  await conflictRow.waitFor({ timeout: 20_000 })
  await conflictRow.click()
  await beat(page, 1200)
  await shot(page, '01-conflict-banner.png')

  await conflictRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Keep main' }).waitFor({ timeout: 10_000 })
  await beat(page, 1200)
  await shot(page, '02-context-menu.png')

  await page.getByRole('menuitem', { name: 'Keep main' }).click()
  await beat(page, 1600)

  await banner.getByText('All conflicts are resolved').waitFor({ timeout: 20_000 })
  await page.getByText(/the merge is still in progress/).waitFor({ timeout: 20_000 })
  await beat(page, 1400)
  await shot(page, '03-resolved.png')

  await page.getByRole('button', { name: /^Commit/ }).click()
  await beat(page, 2000)

  await page.getByText('Working tree clean').waitFor({ timeout: 20_000 })
  await beat(page, 1200)
  await shot(page, '04-merged.png')

  await page.getByRole('button', { name: 'History', exact: true }).filter({ visible: true }).click()
  await beat(page, 1800)

  const video = page.video()
  await page.close()
  await app.close()
  const videoPath = video ? await video.path() : null

  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(userDataDir, { recursive: true, force: true })

  console.log(`screenshots: ${outputDir}`)
  console.log(`video: ${videoPath ?? '<not recorded>'}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
