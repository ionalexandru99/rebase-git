import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createFixtureRepo, expect, gitIn, test } from './fixtures'

// The sidecar only clones into the user's home tree, so the destination cannot live in the tmpdir
// the other fixtures use.
const destinations: string[] = []

function createDestinationInHome(): string {
  const destination = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.homedir(), '.rebase-e2e-clone-'))
  )
  destinations.push(destination)
  return destination
}

// Windows will not unlink a directory the app still holds handles into, and a cloned repo stays open
// until the harness closes its tab — which happens after each test's fixtures are torn down. So the
// destinations are swept once, after the file is finished with them.
test.afterAll(() => {
  for (const destination of destinations) {
    // Sweeping is housekeeping, not an assertion: a temp directory Windows will not unlink yet must
    // not turn a passing run red, and the runner is thrown away regardless.
    try {
      fs.rmSync(destination, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    } catch {}
  }
  destinations.length = 0
})

const fileUrl = (repo: string): string => `file://${repo.split(path.sep).join('/')}`

// Accepts the connection and answers nothing, so a clone sits in the protocol handshake until it is
// killed. Killing git resets the connection rather than closing it on Windows, and an unhandled
// ECONNRESET would fail the run even with every assertion green.
async function listenStalled(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('data', () => {})
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('error', () => {})
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as net.AddressInfo).port,
    // `close` waits for open connections, and the whole point of this server is that they never
    // finish — a clone still hanging on one would turn cleanup into a hung test file.
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy()
        }
        server.close(() => resolve())
      })
  }
}

test('clones a repository from the new tab and lands in it', async ({ harness }) => {
  test.setTimeout(60_000)
  const source = createFixtureRepo()
  harness.track(source)
  const destination = createDestinationInHome()

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

  // The catalogs are read once at startup, so a clone the app did not know about a moment ago has to
  // be registered live — otherwise closing the tab loses the only route back to it.
  await page.getByRole('button', { name: `Close tab ${clonedName}`, exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Open a repository' })).toBeVisible({
    timeout: 15_000
  })
  const recentCard = page.getByTestId('repo-picker-recent').filter({ hasText: clonedName })
  await expect(recentCard.first()).toBeVisible({ timeout: 15_000 })
  await recentCard.first().click()
  await expect(page.getByRole('tab', { name: clonedName })).toBeVisible({ timeout: 30_000 })

  // Hand the clone to the harness so its tab is closed and the repo released before the sweep.
  harness.track(path.join(destination, clonedName))
})

test('reports the git failure and stays in the dialog when the source does not exist', async ({
  harness
}) => {
  test.setTimeout(60_000)
  const destination = createDestinationInHome()

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
})

// A clone outlives the document that started it. If a reload does not tear it down, the old git keeps
// writing into the destination and the sidecar keeps the destination claimed — so the retry below,
// which aims at exactly the same folder, is what proves the teardown happened.
test('a reload tears down the clone the previous document started', async ({ harness }) => {
  test.setTimeout(150_000)
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

  const stalled = await listenStalled()

  try {
    await harness.seed({
      workspaces: [destination],
      onboardingComplete: true,
      tabs: [null],
      activeIndex: 0
    })
    let page = await harness.reload()

    await page.getByRole('button', { name: 'Clone…' }).first().click()
    await page.getByLabel('Repository URL').fill(`git://127.0.0.1:${stalled.port}/stalled.git`)
    await page.getByRole('button', { name: 'Clone', exact: true }).click()
    await expect(page.getByTestId('clone-progress')).toBeVisible({ timeout: 15_000 })

    page = await harness.reload()

    await expect(page.getByRole('heading', { name: 'Open a repository' })).toBeVisible({
      timeout: 15_000
    })
    await page.getByRole('button', { name: 'Clone…' }).first().click()
    await page.getByLabel('Repository URL').fill(fileUrl(source))

    // The contract is that the destination comes back, not that it comes back instantly: killing the
    // process tree and clearing what git left takes measurably longer on Windows. Retrying still
    // fails the test if the teardown never happens — and reports what the dialog said when it does,
    // because "already being cloned" and "already exists" point at different halves of the teardown.
    try {
      await expect(async () => {
        await page.getByRole('button', { name: 'Clone', exact: true }).click()
        await expect(page.getByRole('tab', { name: 'stalled' })).toBeVisible({ timeout: 5_000 })
      }).toPass({ timeout: 60_000, intervals: [1_000] })
    } catch (error) {
      const reported = await page
        .getByTestId('clone-error')
        .textContent()
        .catch(() => null)
      const leftBehind = fs.existsSync(path.join(destination, 'stalled'))
        ? JSON.stringify(fs.readdirSync(path.join(destination, 'stalled')))
        : '(gone)'
      throw new Error(
        `the destination never came back after the reload; the dialog reported: ${reported ?? '(nothing)'}; the destination holds: ${leftBehind}`,
        { cause: error }
      )
    }
    // Windows checks out with CRLF by default, and the point here is that the working tree arrived,
    // not which line ending git chose for it.
    const readme = fs.readFileSync(path.join(destination, 'stalled', 'README.md'), 'utf8')
    expect(readme.replace(/\r\n/g, '\n')).toBe('# stalled\n')
    harness.track(path.join(destination, 'stalled'))
  } finally {
    await stalled.close()
    fs.rmSync(sourceParent, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
