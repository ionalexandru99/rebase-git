import type { AddressInfo } from 'node:net'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureRepo, expect, gitIn, test } from './fixtures'

// Auth is system-only and Rebase never prompts, so the failure a misconfigured machine actually hits
// is a remote that asks for credentials nobody answers. A 401 with a Basic challenge reproduces it
// exactly: git looks for a helper, finds none, and gives up with prompts disabled.
async function startChallengingRemote(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_request, response) => {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Git"' })
    response.end('unauthorized')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/fixture.git`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

// The machine running the test may have a credential helper of its own; an empty repo-local helper
// clears the inherited chain so the repo behaves like an unconfigured machine.
function withRemote(repo: string, url: string): void {
  const git = gitIn(repo)
  git(['remote', 'add', 'origin', url])
  git(['config', 'credential.helper', ''])
}

async function captureOpenedHelpLinks(harness: {
  app: () => { evaluate: (fn: (electron: typeof import('electron')) => unknown) => Promise<unknown> }
}): Promise<void> {
  await harness.app().evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as Record<string, unknown>).__openedHelpLinks = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
}

test('a remote that asks for credentials names the missing helper and links to the fix', async ({
  harness
}) => {
  const remote = await startChallengingRemote()
  try {
    const repo = createFixtureRepo()
    withRemote(repo, remote.url)
    const page = await harness.openRepo(repo)
    await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({
      timeout: 10_000
    })
    await captureOpenedHelpLinks(harness)

    const pushButton = page.getByRole('button', { name: 'Push', exact: true })
    await expect(pushButton).toBeVisible({ timeout: 10_000 })
    const toast = await harness.expectToast(
      {
        type: 'error',
        title: 'Pushed failed',
        description: /credential helper/
      },
      () => pushButton.click()
    )

    expect(toast.description).toContain('127.0.0.1')
    expect(toast.description).toContain('Rebase runs Git without prompts')

    // Hovering holds the toast open the way reaching for its button does — without it the auto-dismiss
    // races the click. Scoped to the toast: the same action also sits in the tab banner.
    const toaster = page.locator('[data-sonner-toaster]')
    await toaster.hover()
    const helpButton = toaster.getByRole('button', { name: 'Set up a credential helper' })
    await expect(helpButton).toBeVisible()
    await helpButton.click()

    await expect
      .poll(() =>
        harness.app().evaluate(() => (globalThis as Record<string, unknown>).__openedHelpLinks)
      )
      .toEqual(['https://git-scm.com/docs/gitcredentials'])
  } finally {
    await remote.close()
  }
})

test('a fetch that cannot authenticate explains itself in the tab banner', async ({
  harness
}) => {
  const remote = await startChallengingRemote()
  try {
    const repo = createFixtureRepo()
    withRemote(repo, remote.url)
    const page = await harness.openRepo(repo)
    await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({
      timeout: 10_000
    })

    const fetchButton = page.getByRole('button', { name: 'Fetch', exact: true })
    await expect(fetchButton).toBeVisible({ timeout: 10_000 })
    await harness.expectToast(
      { type: 'error', title: 'Fetch failed', description: /credential helper/ },
      () => fetchButton.click()
    )

    const banner = page.getByText(/^Fetch failed:/)
    await expect(banner).toBeVisible({ timeout: 10_000 })
    await expect(banner).toContainText('no credential helper answered')
    // Scoped to the banner: the toast raised by the same fetch offers the identical action.
    await expect(
      page.getByRole('alert').getByRole('button', { name: 'Set up a credential helper' })
    ).toBeVisible()
  } finally {
    await remote.close()
  }
})

test('an unreachable remote is reported as a network failure, not a silent no-op', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  // Port 9 (discard) is reserved and closed everywhere, so the connection is refused immediately.
  withRemote(repo, 'http://127.0.0.1:9/fixture.git')
  const page = await harness.openRepo(repo)
  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })

  const pushButton = page.getByRole('button', { name: 'Push', exact: true })
  await expect(pushButton).toBeVisible({ timeout: 10_000 })
  const toast = await harness.expectToast(
    { type: 'error', title: 'Pushed failed', description: /Couldn't reach 127\.0\.0\.1/ },
    () => pushButton.click()
  )

  expect(toast.description).toContain('network')
})

test('a repository with no remote says so instead of reporting a raw git failure', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const page = await harness.openRepo(repo)
  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })

  const pushButton = page.getByRole('button', { name: 'Push', exact: true })
  await expect(pushButton).toBeVisible({ timeout: 10_000 })
  const toast = await harness.expectToast(
    {
      type: 'error',
      title: 'Pushed failed',
      description:
        'This repository has no remote named origin, so there is nothing to sync with. Add one, then try again.'
    },
    () => pushButton.click()
  )

  expect(toast.description).not.toContain('fatal:')
})

test('a checkout blocked by uncommitted work names the files in the way', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  git(['checkout', '-b', 'feature'])
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture on feature\n')
  fs.writeFileSync(path.join(repo, 'notes.md'), 'feature notes\n')
  git(['add', '.'])
  git(['commit', '-m', 'feature edits'])
  git(['checkout', 'main'])
  // Uncommitted edits to the same files main and feature disagree on: a checkout would overwrite them.
  fs.writeFileSync(path.join(repo, 'README.md'), '# local work in progress\n')
  fs.writeFileSync(path.join(repo, 'notes.md'), 'local notes\n')

  const page = await harness.openRepo(repo)
  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })

  const featureLeaf = page.getByTitle('feature', { exact: true })
  await expect(featureLeaf).toBeVisible({ timeout: 10_000 })
  const toast = await harness.expectToast(
    { type: 'error', title: /failed$/, description: /would be overwritten/ },
    () => featureLeaf.dblclick()
  )

  expect(toast.description).toContain('Uncommitted changes to README.md')
  expect(toast.description).toContain('untracked notes.md')
})
