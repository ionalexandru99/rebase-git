import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createFixtureRepo, expect, gitIn, test } from './fixtures'

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

// A clone outlives the document that started it. If a reload does not tear it down, the old git keeps
// writing into the destination and the sidecar keeps the destination claimed — so the retry below,
// which aims at exactly the same folder, is what proves the teardown happened.
test('a reload tears down the clone the previous document started', async ({ harness }) => {
  test.setTimeout(90_000)
  const destination = createDestinationInHome()
  const sourceParent = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-e2e-stalled-'))
  const source = path.join(sourceParent, 'stalled')
  fs.mkdirSync(source)
  const git = gitIn(source)
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(source, 'README.md'), '# stalled\n')
  git(['add', '.'])
  git(['commit', '-m', 'initial'])

  // Accepts the connection and answers nothing, so git sits in the handshake until it is killed.
  const stalledServer = net.createServer((socket) => socket.on('data', () => {}))
  await new Promise<void>((resolve) => stalledServer.listen(0, '127.0.0.1', resolve))
  const stalledPort = (stalledServer.address() as net.AddressInfo).port

  try {
    await harness.seed({
      workspaces: [destination],
      onboardingComplete: true,
      tabs: [null],
      activeIndex: 0
    })
    let page = await harness.reload()

    await page.getByRole('button', { name: 'Clone…' }).first().click()
    await page.getByLabel('Repository URL').fill(`git://127.0.0.1:${stalledPort}/stalled.git`)
    await page.getByRole('button', { name: 'Clone', exact: true }).click()
    await expect(page.getByTestId('clone-progress')).toBeVisible({ timeout: 15_000 })

    page = await harness.reload()

    await expect(page.getByRole('heading', { name: 'Open a repository' })).toBeVisible({
      timeout: 15_000
    })
    await page.getByRole('button', { name: 'Clone…' }).first().click()
    await page.getByLabel('Repository URL').fill(fileUrl(source))
    await page.getByRole('button', { name: 'Clone', exact: true }).click()

    const clonedTab = page.getByRole('tab', { name: 'stalled' })
    await expect(clonedTab).toBeVisible({ timeout: 30_000 })
    expect(fs.readFileSync(path.join(destination, 'stalled', 'README.md'), 'utf8')).toBe(
      '# stalled\n'
    )
  } finally {
    await new Promise<void>((resolve) => stalledServer.close(() => resolve()))
    fs.rmSync(destination, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    fs.rmSync(sourceParent, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
