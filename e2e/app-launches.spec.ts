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

  test('shows the open repository button', async () => {
    // Wait for the app to render
    await page.waitForLoadState('domcontentloaded')

    // The app should show the "Open Repository" button in the welcome screen
    // (the centered one, not the header button)
    const welcomeButton = page.getByRole('button', { name: 'Open Repository' }).nth(1)
    await expect(welcomeButton).toBeVisible()
  })

  test('shows the welcome message', async () => {
    await page.waitForLoadState('domcontentloaded')

    const welcomeText = page.locator('text=Open a git repository to get started')
    await expect(welcomeText).toBeVisible()
  })
})
