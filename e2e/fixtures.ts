import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright-core'

export { expect }

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.join(currentDir, '..', 'out', 'main', 'index.js')

export type Git = (args: string[]) => void

export function gitIn(repo: string): Git {
  return (args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
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

export interface SeedState {
  workspaces?: string[]
  recentRepos?: string[]
  onboardingComplete?: boolean
  tabs?: Array<string | null>
  activeIndex?: number
}

interface SeedApi {
  addWorkspace: (workspacePath: string) => Promise<string[]>
  openRepo: (repoPath: string) => Promise<unknown>
  setOnboardingComplete: (complete: boolean) => Promise<void>
  setPersistedTabs: (state: { tabs: Array<string | null>; activeIndex: number }) => Promise<void>
}

export interface AppHarness {
  readonly page: Page
  app(): ElectronApplication
  relaunch(): Promise<Page>
  seed(state: SeedState): Promise<void>
  openRepo(repo: string, options?: { recentRepos?: string[] }): Promise<Page>
  openTabs(repos: Array<string | null>, options?: { activeIndex?: number }): Promise<Page>
  track(repo: string): void
  stubFolderDialog(dir: string | null): Promise<void>
}

const uniquePaths = (values: string[]): string[] => Array.from(new Set(values))

export const test = base.extend<{ harness: AppHarness }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature requires the deps arg
  harness: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-user-data-'))
    const trackedRepos: string[] = []
    let electronApp: ElectronApplication
    let page: Page

    const launch = async (): Promise<Page> => {
      electronApp = await electron.launch({
        args: [mainEntry, `--user-data-dir=${userDataDir}`],
        env: { ...process.env, NODE_ENV: 'test' }
      })
      page = await electronApp.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      return page
    }

    await launch()

    const harness: AppHarness = {
      get page() {
        return page
      },
      app: () => electronApp,
      relaunch: async () => {
        await electronApp.close()
        return launch()
      },
      track: (repo: string) => {
        trackedRepos.push(repo)
      },
      seed: async (state: SeedState) => {
        await page.evaluate(async (input: SeedState) => {
          const api = (window as unknown as { electronAPI: SeedApi }).electronAPI
          for (const workspacePath of input.workspaces ?? []) {
            await api.addWorkspace(workspacePath)
          }
          for (const recent of input.recentRepos ?? []) {
            await api.openRepo(recent)
          }
          if (input.onboardingComplete !== undefined) {
            await api.setOnboardingComplete(input.onboardingComplete)
          }
          if (input.tabs !== undefined) {
            await api.setPersistedTabs({ tabs: input.tabs, activeIndex: input.activeIndex ?? 0 })
          }
        }, state)
      },
      openRepo: async (repo: string, options) => {
        trackedRepos.push(repo)
        await harness.seed({
          workspaces: [path.dirname(repo)],
          recentRepos: options?.recentRepos,
          onboardingComplete: true,
          tabs: [repo],
          activeIndex: 0
        })
        return harness.relaunch()
      },
      openTabs: async (repos: Array<string | null>, options) => {
        for (const repo of repos) {
          if (repo) {
            trackedRepos.push(repo)
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
        return harness.relaunch()
      },
      stubFolderDialog: async (dir: string | null) => {
        await electronApp.evaluate(({ dialog }, chosen: string | null) => {
          dialog.showOpenDialog = (async () =>
            chosen
              ? { canceled: false, filePaths: [chosen] }
              : { canceled: true, filePaths: [] }) as typeof dialog.showOpenDialog
        }, dir)
      }
    }

    await use(harness)

    await electronApp.close().catch(() => {})
    fs.rmSync(userDataDir, { recursive: true, force: true })
    for (const repo of trackedRepos) {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  }
})

export const refTree = (page: Page) => page.getByTestId('ref-tree-scroll')
export const fileRowCheckbox = (page: Page, file: string) =>
  page.getByTestId('status-file-row').filter({ hasText: file }).getByRole('checkbox')
export const openLocalChanges = (page: Page) =>
  page
    .getByRole('button', { name: 'Local changes', exact: true })
    .filter({ visible: true })
    .click()
export const openHistory = (page: Page) =>
  page.getByRole('button', { name: 'History', exact: true }).filter({ visible: true }).click()
