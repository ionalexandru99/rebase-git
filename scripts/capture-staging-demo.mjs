// Records the grouped staging lists (Conflicts / Staged / Unstaged) and the single-side diff against
// the built app in out/.
// Run `pnpm build` first, then `node scripts/capture-staging-demo.mjs [scenario|all]`.
// Output: /tmp/rebase-staging-demo/scenarios/<name>/<name>.webm and <name>.png
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.join(currentDir, '..', 'out', 'main', 'index.js')

const outputRoot = path.join(os.tmpdir(), 'rebase-staging-demo', 'scenarios')
const windowWidth = 1280
const windowHeight = 800

const E2E_CONTROL_KEY = '__REBASE_E2E_CONTROL__'

const BASE_APP = `export interface Session {
  id: string
  userId: string
}

export const SESSION_TTL_MINUTES = 60

export function isExpired(session: Session, ageMinutes: number): boolean {
  return ageMinutes > SESSION_TTL_MINUTES
}
`

const STAGED_APP = `export interface Session {
  id: string
  userId: string
  device: string
}

export const SESSION_TTL_MINUTES = 60

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

const BASE_LIMITS = `export const MAX_SESSIONS_PER_USER = 5
export const MAX_DEVICES_PER_USER = 3
export const MAX_TOKENS_PER_SESSION = 4
`

const INDEX_LIMITS = `export const MAX_SESSIONS_PER_USER = 25
export const MAX_DEVICES_PER_USER = 3
export const MAX_TOKENS_PER_SESSION = 4
`

const WORKTREE_LIMITS = `export const MAX_SESSIONS_PER_USER = 25
export const MAX_DEVICES_PER_USER = 3
export const MAX_TOKENS_PER_SESSION = 12
`

const BASE_README = '# session-service\n\nIssues session tokens for the web client.\n'
const LOCAL_README = `${BASE_README}\nTODO: document the expiry policy.\n`
const NOTES = '- sweep expired sessions hourly\n- alert on repeated refresh failures\n'

const beat = (page, ms = 1000) => page.waitForTimeout(ms)

function gitRunner(repo, tolerateFailure = false) {
  return (args) => {
    try {
      execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      if (!tolerateFailure) {
        throw error
      }
      const stderr = error.stderr?.toString().trim()
      console.warn(`  git ${args.join(' ')} failed (tolerated)${stderr ? `: ${stderr}` : ''}`)
    }
  }
}

// Everything the recording machine's global git config could otherwise change or break: a signing
// key the recorder cannot reach, a hooks path that rejects the commit, or a diff3 conflict style
// that puts a third section in every screenshot.
function pinDemoConfig(git) {
  git(['config', 'user.email', 'demo@example.com'])
  git(['config', 'user.name', 'Demo'])
  git(['config', 'commit.gpgsign', 'false'])
  git(['config', 'core.hooksPath', ''])
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'merge.conflictstyle', 'merge'])
  git(['config', 'pull.rebase', 'false'])
}

function makeRepo(name) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `rebase-demo-${name}-`))
  const git = gitRunner(repo)
  git(['init', '-b', 'main'])
  pinDemoConfig(git)
  fs.mkdirSync(path.join(repo, 'src'))
  return { repo, git }
}

const write = (repo, file, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), content)
}

// --- fixtures ---------------------------------------------------------------

// One file per state the lists have to tell apart: staged, unstaged, untracked, and one that is
// half-staged and therefore listed on both sides.
function mixedTreeRepo() {
  const { repo, git } = makeRepo('staging')
  write(repo, 'README.md', BASE_README)
  write(repo, 'src/app.ts', BASE_APP)
  write(repo, 'src/limits.ts', BASE_LIMITS)
  git(['add', '.'])
  git(['commit', '-m', 'Add session expiry helper'])

  write(repo, 'src/app.ts', STAGED_APP)
  git(['add', 'src/app.ts'])

  write(repo, 'src/limits.ts', INDEX_LIMITS)
  git(['add', 'src/limits.ts'])
  write(repo, 'src/limits.ts', WORKTREE_LIMITS)

  write(repo, 'README.md', LOCAL_README)
  write(repo, 'NOTES.md', NOTES)
  return { repo, paths: [repo] }
}

function conflictingMergeRepo() {
  const { repo, git } = makeRepo('conflict-group')
  write(repo, 'README.md', BASE_README)
  write(repo, 'src/app.ts', BASE_APP)
  write(repo, 'src/limits.ts', BASE_LIMITS)
  git(['add', '.'])
  git(['commit', '-m', 'Add session expiry helper'])

  git(['checkout', '-b', 'feature'])
  write(repo, 'src/app.ts', FEATURE_APP)
  git(['add', '.'])
  git(['commit', '-m', 'Shorten idle sessions to thirty minutes'])

  git(['checkout', 'main'])
  write(repo, 'src/app.ts', MAIN_APP)
  git(['add', '.'])
  git(['commit', '-m', 'Extend idle sessions to a full working day'])
  return { repo, paths: [repo] }
}

// --- page helpers -----------------------------------------------------------

const refTree = (page) => page.getByTestId('ref-tree-scroll')
const groupRow = (page, group, file) =>
  page.locator(`[data-testid="status-file-row"][data-group="${group}"]`).filter({ hasText: file })
const groupHeading = (page, label) => page.getByRole('heading', { name: label, exact: true })
const menuItem = (page, name) => page.getByRole('menuitem', { name })
const openLocalChanges = (page) =>
  page.getByRole('button', { name: 'Local changes', exact: true }).filter({ visible: true }).click()

const waitForBranch = (page, branchName) =>
  page.getByRole('button', { name: `${branchName} current` }).waitFor({ timeout: 30_000 })

async function stageRow(page, file) {
  const row = groupRow(page, 'unstaged', file)
  await row.waitFor({ timeout: 30_000 })
  await row.hover()
  await beat(page, 700)
  await row.getByRole('button', { name: `Stage ${file}`, exact: true }).click()
  await groupRow(page, 'staged', file).waitFor({ timeout: 30_000 })
  await beat(page, 1200)
}

// --- scenarios --------------------------------------------------------------

const scenarios = [
  {
    name: 'grouped-staging',
    setup: mixedTreeRepo,
    drive: async ({ page, shot }) => {
      await waitForBranch(page, 'main')
      await openLocalChanges(page)
      await groupHeading(page, 'Unstaged').waitFor({ timeout: 30_000 })
      await beat(page, 1800)
      await shot()
      await beat(page, 1600)

      // Whole-file staging is a move between lists: the row leaves Unstaged and lands in Staged.
      await stageRow(page, 'README.md')
      await beat(page, 900)

      // Double-click does the same thing, without going for the button.
      await groupRow(page, 'unstaged', 'NOTES.md').dblclick()
      await groupRow(page, 'staged', 'NOTES.md').waitFor({ timeout: 30_000 })
      await beat(page, 1600)

      // limits.ts is half-staged, so it is listed on both sides — each row diffs only its own side.
      await groupRow(page, 'unstaged', 'limits.ts').click()
      await beat(page, 2200)
      await groupRow(page, 'staged', 'limits.ts').click()
      await beat(page, 2400)

      // The context menu carries the same move, and the group heading does it for the whole list.
      await groupRow(page, 'staged', 'app.ts').click({ button: 'right' })
      await menuItem(page, 'Unstage').waitFor({ timeout: 15_000 })
      await beat(page, 1400)
      await menuItem(page, 'Unstage').click()
      await groupRow(page, 'unstaged', 'app.ts').waitFor({ timeout: 30_000 })
      await beat(page, 1600)

      await page.getByRole('button', { name: 'Stage all', exact: true }).click()
      await beat(page, 2000)
      await page.getByRole('button', { name: 'Unstage all', exact: true }).click()
      await beat(page, 2600)
    }
  },
  {
    name: 'conflict-group',
    setup: conflictingMergeRepo,
    drive: async ({ page, shot }) => {
      await waitForBranch(page, 'main')
      await beat(page, 1400)

      await refTree(page).getByTitle('feature', { exact: true }).click({ button: 'right' })
      await beat(page, 900)
      await menuItem(page, /Merge into main/).click()
      await beat(page, 1800)
      await openLocalChanges(page)

      // Conflicts sort above everything, with their own group and marker.
      await groupHeading(page, 'Conflicts').waitFor({ timeout: 30_000 })
      await groupRow(page, 'conflicts', 'app.ts').click()
      await beat(page, 2200)
      await shot()
      await beat(page, 1600)

      await groupRow(page, 'conflicts', 'app.ts').click({ button: 'right' })
      await menuItem(page, 'Keep feature').waitFor({ timeout: 15_000 })
      await beat(page, 1400)
      await menuItem(page, 'Keep feature').click()

      // Resolving stages the file: it leaves Conflicts for Staged, and the selection follows it.
      await groupRow(page, 'staged', 'app.ts').waitFor({ timeout: 30_000 })
      await beat(page, 3000)
    }
  }
]

// --- runner -----------------------------------------------------------------

async function openRepoInApp(app, page, repo) {
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

async function runScenario(scenario) {
  const scenarioDir = path.join(outputRoot, scenario.name)
  fs.rmSync(scenarioDir, { recursive: true, force: true })
  fs.mkdirSync(scenarioDir, { recursive: true })

  const { repo, paths } = scenario.setup()
  // The main process only installs its E2E control for a temp dir with this exact prefix.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-user-data-'))

  const env = { ...process.env, NODE_ENV: 'test' }
  delete env.ELECTRON_RUN_AS_NODE
  if (process.platform === 'linux') {
    env.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
  }

  const startedAt = Date.now()
  const screenshotPath = path.join(scenarioDir, `${scenario.name}.png`)
  const videoPath = path.join(scenarioDir, `${scenario.name}.webm`)

  let app
  let page
  let failure
  try {
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        '--e2e',
        ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : [])
      ],
      env,
      recordVideo: { dir: scenarioDir, size: { width: windowWidth, height: windowHeight } }
    })

    page = await app.firstWindow()
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
      },
      { width: windowWidth, height: windowHeight }
    )
    await page.waitForLoadState('domcontentloaded')
    await openRepoInApp(app, page, repo)

    let shotTaken = false
    const context = {
      app,
      page,
      repo,
      git: gitRunner(repo, true),
      shot: async () => {
        await page.screenshot({ path: screenshotPath })
        shotTaken = true
      }
    }

    try {
      await scenario.drive(context)
    } catch (error) {
      failure = error
    }
    if (!shotTaken && !page.isClosed()) {
      await page.screenshot({ path: screenshotPath }).catch(() => {})
    }
  } catch (error) {
    failure ??= error
  } finally {
    // The webm only finalizes once the window and the app are both down.
    const video = page && !page.isClosed() ? page.video() : null
    await page?.close().catch(() => {})
    await app?.close().catch(() => {})
    if (video) {
      await video.saveAs(videoPath).catch(() => {})
      await video.delete().catch(() => {})
    }
    fs.rmSync(userDataDir, { recursive: true, force: true })
    for (const fixturePath of paths) {
      fs.rmSync(fixturePath, { recursive: true, force: true })
    }
  }

  if (failure) {
    throw failure
  }
  return {
    name: scenario.name,
    video: videoPath,
    screenshot: screenshotPath,
    seconds: Math.round((Date.now() - startedAt) / 1000)
  }
}

async function main() {
  const requested = process.argv[2] ?? 'all'
  const selected =
    requested === 'all' ? scenarios : scenarios.filter((scenario) => scenario.name === requested)
  if (selected.length === 0) {
    console.error(`unknown scenario: ${requested}`)
    console.error(`available: ${scenarios.map((scenario) => scenario.name).join(', ')}, all`)
    process.exit(1)
  }
  fs.mkdirSync(outputRoot, { recursive: true })

  const failures = []
  for (const scenario of selected) {
    process.stdout.write(`recording ${scenario.name}… `)
    try {
      const result = await runScenario(scenario)
      console.log(`${result.seconds}s → ${result.video}`)
    } catch (error) {
      failures.push(scenario.name)
      console.log('FAILED')
      console.error(error)
    }
  }
  if (failures.length > 0) {
    console.error(`failed scenarios: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log(`\nall clips under ${outputRoot}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
