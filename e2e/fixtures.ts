import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  test as base,
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page
} from '@playwright/test'

export { expect }

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.join(currentDir, '..', 'out', 'main', 'index.js')

const launchWindowWidth = 1200
const launchWindowHeight = 800

const demoRecordingEnabled = process.env.REBASE_DEMO === '1'
const demoVideoDirectory = path.join(currentDir, '..', 'test-results', 'demos')
const demoSlowMoMilliseconds = 300

let activeFixtureRoot: string | undefined

function fixturePath(prefix: string): string {
  return path.join(activeFixtureRoot ?? os.tmpdir(), prefix)
}

export async function setWindowSize(
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
    },
    { width, height }
  )
}

export type Git = (args: string[]) => void

export function gitIn(repo: string): Git {
  return (args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
}

export function gitOut(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

export function unmergedPaths(repo: string): string[] {
  const paths = gitOut(repo, ['diff', '--name-only', '--diff-filter=U'])
  return paths === '' ? [] : paths.split('\n')
}

export function gitStoppingOnConflict(repo: string): Git {
  return (args) => {
    try {
      execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
    } catch (error) {
      if (unmergedPaths(repo).length === 0) {
        throw error
      }
    }
  }
}

export function revParse(repo: string, ref: string): string {
  return gitOut(repo, ['rev-parse', ref])
}

export function commitSubjects(repo: string, ref = 'HEAD'): string[] {
  const log = gitOut(repo, ['log', '--format=%s', ref])
  return log === '' ? [] : log.split('\n')
}

export function commitParents(repo: string, ref = 'HEAD'): string[] {
  const parents = gitOut(repo, ['rev-list', '--parents', '-n', '1', ref]).split(' ')
  return parents.slice(1)
}

export function porcelainStatus(repo: string): string[] {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })
  return status.split('\n').filter((line) => line.length > 0)
}

export function currentBranch(repo: string): string {
  return gitOut(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

export function localBranches(repo: string): string[] {
  const branches = gitOut(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  return branches === '' ? [] : branches.split('\n')
}

export function tags(repo: string): string[] {
  const tagList = gitOut(repo, ['tag', '--list'])
  return tagList === '' ? [] : tagList.split('\n')
}

export function stashEntries(repo: string): string[] {
  const list = gitOut(repo, ['stash', 'list'])
  return list === '' ? [] : list.split('\n')
}

function configureFixtureRepo(git: (args: string[]) => void): void {
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  git(['config', 'commit.gpgsign', 'false'])
  git(['config', 'core.hooksPath', ''])
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'merge.conflictstyle', 'merge'])
  git(['config', 'pull.rebase', 'false'])
}

export interface FixtureRepoOptions {
  branches?: string[]
}

export function createFixtureRepo(options: FixtureRepoOptions = {}): string {
  const repo = fs.mkdtempSync(fixturePath('repo-'))
  const git = gitIn(repo)
  git(['init', '-b', 'main'])
  configureFixtureRepo(git)
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n')
  git(['add', '.'])
  git(['commit', '-m', 'initial'])
  for (const branch of options.branches ?? []) {
    git(['branch', branch])
  }
  return repo
}

export function createFixtureRepoWithRemote(): { repo: string; remote: string } {
  const remoteBase = fs.mkdtempSync(fixturePath('remote-'))
  const remote = path.join(remoteBase, 'remote.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' })
  const repo = fs.mkdtempSync(fixturePath('repo-'))
  const git = gitIn(repo)
  git(['init', '-b', 'main'])
  configureFixtureRepo(git)
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n')
  git(['add', '.'])
  git(['commit', '-m', 'initial'])
  git(['remote', 'add', 'origin', remote])
  git(['push', '-u', 'origin', 'main'])
  return { repo, remote }
}

export function makeBranchAheadOfOrigin(repo: string, message = 'work to publish'): void {
  const git = gitIn(repo)
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  git(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'])
  git(['config', 'branch.main.remote', 'origin'])
  git(['config', 'branch.main.merge', 'refs/heads/main'])
  git(['commit', '--allow-empty', '-m', message])
}

export function advanceRemote(remote: string, message: string): void {
  const other = fs.mkdtempSync(fixturePath('teammate-'))
  execFileSync('git', ['clone', remote, other], { stdio: 'ignore' })
  const git = gitIn(other)
  git(['config', 'user.email', 'teammate@example.com'])
  git(['config', 'user.name', 'Teammate'])
  fs.writeFileSync(path.join(other, 'README.md'), `# fixture\n${message}\n`)
  git(['add', '.'])
  git(['commit', '-m', message])
  git(['push', 'origin', 'HEAD:main'])
  fs.rmSync(other, { recursive: true, force: true })
}

export interface SeedState {
  workspaces?: string[]
  recentRepos?: string[]
  onboardingComplete?: boolean
  tabs?: Array<string | null>
  activeIndex?: number
  listPaneWidths?: Record<string, number>
}

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface RecordedToast {
  type: string
  title: string
  description: string
}

export interface ExpectedToast {
  type: ToastType
  title: string | RegExp
  description?: string | RegExp
}

export interface LifecycleSnapshot {
  mainPid: number
  sidecarPids: number[]
  sidecarProcessCount: number
  sidecarRespawnCount: number
}

export interface AppHarness {
  readonly page: Page
  app(): ElectronApplication
  close(): Promise<void>
  launchCount(): number
  mainProcessId(): Promise<number>
  inspectLifecycle(): Promise<LifecycleSnapshot>
  reload(): Promise<Page>
  restart(): Promise<Page>
  seed(state: SeedState): Promise<void>
  openRepo(
    repo: string,
    options?: { recentRepos?: string[]; listPaneWidths?: Record<string, number> }
  ): Promise<Page>
  openTabs(repos: Array<string | null>, options?: { activeIndex?: number }): Promise<Page>
  track(fixturePath: string): void
  stubFolderDialog(dir: string | null): Promise<void>
  toasts(): Promise<RecordedToast[]>
  expectToast(
    expected: ExpectedToast,
    trigger: () => Promise<unknown> | unknown
  ): Promise<RecordedToast>
}

interface StoreOverrides {
  recentRepos?: string[]
  workspaces?: string[]
  activeWorkspace?: string | null
  workingDirectory?: string | null
  onboardingComplete?: boolean
  persistedTabRepoPaths?: Array<string | null>
  persistedActiveTabIndex?: number
  listPaneWidths?: Record<string, number>
}

interface MainControl {
  replaceStore: (overrides?: StoreOverrides) => unknown
  inspectLifecycle: () => LifecycleSnapshot
}

const E2E_CONTROL_KEY = '__REBASE_E2E_CONTROL__'
const DIALOG_ORIGINAL_KEY = '__REBASE_E2E_DIALOG_ORIGINAL__'
const TOAST_RECORD_KEY = '__REBASE_E2E_TOASTS__'

const uniquePaths = (values: string[]): string[] => Array.from(new Set(values))

const matchesText = (value: string, matcher: string | RegExp): boolean => {
  if (typeof matcher === 'string') {
    return value === matcher
  }
  matcher.lastIndex = 0
  return matcher.test(value)
}

const matchesToast = (toast: RecordedToast, expected: ExpectedToast): boolean => {
  if (toast.type !== expected.type || !matchesText(toast.title, expected.title)) {
    return false
  }
  return expected.description === undefined
    ? true
    : matchesText(toast.description, expected.description)
}

function findToast(
  recorded: RecordedToast[],
  expected: ExpectedToast,
  startIndex: number
): RecordedToast | undefined {
  return recorded.slice(startIndex).find((toast) => matchesToast(toast, expected))
}

const describeToast = (toast: RecordedToast): string =>
  toast.type +
  ': ' +
  toast.title +
  (toast.description.length > 0 ? ' — ' + toast.description : '')

async function installToastRecorder(page: Page): Promise<void> {
  const install = (key: string) => {
    const target = window as unknown as Record<string, unknown>
    if (target[key]) {
      return
    }
    const recorded: Array<{ type: string; title: string; description: string }> = []
    target[key] = recorded
    const seen = new WeakSet<Element>()
    const scan = () => {
      for (const node of document.querySelectorAll('[data-sonner-toast]')) {
        if (seen.has(node)) {
          continue
        }
        seen.add(node)
        recorded.push({
          type: node.getAttribute('data-type') ?? 'unknown',
          title: node.querySelector('[data-title]')?.textContent?.trim() ?? '',
          description: node.querySelector('[data-description]')?.textContent?.trim() ?? ''
        })
      }
    }
    const start = () => {
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true })
      scan()
    }
    if (document.body) {
      start()
    } else {
      document.addEventListener('DOMContentLoaded', start, { once: true })
    }
  }
  await page.addInitScript(install, TOAST_RECORD_KEY)
  await page.evaluate(install, TOAST_RECORD_KEY)
}

async function readRecordedToasts(page: Page): Promise<RecordedToast[]> {
  return page.evaluate(
    (key: string) =>
      ((window as unknown as Record<string, unknown>)[key] as RecordedToast[] | undefined) ?? [],
    TOAST_RECORD_KEY
  )
}

async function waitForPage(page: Page): Promise<Page> {
  await page.waitForLoadState('domcontentloaded')
  return page
}

function canonicalListPaneWidths(
  widths: Record<string, number> | undefined
): Record<string, number> {
  if (!widths) {
    return {}
  }
  const canonical: Record<string, number> = {}
  for (const [repoPath, width] of Object.entries(widths)) {
    canonical[fs.realpathSync.native(repoPath)] = width
  }
  return canonical
}

function removePaths(paths: string[]): void {
  for (const fixturePath of uniquePaths(paths).sort((left, right) => right.length - left.length)) {
    fs.rmSync(fixturePath, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 10 : 0,
      retryDelay: 100
    })
  }
}

export async function waitForRepoSurface(
  page: Page,
  repoPath: string,
  timeout = 15_000
): Promise<void> {
  await expect(page.getByRole('tab', { name: path.basename(repoPath) })).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout }
  )
  await expect(activeTab(page).getByTestId('repo-shell')).toBeVisible({ timeout })
  await expect(workingCopyRow(page)).toBeVisible({ timeout })
}

export const test = base.extend<{ harness: AppHarness }>({
  harness: async ({}, use, testInfo) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-'))
    const userDataDir = fs.mkdtempSync(path.join(fixtureRoot, 'rebase-e2e-user-data-'))
    activeFixtureRoot = fixtureRoot
    const externalFixturePaths = new Set<string>()
    let electronApp: ElectronApplication | undefined
    let page: Page | undefined
    let launches = 0

    const launch = async (): Promise<Page> => {
      launches += 1
      const electronEnv = { ...process.env, NODE_ENV: 'test' }
      delete electronEnv.ELECTRON_RUN_AS_NODE
      if (process.platform === 'linux') {
        electronEnv.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
      }
      electronApp = await electron.launch({
        args: [
          mainEntry,
          '--user-data-dir=' + userDataDir,
          '--e2e',
          ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : [])
        ],
        env: electronEnv,
        ...(demoRecordingEnabled
          ? {
              slowMo: demoSlowMoMilliseconds,
              recordVideo: {
                dir: demoVideoDirectory,
                size: { width: launchWindowWidth, height: launchWindowHeight }
              }
            }
          : {})
      })
      page = await electronApp.firstWindow()
      await installToastRecorder(page)
      await setWindowSize(electronApp, launchWindowWidth, launchWindowHeight)
      return waitForPage(page)
    }

    const currentApp = (): ElectronApplication => {
      if (!electronApp) {
        throw new Error('Electron application is unavailable')
      }
      return electronApp
    }

    const currentPage = (): Page => {
      if (!page) {
        throw new Error('Electron page is unavailable')
      }
      return page
    }

    const replaceStore = async (overrides: StoreOverrides = {}): Promise<void> => {
      await currentApp().evaluate(
        (_, input): void => {
          const control = (globalThis as Record<string, unknown>)[input.key] as
            | MainControl
            | undefined
          if (!control) {
            throw new Error('main E2E control is unavailable; launch the app with --e2e')
          }
          control.replaceStore(input.overrides)
        },
        { key: E2E_CONTROL_KEY, overrides }
      )
    }

    const inspectLifecycle = (): Promise<LifecycleSnapshot> =>
      currentApp().evaluate((_, key): LifecycleSnapshot => {
        const control = (globalThis as Record<string, unknown>)[key] as MainControl | undefined
        if (!control) {
          throw new Error('main E2E control is unavailable; launch the app with --e2e')
        }
        return control.inspectLifecycle()
      }, E2E_CONTROL_KEY)

    const restoreFolderDialog = async (): Promise<void> => {
      if (!electronApp) {
        return
      }
      await currentApp().evaluate(({ dialog }, key: string) => {
        const target = globalThis as Record<string, unknown>
        const original = target[key] as typeof dialog.showOpenDialog | undefined
        if (original) {
          dialog.showOpenDialog = original
          delete target[key]
        }
      }, DIALOG_ORIGINAL_KEY)
    }

    const closeApp = async (): Promise<void> => {
      if (!electronApp) {
        return
      }
      const app = electronApp
      electronApp = undefined
      page = undefined
      await app.close()
    }

    await launch()

    const harness: AppHarness = {
      get page() {
        return currentPage()
      },
      app: currentApp,
      close: closeApp,
      launchCount: () => launches,
      mainProcessId: async () => (await inspectLifecycle()).mainPid,
      inspectLifecycle,
      reload: async () => {
        await currentPage().reload()
        return waitForPage(currentPage())
      },
      restart: async () => {
        await closeApp()
        return launch()
      },
      track: (trackedPath) => {
        if (
          trackedPath !== fixtureRoot &&
          !trackedPath.startsWith(fixtureRoot + path.sep)
        ) {
          externalFixturePaths.add(trackedPath)
        }
      },
      seed: async (state) => {
        const workspaces = state.workspaces ?? []
        const activeWorkspace = workspaces.at(-1) ?? null
        await replaceStore({
          workspaces,
          recentRepos: state.recentRepos ?? [],
          activeWorkspace,
          workingDirectory: activeWorkspace,
          onboardingComplete: state.onboardingComplete ?? false,
          persistedTabRepoPaths: state.tabs ?? [null],
          persistedActiveTabIndex: state.activeIndex ?? 0,
          listPaneWidths: canonicalListPaneWidths(state.listPaneWidths)
        })
      },
      openRepo: async (repo, options) => {
        harness.track(repo)
        await harness.seed({
          workspaces: [path.dirname(repo)],
          recentRepos: options?.recentRepos,
          onboardingComplete: true,
          tabs: [repo],
          activeIndex: 0,
          listPaneWidths: options?.listPaneWidths
        })
        const activePage = await harness.reload()
        await waitForRepoSurface(activePage, repo)
        return activePage
      },
      openTabs: async (repos, options) => {
        for (const repo of repos) {
          if (repo) {
            harness.track(repo)
          }
        }
        const workspaces = uniquePaths(
          repos.filter((repo): repo is string => Boolean(repo)).map((repo) => path.dirname(repo))
        )
        const activeIndex = options?.activeIndex ?? 0
        await harness.seed({
          workspaces,
          onboardingComplete: true,
          tabs: repos,
          activeIndex
        })
        const activePage = await harness.reload()
        const activeRepo = repos[activeIndex]
        if (activeRepo) {
          await waitForRepoSurface(activePage, activeRepo)
        }
        return activePage
      },
      stubFolderDialog: async (dir) => {
        await currentApp().evaluate(
          ({ dialog }, input: { chosen: string | null; key: string }) => {
            const target = globalThis as Record<string, unknown>
            target[input.key] ??= dialog.showOpenDialog
            dialog.showOpenDialog = (async () =>
              input.chosen
                ? { canceled: false, filePaths: [input.chosen] }
                : { canceled: true, filePaths: [] }) as typeof dialog.showOpenDialog
          },
          { chosen: dir, key: DIALOG_ORIGINAL_KEY }
        )
      },
      toasts: () => readRecordedToasts(currentPage()),
      expectToast: async (expected, trigger) => {
        const startIndex = (await readRecordedToasts(currentPage())).length
        await trigger()
        let matched: RecordedToast | undefined
        await expect
          .poll(
            async () => {
              const recorded = await readRecordedToasts(currentPage())
              matched = findToast(recorded, expected, startIndex)
              if (matched) {
                return 'matched'
              }
              return recorded.length === 0
                ? '<no toasts raised>'
                : recorded.map(describeToast).join(' | ')
            },
            { timeout: 10_000 }
          )
          .toBe('matched')
        return matched as RecordedToast
      }
    }

    try {
      await use(harness)
    } finally {
      let cleanupError: unknown
      try {
        await restoreFolderDialog()
      } catch (error) {
        cleanupError = error
      }
      try {
        await closeApp()
      } catch (error) {
        cleanupError ??= error
      }
      try {
        removePaths([...externalFixturePaths, fixtureRoot])
      } catch (error) {
        cleanupError ??= error
      }
      if (activeFixtureRoot === fixtureRoot) {
        activeFixtureRoot = undefined
      }
      if (cleanupError && testInfo.status === testInfo.expectedStatus) {
        throw cleanupError
      }
    }
  }
})
export const activeTab = (page: Page) =>
  page.locator('[data-testid="tab-owner"][data-active="true"]')

export const refTree = (page: Page) => activeTab(page).getByTestId('ref-tree-scroll')

export type FileListGroup = 'conflicts' | 'staged' | 'unstaged' | 'head-commit'

const cssAttributeValue = (value: string) => value.replace(/["\\]/g, '\\$&')
export const fileRow = (page: Page, file: string, group?: FileListGroup) => {
  const groupFilter = group ? `[data-group="${group}"]` : ''
  const path = cssAttributeValue(file)
  return activeTab(page).locator(
    `[data-testid="status-file-row"]${groupFilter}[data-file="${path}"]`
  )
}
export const stagedFileRow = (page: Page, file: string) => fileRow(page, file, 'staged')
export const unstagedFileRow = (page: Page, file: string) => fileRow(page, file, 'unstaged')
export const waitForStagingIdle = (page: Page) =>
  expect(page.getByText('Loading', { exact: true })).toHaveCount(0, { timeout: 15_000 })
export const stageFileFromRow = async (page: Page, file: string) => {
  await waitForStagingIdle(page)
  await fileRow(page, file, 'unstaged')
    .getByRole('button', { name: `Stage ${file}`, exact: true })
    .click()
}
export const unstageFileFromRow = async (page: Page, file: string) => {
  await waitForStagingIdle(page)
  await fileRow(page, file, 'staged')
    .getByRole('button', { name: `Unstage ${file}`, exact: true })
    .click()
}
export const syncButton = (page: Page) => activeTab(page).getByTestId('sync-button')
export const workingCopyRow = (page: Page) => activeTab(page).getByTestId('working-copy-row')
export const commitListRegion = (page: Page) =>
  activeTab(page).getByRole('region', { name: 'Commits' })
export const commitDetailPane = (page: Page) =>
  activeTab(page).getByTestId('commit-detail-pane')
export const listDivider = (page: Page) =>
  activeTab(page).getByRole('button', { name: 'Resize commit list', exact: true })

export async function openLocalChanges(page: Page): Promise<void> {
  await workingCopyRow(page).click()
  await expect(activeTab(page).getByTestId('working-copy-header')).toBeVisible({ timeout: 10_000 })
  await expect(activeTab(page).getByTestId('commit-bar')).toBeVisible({ timeout: 10_000 })
}

export async function openHistory(page: Page): Promise<void> {
  await expect(commitListRegion(page)).toBeVisible({ timeout: 10_000 })
}

export async function commitListWidth(page: Page): Promise<number> {
  const box = await commitListRegion(page).boundingBox()
  if (!box) {
    throw new Error('the commit list has no bounding box')
  }
  return Math.round(box.width)
}

export async function dragListDivider(
  page: Page,
  deltaX: number,
  options: { release?: boolean } = {}
): Promise<void> {
  const divider = listDivider(page)
  await expect(divider).toBeVisible({ timeout: 10_000 })
  await divider.evaluate(
    (element, input) => {
      const box = element.getBoundingClientRect()
      const startX = box.left + box.width / 2
      const startY = box.top + box.height / 2
      element.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          buttons: 1,
          clientX: startX,
          clientY: startY
        })
      )
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          clientX: startX + input.deltaX,
          clientY: startY
        })
      )
      if (input.release) {
        window.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            clientX: startX + input.deltaX,
            clientY: startY
          })
        )
      }
    },
    { deltaX, release: options.release !== false }
  )
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
}

export async function releaseListDividerDrag(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
}
