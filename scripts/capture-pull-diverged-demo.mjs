import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.join(currentDir, '..', 'out', 'main', 'index.js')

const outputRoot = path.join(os.tmpdir(), 'rebase-pull-diverged-demo', 'scenarios')
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

const REMOTE_APP = `export interface Session {
  id: string
  userId: string
}

// Sessions expire after eight hours of inactivity.
export const SESSION_TTL_MINUTES = 480

export function isExpired(session: Session, ageMinutes: number): boolean {
  return ageMinutes > SESSION_TTL_MINUTES
}
`

const LOCAL_APP = `export interface Session {
  id: string
  userId: string
}

// Sessions expire after thirty minutes of inactivity.
export const SESSION_TTL_MINUTES = 30

export function isExpired(session: Session, ageMinutes: number): boolean {
  return ageMinutes >= SESSION_TTL_MINUTES
}
`

const BASE_README = '# session-service\n\nIssues session tokens for the web client.\n'
const REMOTE_README = `${BASE_README}\n## Deploys\n\nStaging redeploys every night at 02:00 UTC.\n`
const LOCAL_CHANGELOG = '# Changelog\n\n## Unreleased\n\n- Shorten idle sessions.\n'

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

const write = (repo, file, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), content)
}

function divergedRepo({ conflicting }) {
  const remoteBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-demo-remote-'))
  const remote = path.join(remoteBase, 'session-service.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' })

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-demo-pull-'))
  const git = gitRunner(repo)
  git(['init', '-b', 'main'])
  pinDemoConfig(git)
  write(repo, 'README.md', BASE_README)
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
  if (conflicting) {
    write(teammate, 'src/app.ts', REMOTE_APP)
  }
  teammateGit(['add', '.'])
  teammateGit(['commit', '-m', 'Document the nightly staging deploy'])
  teammateGit(['push', 'origin', 'HEAD:main'])
  fs.rmSync(teammate, { recursive: true, force: true })

  if (conflicting) {
    write(repo, 'src/app.ts', LOCAL_APP)
    git(['add', '.'])
    git(['commit', '-m', 'Shorten idle sessions to thirty minutes'])
  } else {
    write(repo, 'CHANGELOG.md', LOCAL_CHANGELOG)
    git(['add', '.'])
    git(['commit', '-m', 'Start the changelog'])
  }
  return { repo, paths: [repo, remoteBase] }
}

const statusRow = (page, file) => page.getByTestId('status-file-row').filter({ hasText: file })
const menuItem = (page, name) => page.getByRole('menuitem', { name })
const banner = (page, text) => page.getByRole('status').filter({ hasText: text })
const openLocalChanges = (page) =>
  page.getByRole('button', { name: 'Local changes', exact: true }).filter({ visible: true }).click()
const openHistory = (page) =>
  page.getByRole('button', { name: 'History', exact: true }).filter({ visible: true }).click()

const waitForBranch = (page, branchName) =>
  page.getByRole('button', { name: `${branchName} current` }).waitFor({ timeout: 30_000 })

const divergedDialog = (page) =>
  page.getByRole('dialog').filter({ hasText: 'have diverged' })

async function pullUntilDialog(page, shot) {
  await page.getByRole('button', { name: 'Pull', exact: true }).click()
  await divergedDialog(page).waitFor({ timeout: 30_000 })
  await beat(page, 1600)
  await shot()
  await beat(page, 1400)
}

const scenarios = [
  {
    name: 'pull-diverged-rebase',
    setup: () => divergedRepo({ conflicting: false }),
    drive: async ({ page, shot }) => {
      await waitForBranch(page, 'main')
      await beat(page, 1600)

      await pullUntilDialog(page, shot)

      await page.getByRole('button', { name: 'Rebase onto upstream' }).click()
      await page.getByText('Pulled', { exact: true }).waitFor({ timeout: 30_000 })
      await beat(page, 2400)
      await openHistory(page)
      await beat(page, 2600)
    }
  },
  {
    name: 'pull-diverged-merge-conflict',
    setup: () => divergedRepo({ conflicting: true }),
    drive: async ({ page, shot }) => {
      await waitForBranch(page, 'main')
      await beat(page, 1600)

      await pullUntilDialog(page, shot)

      await page.getByRole('button', { name: 'Merge upstream' }).click()
      await divergedDialog(page).waitFor({ state: 'hidden', timeout: 30_000 })
      await beat(page, 1200)
      await openLocalChanges(page)
      const conflictBanner = banner(page, 'Merging')
      await conflictBanner.waitFor({ timeout: 30_000 })
      await beat(page, 1600)

      const row = statusRow(page, 'app.ts')
      await row.waitFor({ timeout: 30_000 })
      await row.click()
      await beat(page, 1400)
      await row.click({ button: 'right' })
      await menuItem(page, /Keep main/).waitFor({ timeout: 15_000 })
      await beat(page, 1400)
      await menuItem(page, /Keep main/).click()

      await conflictBanner.getByText('All conflicts are resolved').waitFor({ timeout: 30_000 })
      await beat(page, 1600)
      await page.getByRole('button', { name: /^Commit/ }).click()
      await page.getByText('Working tree clean').waitFor({ timeout: 30_000 })
      await beat(page, 1400)
      await openHistory(page)
      await beat(page, 2400)
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
}

await main()
