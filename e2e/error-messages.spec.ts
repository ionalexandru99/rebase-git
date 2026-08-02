import type { AddressInfo } from 'node:net'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {
  createFixtureRepo,
  expect,
  gitIn,
  makeBranchAheadOfOrigin,
  syncButton,
  test
} from './fixtures'

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

function withRemote(repo: string, url: string): void {
  const git = gitIn(repo)
  git(['remote', 'add', 'origin', url])
  git(['config', 'credential.helper', ''])
}

test('a remote that asks for credentials names what is missing', async ({ harness }) => {
  const remote = await startChallengingRemote()
  try {
    const repo = createFixtureRepo()
    withRemote(repo, remote.url)
    makeBranchAheadOfOrigin(repo)
    const page = await harness.openRepo(repo)
    await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({
      timeout: 10_000
    })

    const sync = syncButton(page)
    await expect(sync).toContainText('↑1', { timeout: 10_000 })
    const toast = await harness.expectToast(
      {
        type: 'error',
        title: 'Push failed',
        description: /credential helper/
      },
      () => sync.click()
    )

    expect(toast.description).toContain('127.0.0.1')
    expect(toast.description).toContain('Rebase runs Git without prompts')
  } finally {
    await remote.close()
  }
})

test('a fetch that cannot authenticate reports through the toast alone', async ({ harness }) => {
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

    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    await remote.close()
  }
})

test('an unreachable remote is reported as a network failure, not a silent no-op', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  withRemote(repo, 'http://127.0.0.1:9/fixture.git')
  makeBranchAheadOfOrigin(repo)
  const page = await harness.openRepo(repo)
  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })

  const sync = syncButton(page)
  await expect(sync).toContainText('↑1', { timeout: 10_000 })
  const toast = await harness.expectToast(
    { type: 'error', title: 'Push failed', description: /Couldn't reach 127\.0\.0\.1/ },
    () => sync.click()
  )

  expect(toast.description).toContain('network')
})

test('a repository with no remote says so instead of reporting a raw git failure', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  makeBranchAheadOfOrigin(repo)
  const page = await harness.openRepo(repo)
  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })

  const sync = syncButton(page)
  await expect(sync).toContainText('↑1', { timeout: 10_000 })
  const toast = await harness.expectToast(
    {
      type: 'error',
      title: 'Push failed',
      description:
        'This repository has no remote named origin, so there is nothing to sync with. Add one, then try again.'
    },
    () => sync.click()
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

  expect(toast.description).toContain('Uncommitted changes (README.md)')
  expect(toast.description).toContain('untracked files (notes.md)')
})
