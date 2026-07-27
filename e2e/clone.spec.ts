import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFixtureRepo, expect, test } from './fixtures'

// The sidecar only clones into the user's home tree, so the destination cannot live in the tmpdir
// the other fixtures use.
function createDestinationInHome(): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.homedir(), '.rebase-e2e-clone-')))
}

const fileUrl = (repo: string): string => `file://${repo.split(path.sep).join('/')}`

test('clones a repository from the new tab and lands in it', async ({ harness }) => {
  test.setTimeout(60_000)
  const source = createFixtureRepo()
  harness.track(source)
  const destination = createDestinationInHome()

  try {
    await harness.seed({
      workspaces: [destination],
      onboardingComplete: true,
      tabs: [null],
      activeIndex: 0
    })
    const page = await harness.reload()

    await expect(page.getByRole('heading', { name: 'Open a repository' })).toBeVisible({
      timeout: 10_000
    })
    await page.getByRole('button', { name: 'Clone…' }).first().click()
    await page.getByLabel('Repository URL').fill(fileUrl(source))

    const clonedName = path.basename(source)
    await expect(page.getByText(path.join(destination, clonedName), { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Clone', exact: true }).click()

    const clonedTab = page.getByRole('tab', { name: clonedName })
    await expect(clonedTab).toBeVisible({ timeout: 30_000 })
    await expect(clonedTab).toHaveAttribute('aria-selected', 'true')
    expect(fs.existsSync(path.join(destination, clonedName, '.git'))).toBe(true)
  } finally {
    fs.rmSync(destination, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

test('reports the git failure and stays in the dialog when the source does not exist', async ({
  harness
}) => {
  test.setTimeout(60_000)
  const destination = createDestinationInHome()

  try {
    await harness.seed({
      workspaces: [destination],
      onboardingComplete: true,
      tabs: [null],
      activeIndex: 0
    })
    const page = await harness.reload()

    const missingSource = path.join(os.tmpdir(), 'rebase-e2e-missing-source')
    await page.getByRole('button', { name: 'Clone…' }).first().click()
    await page.getByLabel('Repository URL').fill(fileUrl(missingSource))
    await page.getByRole('button', { name: 'Clone', exact: true }).click()

    await expect(page.getByText(/does not appear to be a git repository/)).toBeVisible({
      timeout: 30_000
    })
    await expect(page.getByRole('tab')).toHaveCount(0)
    expect(fs.existsSync(path.join(destination, path.basename(missingSource)))).toBe(false)
  } finally {
    fs.rmSync(destination, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
