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

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'out', 'main', 'index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    })

    page = await electronApp.firstWindow()
  })

  test.afterAll(async () => {
    await electronApp?.close()
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

  test('opens a repo through the sidecar and returns status + branches', async () => {
    const repo = createFixtureRepo()
    try {
      const result = await page.evaluate(async (repoPath) => {
        const api = (window as unknown as { electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>> })
          .electronAPI
        const open = (await api.openRepo(repoPath)) as { _tag: string }
        const status = (await api.getStatus(repoPath)) as { _tag: string }
        const branches = (await api.getBranches(repoPath)) as {
          _tag: string
          branches?: { current: string }
        }
        return { open: open._tag, status: status._tag, branches }
      }, repo)

      expect(result.open).toBe('Ok')
      expect(result.status).toBe('Ok')
      expect(result.branches._tag).toBe('Ok')
      expect(result.branches.branches?.current).toBe('main')
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})
