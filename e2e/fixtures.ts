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

export async function setWindowSize(
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
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
  const status = gitOut(repo, ['status', '--porcelain'])
  return status === '' ? [] : status.split('\n')
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

export interface FixtureRepoOptions {
  branches?: string[]
}

export function createFixtureRepo(options: FixtureRepoOptions = {}): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-repo-'))
  const git = gitIn(repo)
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n')
  git(['add', '.'])
  git(['commit', '-m', 'initial'])
  for (const branch of options.branches ?? []) {
    git(['branch', branch])
  }
  return repo
}

// A clone wired to a local bare remote with `main` already published, so a test can rewrite the local
// tip (amend) to produce a Diverged branch and exercise the force-push flow against a real remote.
export function createFixtureRepoWithRemote(): { repo: string; remote: string } {
  const remoteBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-remote-'))
  const remote = path.join(remoteBase, 'remote.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' })
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-repo-'))
  const git = gitIn(repo)
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n')
  git(['add', '.'])
  git(['commit', '-m', 'initial'])
  git(['remote', 'add', 'origin', remote])
  git(['push', '-u', 'origin', 'main'])
  return { repo, remote }
}

// Push a new commit onto the remote's main from a throwaway clone — stands in for a teammate (or
// another machine) publishing while the local branch holds a stale view of the remote.
export function advanceRemote(remote: string, message: string): void {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-teammate-'))
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

export interface ExpectedToastMatch {
  expected: ExpectedToast
  recordedIndex: number
}

export interface AppHarness {
  readonly page: Page
  app(): ElectronApplication
  launchCount(): number
  mainProcessId(): Promise<number>
  inspectLifecycle(): Promise<LifecycleSnapshot>
  reload(): Promise<Page>
  restart(): Promise<Page>
  seed(state: SeedState): Promise<void>
  openRepo(repo: string, options?: { recentRepos?: string[] }): Promise<Page>
  openTabs(repos: Array<string | null>, options?: { activeIndex?: number }): Promise<Page>
  track(repo: string): void
  stubFolderDialog(dir: string | null): Promise<void>
  toasts(): Promise<RecordedToast[]>
  // Asserts a toast was raised AND marks it expected, so the end-of-test guard stops treating it as
  // an unexplained failure. Every error/warning toast a test provokes must go through here.
  expectToast(
    expected: ExpectedToast,
    trigger: () => Promise<unknown> | unknown
  ): Promise<RecordedToast>
}

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

export function findToastMatch(
  recorded: RecordedToast[],
  expected: ExpectedToast,
  startIndex: number
): { toast: RecordedToast; recordedIndex: number } | undefined {
  for (let recordedIndex = startIndex; recordedIndex < recorded.length; recordedIndex++) {
    const toast = recorded[recordedIndex]
    if (toast && matchesToast(toast, expected)) {
      return { toast, recordedIndex }
    }
  }
  return undefined
}

export function findUnexplainedFailureToasts(
  recorded: RecordedToast[],
  expectedToasts: ExpectedToastMatch[]
): RecordedToast[] {
  const expectedByIndex = new Map(
    expectedToasts.map((match) => [match.recordedIndex, match.expected] as const)
  )
  return recorded.filter((toast, recordedIndex) => {
    if (toast.type !== 'error' && toast.type !== 'warning') {
      return false
    }
    const expected = expectedByIndex.get(recordedIndex)
    return !expected || !matchesToast(toast, expected)
  })
}

const describeToast = (toast: RecordedToast): string =>
  `${toast.type}: ${toast.title}${toast.description ? ` — ${toast.description}` : ''}`

const uniquePaths = (values: string[]): string[] => Array.from(new Set(values))

interface StoreOverrides {
  recentRepos?: string[]
  workspaces?: string[]
  activeWorkspace?: string | null
  workingDirectory?: string | null
  onboardingComplete?: boolean
  persistedTabRepoPaths?: Array<string | null>
  persistedActiveTabIndex?: number
}

export interface LifecycleSnapshot {
  mainPid: number
  sidecarPids: number[]
  sidecarProcessCount: number
  sidecarRespawnCount: number
}

interface MainControl {
  replaceStore: (overrides?: StoreOverrides) => unknown
  inspectLifecycle: () => LifecycleSnapshot
}

interface SharedApp {
  readonly page: Page
  app(): ElectronApplication
  inspectLifecycle(): Promise<LifecycleSnapshot>
  launchCount(): number
  reload(): Promise<Page>
  restart(): Promise<Page>
  replaceStore(overrides?: StoreOverrides): Promise<void>
  restoreWindowSize(): Promise<void>
  readStderr(): string[]
  restoreFolderDialog(): Promise<void>
  stubFolderDialog(dir: string | null): Promise<void>
  trackRepo(repo: string): void
  untrackRepos(repos: string[]): void
}

type CleanupStep = () => Promise<void> | void

interface FixtureTeardownOptions {
  beforeCloseRepos?: CleanupStep[]
  closeRepos: CleanupStep
  afterCloseRepos?: CleanupStep[]
  closeApp?: CleanupStep
  removeFixturePaths: CleanupStep
  afterRemoveFixturePaths?: CleanupStep[]
}

const E2E_CONTROL_KEY = '__REBASE_E2E_CONTROL__'
const DIALOG_ORIGINAL_KEY = '__REBASE_E2E_DIALOG_ORIGINAL__'
const forbiddenShutdownLogs = [
  'sidecar is shutting down',
  'sidecar respawn failed',
  'child process gone'
]

const TOAST_RECORD_KEY = '__REBASE_E2E_TOASTS__'

// Toasts auto-dismiss, so polling the DOM from the test side races them away. Record every toast as
// it mounts instead, and assert against the recording.
async function installToastRecorder(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const recorded: Array<{ type: string; title: string; description: string }> = []
    ;(window as unknown as Record<string, unknown>)[key] = recorded
    const seen = new WeakSet<Element>()
    const readToast = (node: Element) => {
      if (seen.has(node)) {
        return
      }
      seen.add(node)
      recorded.push({
        type: node.getAttribute('data-type') ?? 'unknown',
        title: node.querySelector('[data-title]')?.textContent?.trim() ?? '',
        description: node.querySelector('[data-description]')?.textContent?.trim() ?? ''
      })
    }
    const scan = () => {
      for (const node of document.querySelectorAll('[data-sonner-toast]')) {
        readToast(node)
      }
    }
    const observer = new MutationObserver(() => requestAnimationFrame(scan))
    const start = () => {
      observer.observe(document.body, { childList: true, subtree: true })
      scan()
    }
    if (document.body) {
      start()
      return
    }
    document.addEventListener('DOMContentLoaded', start)
  }, TOAST_RECORD_KEY)
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

async function clearRendererState(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear())
}

async function closeRepoTabs(page: Page, repos: string[]): Promise<void> {
  const closeButtons = page.getByRole('button', { name: /^Close tab / })
  while ((await closeButtons.count()) > 0) {
    await closeButtons.first().click({ force: true })
  }
  await verifyReposClosed(page, repos)
}

export async function runWithFailureSafeCleanup(
  operation: () => Promise<void>,
  cleanupSteps: CleanupStep[]
): Promise<void> {
  let operationError: unknown
  let operationFailed = false
  let cleanupError: unknown
  let cleanupFailed = false

  try {
    await operation()
  } catch (error) {
    operationError = error
    operationFailed = true
  } finally {
    for (const cleanupStep of cleanupSteps) {
      try {
        await cleanupStep()
      } catch (error) {
        if (!cleanupFailed) {
          cleanupError = error
          cleanupFailed = true
        }
      }
    }
  }

  if (operationFailed) {
    throw operationError
  }
  if (cleanupFailed) {
    throw cleanupError
  }
}

export async function runWithFailureSafeFixtureTeardown(
  operation: () => Promise<void>,
  options: FixtureTeardownOptions
): Promise<void> {
  let reposClosed = false
  let appClosed = false
  const closeApp = options.closeApp

  await runWithFailureSafeCleanup(operation, [
    ...(options.beforeCloseRepos ?? []),
    async () => {
      await options.closeRepos()
      reposClosed = true
    },
    ...(options.afterCloseRepos ?? []),
    ...(closeApp
      ? [
          async () => {
            await closeApp()
            appClosed = true
          }
        ]
      : []),
    async () => {
      if (reposClosed || appClosed) {
        await options.removeFixturePaths()
      }
    },
    ...(options.afterRemoveFixturePaths ?? [])
  ])
}

function removeFixturePaths(paths: string[]): void {
  let firstError: unknown
  let failed = false
  for (const fixturePath of uniquePaths(paths)) {
    try {
      fs.rmSync(fixturePath, { recursive: true, force: true })
    } catch (error) {
      if (!failed) {
        firstError = error
        failed = true
      }
    }
  }
  if (failed) {
    throw firstError
  }
}

export async function verifyReposClosed(
  page: Page,
  repos: string[],
  timeout = 10_000
): Promise<void> {
  const repoPaths = uniquePaths(repos)
  await expect
    .poll(
      () =>
        page.evaluate(async (paths) => {
          const api = (
            window as unknown as {
              electronAPI: {
                sidecarRequest: (op: string, body: Record<string, unknown>) => Promise<unknown>
              }
            }
          ).electronAPI

          return Promise.all(
            paths.map(async (repoPath) => {
              const response = (await api.sidecarRequest('getStatus', { repoPath })) as {
                _tag: string
              }
              return { repoPath, tag: response._tag }
            })
          )
        }, repoPaths),
      { message: 'expected every tracked E2E repository to be closed', timeout }
    )
    .toEqual(repoPaths.map((repoPath) => ({ repoPath, tag: 'RepoNotOpen' })))
}

export const test = base.extend<{ harness: AppHarness }, { sharedApp: SharedApp }>({
  sharedApp: [
    async ({}, use) => {
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-user-data-'))
      const trackedRepos = new Set<string>()
      let electronApp: ElectronApplication | undefined
      let page: Page | undefined
      let launches = 0
      let liveApps = 0
      let maximumLiveApps = 0
      let restarts = 0
      const stderr: string[] = []

      const launch = async (): Promise<Page> => {
        if (liveApps !== 0) {
          throw new Error('refusing to launch a second live Electron application')
        }
        launches += 1
        const electronEnv = { ...process.env, NODE_ENV: 'test' }
        delete electronEnv.ELECTRON_RUN_AS_NODE
        if (process.platform === 'linux') {
          electronEnv.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
        }
        const electronArgs = [
          mainEntry,
          `--user-data-dir=${userDataDir}`,
          '--e2e',
          ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : [])
        ]
        electronApp = await electron.launch({
          args: electronArgs,
          env: electronEnv
        })
        liveApps += 1
        maximumLiveApps = Math.max(maximumLiveApps, liveApps)
        electronApp.process().stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()))
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

      const sharedApp: SharedApp = {
        get page() {
          return currentPage()
        },
        app: currentApp,
        launchCount: () => launches,
        inspectLifecycle: () =>
          currentApp().evaluate((_, key): LifecycleSnapshot => {
            const control = (globalThis as Record<string, unknown>)[key] as MainControl | undefined
            if (!control) {
              throw new Error('main E2E control is unavailable; launch the app with --e2e')
            }
            return control.inspectLifecycle()
          }, E2E_CONTROL_KEY),
        reload: async () => {
          const activePage = currentPage()
          await activePage.reload()
          return waitForPage(activePage)
        },
        replaceStore: async (overrides = {}) => {
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
        },
        restart: async () => {
          if (restarts !== 0) {
            throw new Error('only one intentional Electron restart is allowed per E2E run')
          }
          restarts += 1
          await currentPage().close()
          await currentApp().close()
          liveApps -= 1
          electronApp = undefined
          page = undefined
          return launch()
        },
        restoreWindowSize: async () => {
          await setWindowSize(currentApp(), launchWindowWidth, launchWindowHeight)
        },
        readStderr: () => [...stderr],
        stubFolderDialog: async (dir: string | null) => {
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
        restoreFolderDialog: async () => {
          await currentApp().evaluate(({ dialog }, key: string) => {
            const target = globalThis as Record<string, unknown>
            const original = target[key] as typeof dialog.showOpenDialog | undefined
            if (original) {
              dialog.showOpenDialog = original
              delete target[key]
            }
          }, DIALOG_ORIGINAL_KEY)
        },
        trackRepo: (repo: string) => trackedRepos.add(repo),
        untrackRepos: (repos: string[]) => {
          for (const repo of repos) {
            trackedRepos.delete(repo)
          }
        }
      }

      await runWithFailureSafeFixtureTeardown(
        async () => {
          await launch()
          await use(sharedApp)
        },
        {
          beforeCloseRepos: [
            async () => {
              if (!electronApp) {
                return
              }
              const finalLifecycle = await sharedApp.inspectLifecycle()
              if (
                finalLifecycle.sidecarProcessCount !== 1 ||
                finalLifecycle.sidecarRespawnCount !== 0
              ) {
                throw new Error(`unexpected final lifecycle: ${JSON.stringify(finalLifecycle)}`)
              }
            },
            async () => {
              if (electronApp) {
                await sharedApp.restoreFolderDialog()
              }
            },
            async () => {
              if (page && !page.isClosed()) {
                await closeRepoTabs(page, Array.from(trackedRepos))
              }
            },
            async () => {
              if (electronApp) {
                await sharedApp.replaceStore()
              }
            },
            async () => {
              if (page && !page.isClosed()) {
                await clearRendererState(page)
              }
            },
            async () => {
              if (page && !page.isClosed()) {
                await sharedApp.reload()
              }
            }
          ],
          closeRepos: async () => {
            const repos = Array.from(trackedRepos)
            if (repos.length === 0) {
              return
            }
            if (!page || page.isClosed()) {
              throw new Error('cannot close E2E repositories without a live renderer')
            }
            await verifyReposClosed(page, repos)
          },
          closeApp: async () => {
            if (!electronApp) {
              return
            }
            await electronApp.close()
            electronApp = undefined
            page = undefined
            liveApps -= 1
          },
          removeFixturePaths: () => removeFixturePaths(Array.from(trackedRepos)),
          afterRemoveFixturePaths: [
            () => fs.rmSync(userDataDir, { recursive: true, force: true }),
            () => {
              if (maximumLiveApps !== 1) {
                throw new Error(
                  `expected one live Electron application, observed ${maximumLiveApps}`
                )
              }
            },
            () => {
              if (launches > 2) {
                throw new Error(`expected at most two Electron launches, observed ${launches}`)
              }
            },
            () => {
              const forbiddenLog = forbiddenShutdownLogs.find((message) =>
                stderr.join('\n').toLowerCase().includes(message)
              )
              if (forbiddenLog) {
                const matchingLines = stderr
                  .join('\n')
                  .split('\n')
                  .filter((line) => line.toLowerCase().includes(forbiddenLog))
                throw new Error(
                  `intentional lifecycle emitted forbidden stderr:\n${matchingLines.join('\n')}`
                )
              }
            }
          ]
        }
      )
    },
    { scope: 'worker' }
  ],
  harness: async ({ sharedApp }, use, testInfo) => {
    const trackedRepos: string[] = []
    const expectedToasts: ExpectedToastMatch[] = []
    const stderrOffset = sharedApp.readStderr().length

    const harness: AppHarness = {
      toasts: () => readRecordedToasts(sharedApp.page),
      expectToast: async (expected, trigger) => {
        const startIndex = (await readRecordedToasts(sharedApp.page)).length
        await trigger()
        let matched: ReturnType<typeof findToastMatch>
        await expect
          .poll(
            async () => {
              const recorded = await readRecordedToasts(sharedApp.page)
              matched = findToastMatch(recorded, expected, startIndex)
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
        const match = matched as NonNullable<typeof matched>
        expectedToasts.push({ expected, recordedIndex: match.recordedIndex })
        return match.toast
      },
      get page() {
        return sharedApp.page
      },
      app: () => sharedApp.app(),
      launchCount: () => sharedApp.launchCount(),
      mainProcessId: async () => (await sharedApp.inspectLifecycle()).mainPid,
      inspectLifecycle: () => sharedApp.inspectLifecycle(),
      reload: () => sharedApp.reload(),
      restart: () => sharedApp.restart(),
      track: (repo: string) => {
        trackedRepos.push(repo)
        sharedApp.trackRepo(repo)
      },
      seed: async (state: SeedState) => {
        const workspaces = state.workspaces ?? []
        const activeWorkspace = workspaces[workspaces.length - 1] ?? null
        await sharedApp.replaceStore({
          workspaces,
          recentRepos: state.recentRepos ?? [],
          activeWorkspace,
          workingDirectory: activeWorkspace,
          onboardingComplete: state.onboardingComplete ?? false,
          persistedTabRepoPaths: state.tabs ?? [null],
          persistedActiveTabIndex: state.activeIndex ?? 0
        })
      },
      openRepo: async (repo: string, options) => {
        harness.track(repo)
        await harness.seed({
          workspaces: [path.dirname(repo)],
          recentRepos: options?.recentRepos,
          onboardingComplete: true,
          tabs: [repo],
          activeIndex: 0
        })
        return harness.reload()
      },
      openTabs: async (repos: Array<string | null>, options) => {
        for (const repo of repos) {
          if (repo) {
            harness.track(repo)
          }
        }
        const workspaces = uniquePaths(
          repos.filter((repo): repo is string => Boolean(repo)).map((repo) => path.dirname(repo))
        )
        await harness.seed({
          workspaces,
          onboardingComplete: true,
          tabs: repos,
          activeIndex: options?.activeIndex ?? 0
        })
        return harness.reload()
      },
      stubFolderDialog: (dir: string | null) => sharedApp.stubFolderDialog(dir)
    }

    try {
      await runWithFailureSafeFixtureTeardown(
        async () => {
          await sharedApp.restoreFolderDialog()
          await sharedApp.replaceStore()
          await clearRendererState(sharedApp.page)
          await sharedApp.reload()
          await use(harness)
        },
        {
          beforeCloseRepos: [
            // Must run before the teardown reload, which resets the per-document toast recording.
            async () => {
              const recorded = await readRecordedToasts(sharedApp.page)
              const unexplained = findUnexplainedFailureToasts(recorded, expectedToasts)
              if (unexplained.length > 0) {
                const appStderr = sharedApp.readStderr().slice(stderrOffset).join('').trim()
                throw new Error(
                  `unexplained ${unexplained.length > 1 ? 'toasts' : 'toast'} raised during the test:\n` +
                    `${unexplained.map((toast) => `  ${describeToast(toast)}`).join('\n')}` +
                    (appStderr ? `\napplication stderr:\n${appStderr}` : '')
                )
              }
            },
            () => sharedApp.restoreWindowSize(),
            () => sharedApp.restoreFolderDialog(),
            () => closeRepoTabs(sharedApp.page, trackedRepos),
            () => sharedApp.replaceStore(),
            () => clearRendererState(sharedApp.page),
            () => sharedApp.reload().then(() => undefined)
          ],
          closeRepos: () => verifyReposClosed(sharedApp.page, trackedRepos),
          removeFixturePaths: () => {
            removeFixturePaths(trackedRepos)
            sharedApp.untrackRepos(trackedRepos)
          }
        }
      )
    } catch (error) {
      if (testInfo.status === testInfo.expectedStatus) {
        throw error
      }
    }
  }
})

export const refTree = (page: Page) => page.getByTestId('ref-tree-scroll')
export const fileRowCheckbox = (page: Page, file: string) => {
  const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return page
    .getByTestId('status-file-row')
    .filter({ hasText: file })
    .getByRole('checkbox', { name: new RegExp(`^(Stage|Unstage) ${escapedFile}$`) })
}
export const openLocalChanges = (page: Page) =>
  page.getByRole('button', { name: 'Local changes', exact: true }).filter({ visible: true }).click()
export const openHistory = (page: Page) =>
  page.getByRole('button', { name: 'History', exact: true }).filter({ visible: true }).click()
