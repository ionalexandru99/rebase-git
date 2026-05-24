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

  test('renderer reaches the sidecar directly for status + branches using the handed-out config', async () => {
    const repo = createFixtureRepo()
    try {
      const result = await page.evaluate(async (repoPath) => {
        const api = (
          window as unknown as {
            electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>
          }
        ).electronAPI
        const open = (await api.openRepo(repoPath)) as { _tag: string }
        const config = (await api.getSidecarConfig()) as { baseUrl: string; token: string }
        const callOp = async (op: string, token = config.token) => {
          const response = await fetch(`${config.baseUrl}/op/${op}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ repoPath })
          })
          return { httpStatus: response.status, body: await response.json() }
        }
        const status = await callOp('get-status')
        const branches = await callOp('get-branches')
        const unauthorized = await fetch(`${config.baseUrl}/op/get-status`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
          body: JSON.stringify({ repoPath })
        })
        return {
          open: open._tag,
          hasBaseUrl: config.baseUrl.startsWith('http://127.0.0.1:'),
          hasToken: config.token.length > 0,
          statusHttp: status.httpStatus,
          statusTag: (status.body as { _tag: string })._tag,
          branchesTag: (branches.body as { _tag: string })._tag,
          currentBranch: (branches.body as { branches?: { current: string } }).branches?.current,
          unauthorizedStatus: unauthorized.status
        }
      }, repo)

      expect(result.open).toBe('Ok')
      expect(result.hasBaseUrl).toBe(true)
      expect(result.hasToken).toBe(true)
      expect(result.statusHttp).toBe(200)
      expect(result.statusTag).toBe('Ok')
      expect(result.branchesTag).toBe('Ok')
      expect(result.currentBranch).toBe('main')
      expect(result.unauthorizedStatus).toBe(401)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})
