import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.join(currentDir, '..', 'out', 'main', 'index.js')

const outputRoot = path.join(os.tmpdir(), 'rebase-conflict-demo', 'scenarios')
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

const BASE_LIMITS = `export const MAX_SESSIONS_PER_USER = 5
export const MAX_DEVICES_PER_USER = 3
`

const MAIN_LIMITS = `export const MAX_SESSIONS_PER_USER = 25
export const MAX_DEVICES_PER_USER = 10
`

const FEATURE_LIMITS = `export const MAX_SESSIONS_PER_USER = 2
export const MAX_DEVICES_PER_USER = 1
`

const SESSION_LOG = `import type { Session } from './app'

export function logExpiry(session: Session): void {
  console.info('session expired', session.id)
}
`

const BASE_LEGACY = `// Superseded by the session store, kept until the last consumer migrates.
export function readLegacyCookie(): string | null {
  return null
}
`

const MAIN_LEGACY = `// Superseded by the session store, kept until the last consumer migrates.
export function readLegacyCookie(): string | null {
  return globalThis.document?.cookie ?? null
}
`

const BASE_README = '# session-service\n\nIssues session tokens for the web client.\n'
const LOCAL_README = `${BASE_README}\nTODO: document the expiry policy.\n`
const REMOTE_README = `${BASE_README}\n## Deploys\n\nStaging redeploys every night at 02:00 UTC.\n`
const BASE_CHANGELOG = '# Changelog\n\n## Unreleased\n'
const LOCAL_CHANGELOG = `${BASE_CHANGELOG}\n- Shorten idle sessions.\n`

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


function conflictingMergeRepo() {
  const { repo, git } = makeRepo('merge')
  write(repo, 'README.md', BASE_README)
  write(repo, 'src/app.ts', BASE_APP)
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

function stashConflictRepo() {
  const { repo, git } = makeRepo('stash')
  write(repo, 'README.md', BASE_README)
  write(repo, 'src/app.ts', BASE_APP)
  git(['add', '.'])
  git(['commit', '-m', 'Add session expiry helper'])

  write(repo, 'src/app.ts', FEATURE_APP)
  git(['stash', 'push', '-m', 'wip: shorten idle sessions'])

  write(repo, 'src/app.ts', MAIN_APP)
  git(['add', '.'])
  git(['commit', '-m', 'Extend idle sessions to a full working day'])
  return { repo, paths: [repo] }
}

function twoStopRepo(sideBranch) {
  const { repo, git } = makeRepo(sideBranch)
  write(repo, 'README.md', BASE_README)
  write(repo, 'src/app.ts', BASE_APP)
  write(repo, 'src/limits.ts', BASE_LIMITS)
  git(['add', '.'])
  git(['commit', '-m', 'Add session expiry helper'])

  git(['checkout', '-b', sideBranch])
  write(repo, 'src/app.ts', FEATURE_APP)
  write(repo, 'src/session-log.ts', SESSION_LOG)
  git(['add', '.'])
  git(['commit', '-m', 'Shorten idle sessions and log expiries'])
  write(repo, 'src/limits.ts', FEATURE_LIMITS)
  git(['add', '.'])
  git(['commit', '-m', 'Tighten per-user session limits'])

  git(['checkout', 'main'])
  write(repo, 'src/app.ts', MAIN_APP)
  write(repo, 'src/limits.ts', MAIN_LIMITS)
  git(['add', '.'])
  git(['commit', '-m', 'Extend sessions and raise per-user limits'])
  return { repo, git }
}

function rebaseRepo() {
  const { repo, git } = twoStopRepo('feature')
  git(['checkout', 'feature'])
  return { repo, paths: [repo] }
}

function cherryPickRepo() {
  const { repo } = twoStopRepo('hotfix')
  return { repo, paths: [repo] }
}

function modifyDeleteRepo() {
  const { repo, git } = makeRepo('modify-delete')
  write(repo, 'README.md', BASE_README)
  write(repo, 'src/legacy-cookie.ts', BASE_LEGACY)
  git(['add', '.'])
  git(['commit', '-m', 'Add the legacy cookie reader'])

  git(['checkout', '-b', 'feature'])
  git(['rm', '-q', 'src/legacy-cookie.ts'])
  git(['commit', '-m', 'Drop the legacy cookie reader'])

  git(['checkout', 'main'])
  write(repo, 'src/legacy-cookie.ts', MAIN_LEGACY)
  git(['add', '.'])
  git(['commit', '-m', 'Read the cookie from the document'])
  return { repo, paths: [repo] }
}

function pullRepo() {
  const remoteBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-demo-remote-'))
  const remote = path.join(remoteBase, 'session-service.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' })

  const { repo, git } = makeRepo('pull')
  write(repo, 'README.md', BASE_README)
  write(repo, 'CHANGELOG.md', BASE_CHANGELOG)
  write(repo, 'src/app.ts', BASE_APP)
  git(['add', '.'])
  git(['commit', '-m', 'Add session expiry helper'])
  git(['remote', 'add', 'origin', remote])
  git(['push', '-u', 'origin', 'main'])

  const teammate = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-demo-teammate-'))
  execFileSync('git', ['clone', remote, teammate], { stdio: 'ignore' })
  const teammateGit = gitRunner(teammate)
  pinDemoConfig(teammateGit)
  teammateGit(['config', 'user.email', 'teammate@example.com'])
  teammateGit(['config', 'user.name', 'Teammate'])
  write(teammate, 'README.md', REMOTE_README)
  teammateGit(['add', '.'])
  teammateGit(['commit', '-m', 'Document the nightly staging deploy'])
  teammateGit(['push', 'origin', 'HEAD:main'])
  fs.rmSync(teammate, { recursive: true, force: true })

  write(repo, 'README.md', LOCAL_README)
  return { repo, paths: [repo, remoteBase] }
}


const refTree = (page) => page.getByTestId('ref-tree-scroll')
const statusRow = (page, file) => page.getByTestId('status-file-row').filter({ hasText: file })
const menuItem = (page, name) => page.getByRole('menuitem', { name })
const banner = (page, text) => page.getByRole('status').filter({ hasText: text })
const openLocalChanges = (page) =>
  page.getByRole('button', { name: 'Local changes', exact: true }).filter({ visible: true }).click()
const openHistory = (page) =>
  page.getByRole('button', { name: 'History', exact: true }).filter({ visible: true }).click()

const waitForBranch = (page, branchName) =>
  page.getByRole('button', { name: `${branchName} current` }).waitFor({ timeout: 30_000 })

async function mergeFeatureIntoMain(page) {
  await refTree(page).getByTitle('feature', { exact: true }).click({ button: 'right' })
  await beat(page, 1000)
  await menuItem(page, /Merge into main/).click()
  await beat(page, 1800)
  await openLocalChanges(page)
  await beat(page, 1200)
}

async function takeSide(page, file, choice, { shot } = {}) {
  const row = statusRow(page, file)
  await row.waitFor({ timeout: 30_000 })
  await row.click()
  await beat(page, 1000)
  await row.click({ button: 'right' })
  await menuItem(page, choice).waitFor({ timeout: 15_000 })
  await beat(page, 1400)
  if (shot) {
    await shot()
  }
  await menuItem(page, choice).click()
  await beat(page, 1600)
}


const scenarios = [
  {
    name: 'merge-resolve',
    setup: conflictingMergeRepo,
    drive: async ({ page, shot }) => {
      await waitForBranch(page, 'main')
      await beat(page, 1400)
      await mergeFeatureIntoMain(page)

      const conflictBanner = banner(page, 'Merging feature into main')
      await conflictBanner.waitFor({ timeout: 30_000 })
      await beat(page, 1400)

      await takeSide(page, 'app.ts', 'Keep main', { shot })

      await conflictBanner.getByText('All conflicts are resolved').waitFor({ timeout: 30_000 })
      await beat(page, 1600)
      await page.getByRole('button', { name: /^Commit/ }).click()
      await page.getByText('Working tree clean').waitFor({ timeout: 30_000 })
      await beat(page, 1400)

      await openHistory(page)
      await beat(page, 2200)
    }
  },
  {
    name: 'merge-abort',
    setup: conflictingMergeRepo,
    drive: async ({ page, shot }) => {
      await waitForBranch(page, 'main')
      await beat(page, 1400)
      await mergeFeatureIntoMain(page)

      const conflictBanner = banner(page, 'Merging feature into main')
      await conflictBanner.waitFor({ timeout: 30_000 })
      await statusRow(page, 'app.ts').click()
      await beat(page, 2800)

      await conflictBanner.getByRole('button', { name: 'Abort merge' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor({ timeout: 15_000 })
      await beat(page, 1200)
      await shot()
      await beat(page, 2000)

      await dialog.getByRole('button', { name: 'Abort merge' }).click()
      await page.getByText('Working tree clean').waitFor({ timeout: 30_000 })
      await beat(page, 3400)
    }
  },
  {
    name: 'stash-conflict',
    setup: stashConflictRepo,
    drive: async ({ page, shot }) => {
      await waitForBranch(page, 'main')
      await beat(page, 1400)

      const stashRow = page.getByTestId('ref-tree-stash-row')
      await stashRow.waitFor({ timeout: 30_000 })
      await beat(page, 1200)
      await stashRow.click({ button: 'right' })
      await beat(page, 1200)
      await menuItem(page, 'Apply').click()
      await beat(page, 1800)

      await openLocalChanges(page)
      await banner(page, 'merge conflict').waitFor({ timeout: 30_000 })
      await beat(page, 2200)

      await takeSide(page, 'app.ts', 'Keep the incoming version', { shot })
      await beat(page, 3600)
    }
  },
  {
    name: 'rebase-terminal',
    setup: rebaseRepo,
    drive: async ({ page, git, shot }) => {
      await waitForBranch(page, 'feature')
      await openLocalChanges(page)
      await page.getByText('Working tree clean').waitFor({ timeout: 30_000 })
      await beat(page, 2000)

      git(['rebase', 'main'])

      const rebaseBanner = banner(page, 'Rebasing feature onto main')
      await rebaseBanner.waitFor({ timeout: 30_000 })
      await beat(page, 1800)
      await shot()
      await beat(page, 1200)

      await takeSide(page, 'app.ts', 'Keep main')
      await rebaseBanner.getByText('All conflicts are resolved').waitFor({ timeout: 30_000 })
      await beat(page, 1200)
      await rebaseBanner.getByRole('button', { name: 'Continue rebase' }).click()

      await banner(page, '2/2').waitFor({ timeout: 30_000 })
      await beat(page, 1800)
      await takeSide(page, 'limits.ts', 'Keep feature')
      await rebaseBanner.getByRole('button', { name: 'Continue rebase' }).click()

      await page.getByText('Working tree clean').waitFor({ timeout: 30_000 })
      await beat(page, 1600)
      await openHistory(page)
      await beat(page, 2400)
    }
  },
  {
    name: 'cherry-pick-sequence',
    setup: cherryPickRepo,
    drive: async ({ page, git, shot }) => {
      await waitForBranch(page, 'main')
      await openLocalChanges(page)
      await beat(page, 1800)

      git(['cherry-pick', 'hotfix~2..hotfix'])

      const pickBanner = banner(page, 'Cherry-picking')
      await pickBanner.waitFor({ timeout: 30_000 })
      await beat(page, 1800)
      await shot()
      await beat(page, 1200)

      await takeSide(page, 'app.ts', /^Keep \S+ Shorten idle sessions/)
      await pickBanner.getByRole('button', { name: 'Continue cherry-pick' }).click()

      await banner(page, '2/2').waitFor({ timeout: 30_000 })
      await beat(page, 1800)
      await takeSide(page, 'limits.ts', /^Keep \S+ Tighten per-user session limits/)
      await pickBanner.getByRole('button', { name: 'Continue cherry-pick' }).click()

      await page.getByText('Working tree clean').waitFor({ timeout: 30_000 })
      await beat(page, 1600)
      await openHistory(page)
      await beat(page, 2400)
    }
  },
  {
    name: 'modify-delete',
    setup: modifyDeleteRepo,
    drive: async ({ page, shot }) => {
      await waitForBranch(page, 'main')
      await beat(page, 1400)
      await mergeFeatureIntoMain(page)

      const conflictBanner = banner(page, 'Merging feature into main')
      await conflictBanner.waitFor({ timeout: 30_000 })
      await beat(page, 1400)

      await takeSide(page, 'legacy-cookie.ts', 'Keep the file', { shot })

      await conflictBanner.getByText('All conflicts are resolved').waitFor({ timeout: 30_000 })
      await beat(page, 1600)
      await page.getByRole('button', { name: /^Commit/ }).click()
      await page.getByText('Working tree clean').waitFor({ timeout: 30_000 })
      await beat(page, 1400)
      await openHistory(page)
      await beat(page, 2200)
    }
  },
  {
    name: 'pull-blocked',
    setup: pullRepo,
    drive: async ({ page, repo, shot }) => {
      await waitForBranch(page, 'main')
      await openLocalChanges(page)
      await statusRow(page, 'README.md').waitFor({ timeout: 30_000 })
      await statusRow(page, 'README.md').click()
      await beat(page, 2000)

      await page.getByRole('button', { name: 'Pull', exact: true }).click()
      await beat(page, 1400)
      await shot()
      await beat(page, 3600)

      await statusRow(page, 'README.md').click()
      await beat(page, 2400)

      write(repo, 'README.md', BASE_README)
      write(repo, 'CHANGELOG.md', LOCAL_CHANGELOG)
      await statusRow(page, 'CHANGELOG.md').waitFor({ timeout: 30_000 })
      await beat(page, 1800)

      await page.getByRole('button', { name: 'Pull', exact: true }).click()
      await beat(page, 2600)
      await openHistory(page)
      await beat(page, 2600)
    }
  },
  {
    name: 'external-abort',
    setup: conflictingMergeRepo,
    drive: async ({ page, git, shot }) => {
      await waitForBranch(page, 'main')
      await beat(page, 1400)
      await mergeFeatureIntoMain(page)

      const conflictBanner = banner(page, 'Merging feature into main')
      await conflictBanner.waitFor({ timeout: 30_000 })
      await statusRow(page, 'app.ts').click()
      await beat(page, 2600)
      await shot()
      await beat(page, 2000)

      git(['merge', '--abort'])

      await page.getByText('Working tree clean').waitFor({ timeout: 30_000 })
      await beat(page, 4200)
    }
  }
]


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
