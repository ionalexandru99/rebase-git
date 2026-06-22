import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createFixtureRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-repo-'))
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n')
  git(['add', '.'])
  git(['commit', '-m', 'initial'])
  return repo
}

test.describe.configure({ mode: 'serial' })

test.describe('Git GUI E2E', () => {
  let electronApp: ElectronApplication
  let page: Page
  let userDataDir: string

  test.beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-user-data-'))
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'out', 'main', 'index.js'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    })

    page = await electronApp.firstWindow()
  })

  test.afterAll(async () => {
    await electronApp?.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  })

  test('window opens and title is correct', async () => {
    const title = await page.title()
    expect(title).toBeTruthy()
  })

  test('window becomes visible after ready-to-show', async () => {
    await expect
      .poll(
        () =>
          electronApp.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0]
            return win ? win.isVisible() : false
          }),
        { timeout: 10_000 }
      )
      .toBe(true)
  })

  test('shows the onboarding screen on first launch', async () => {
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { name: 'Welcome to Rebase' })).toBeVisible()
  })

  test('shows the select working folder button', async () => {
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('button', { name: 'Select Working Folder' })).toBeVisible()
  })

  test('renderer reaches the sidecar through the preload proxy for status + branches', async () => {
    const repo = createFixtureRepo()
    try {
      const result = await page.evaluate(async (repoPath) => {
        const api = (
          window as unknown as {
            electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>
          }
        ).electronAPI
        const open = (await api.openRepo(repoPath)) as { _tag: string }
        const status = (await api.sidecarRequest('get-status', { repoPath })) as { _tag: string }
        const branches = (await api.sidecarRequest('get-branches', { repoPath })) as {
          _tag: string
          branches?: { current: string }
        }
        return {
          open: open._tag,
          exposesSidecarConfig: 'getSidecarConfig' in api,
          statusTag: status._tag,
          branchesTag: branches._tag,
          currentBranch: branches.branches?.current
        }
      }, repo)

      expect(result.open).toBe('Ok')
      expect(result.exposesSidecarConfig).toBe(false)
      expect(result.statusTag).toBe('Ok')
      expect(result.branchesTag).toBe('Ok')
      expect(result.currentBranch).toBe('main')
    } finally {
      await page
        .evaluate(async (repoPath) => {
          const api = (
            window as unknown as {
              electronAPI?: { closeRepo?: (path: string) => Promise<unknown> }
            }
          ).electronAPI
          await api?.closeRepo?.(repoPath)
        }, repo)
        .catch(() => {})
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  test('commits through the typed RPC write seam end to end', async () => {
    const repo = createFixtureRepo()
    fs.writeFileSync(path.join(repo, 'second.txt'), 'second\n')
    try {
      const result = await page.evaluate(async (repoPath) => {
        const api = (
          window as unknown as {
            electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>
          }
        ).electronAPI
        const open = (await api.openRepo(repoPath)) as { _tag: string }
        await api.sidecarRequest('stageFile', { repoPath, file: 'second.txt' })
        const committed = (await api.sidecarRequest('commit', {
          repoPath,
          message: 'second from e2e'
        })) as { _tag: string; result?: { commit?: string } }

        const unopened = (await api.sidecarRequest('commit', {
          repoPath: '/no/such/path/from/e2e',
          message: 'never lands'
        })) as { _tag: string }

        return {
          open: open._tag,
          committedTag: committed._tag,
          committedHash: committed.result?.commit ?? '',
          unopenedTag: unopened._tag
        }
      }, repo)

      expect(result.open).toBe('Ok')
      expect(result.committedTag).toBe('Ok')
      expect(result.committedHash).toBeTruthy()
      expect(result.unopenedTag).toBe('GitError')
    } finally {
      await page
        .evaluate(async (repoPath) => {
          const api = (
            window as unknown as {
              electronAPI?: { closeRepo?: (path: string) => Promise<unknown> }
            }
          ).electronAPI
          await api?.closeRepo?.(repoPath)
        }, repo)
        .catch(() => {})
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  test('restored repo renders branches and history in the UI', async () => {
    const repo = createFixtureRepo()
    try {
      await page.evaluate(
        async ({ repoPath, workspacePath }) => {
          const api = (
            window as unknown as {
              electronAPI: {
                addWorkspace: (path: string) => Promise<string[]>
                setOnboardingComplete: (complete: boolean) => Promise<void>
                setPersistedTabs: (state: {
                  tabs: Array<string | null>
                  activeIndex: number
                }) => Promise<void>
              }
            }
          ).electronAPI
          await api.addWorkspace(workspacePath)
          await api.setOnboardingComplete(true)
          await api.setPersistedTabs({ tabs: [repoPath], activeIndex: 0 })
        },
        { repoPath: repo, workspacePath: path.dirname(repo) }
      )

      await page.reload({ waitUntil: 'domcontentloaded' })

      await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible()
      await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({
        timeout: 10_000
      })
      await expect(page.getByText('initial').first()).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(/0 commits/)).not.toBeVisible()
    } finally {
      await page
        .evaluate(async (repoPath) => {
          const api = (
            window as unknown as {
              electronAPI?: { closeRepo?: (path: string) => Promise<unknown> }
            }
          ).electronAPI
          await api?.closeRepo?.(repoPath)
        }, repo)
        .catch(() => {})
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})
