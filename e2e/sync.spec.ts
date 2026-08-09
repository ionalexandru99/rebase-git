import fs from 'node:fs'
import path from 'node:path'
import {
  advanceRemote,
  commitSubjects,
  createFixtureRepo,
  createFixtureRepoWithRemote,
  expect,
  gitIn,
  makeBranchAheadOfOrigin,
  revParse,
  syncButton,
  test
} from './fixtures'

test('fetches remote work and refreshes the tracking state through the visible UI', async ({
  harness
}) => {
  const { repo, remote } = createFixtureRepoWithRemote()
  harness.track(path.dirname(remote))
  const page = await harness.openRepo(repo)

  advanceRemote(remote, 'remote work to fetch')
  await harness.expectToast({ type: 'success', title: 'Fetched from remote' }, () =>
    page.getByRole('button', { name: 'Fetch', exact: true }).click()
  )

  await expect(syncButton(page)).toContainText('↓1', { timeout: 10_000 })
  expect(revParse(repo, 'refs/remotes/origin/main')).toBe(revParse(remote, 'refs/heads/main'))
})

test('normally pushes an ahead branch to its real remote', async ({ harness }) => {
  const { repo, remote } = createFixtureRepoWithRemote()
  harness.track(path.dirname(remote))
  const git = gitIn(repo)
  fs.writeFileSync(path.join(repo, 'publish.txt'), 'publish\n')
  git(['add', '.'])
  git(['commit', '-m', 'publish normally'])
  const page = await harness.openRepo(repo)

  await expect(syncButton(page)).toContainText('↑1', { timeout: 10_000 })
  await harness.expectToast({ type: 'success', title: 'Pushed' }, () => syncButton(page).click())

  await expect(syncButton(page)).not.toContainText('↑1', { timeout: 10_000 })
  expect(revParse(remote, 'refs/heads/main')).toBe(revParse(repo, 'HEAD'))
})

test('a Sync that pushes a repo with no remote surfaces an error toast', async ({ harness }) => {
  const repo = createFixtureRepo()
  makeBranchAheadOfOrigin(repo)
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })

  const headBefore = revParse(repo, 'HEAD')

  const sync = syncButton(page)
  await expect(sync).toContainText('↑1', { timeout: 10_000 })
  const toast = await harness.expectToast({ type: 'error', title: 'Push failed' }, () =>
    sync.click()
  )
  expect(toast.description).not.toBe('')

  expect(revParse(repo, 'HEAD')).toBe(headBefore)
  expect(commitSubjects(repo)).toEqual(['work to publish', 'initial'])
})
