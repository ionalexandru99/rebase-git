import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe.configure({ mode: 'serial' })

test.describe('Git GUI E2E', () => {
  let electronApp: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    // Launch the Electron app
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

  test('shows the onboarding screen on first launch', async () => {
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { name: 'Welcome to Rebase' })).toBeVisible()
  })

  test('shows the select working folder button', async () => {
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('button', { name: 'Select Working Folder' })).toBeVisible()
  })
})
