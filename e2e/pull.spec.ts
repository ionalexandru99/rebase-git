import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import {
  advanceRemote,
  commitSubjects,
  createFixtureRepoWithRemote,
  expect,
  gitIn,
  openHistory,
  openLocalChanges,
  porcelainStatus,
  stashEntries,
  syncButton,
  test
} from './fixtures'

async function syncUntilBehind(page: Page): Promise<void> {
  const sync = syncButton(page)
  await expect(sync).toBeVisible({ timeout: 10_000 })
  await sync.click()
  await expect(sync).toContainText('↓1', { timeout: 15_000 })
}

const LOCAL_README = '# fixture\nlocal edit\n'
const REMOTE_MESSAGE = 'teammate note'

function pinFastForwardPull(repo: string): void {
  gitIn(repo)(['config', 'pull.rebase', 'false'])
}

test('a pull autostashes an overlapping local edit and surfaces the reapply conflict', async ({
  harness
}) => {
  const { repo, remote } = createFixtureRepoWithRemote()
  harness.track(path.dirname(remote))
  pinFastForwardPull(repo)
  advanceRemote(remote, REMOTE_MESSAGE)
  fs.writeFileSync(path.join(repo, 'README.md'), LOCAL_README)
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })
  await openLocalChanges(page)
  await syncUntilBehind(page)

  const toast = await harness.expectToast(
    { type: 'warning', title: 'Pulled, but your uncommitted changes conflicted' },
    () => syncButton(page).click()
  )
  expect(toast.description).toMatch(/kept stash/i)

  expect(commitSubjects(repo)).toEqual([REMOTE_MESSAGE, 'initial'])
  expect(porcelainStatus(repo)).toEqual(['UU README.md'])
  const conflictedReadme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8')
  expect(conflictedReadme).toContain('local edit')
  expect(conflictedReadme).toContain(REMOTE_MESSAGE)
  expect(stashEntries(repo)).toHaveLength(1)
  expect(stashEntries(repo)[0]).toContain('autostash')

  await expect(page.getByRole('status').filter({ hasText: 'Merging' })).toHaveCount(0)
  const conflictBadge = page.getByTestId('status-file-row').getByRole('img', { name: 'conflicted' })
  await expect(conflictBadge).toHaveCount(1)
})

test('a pull succeeds while an unrelated local edit is in the tree', async ({ harness }) => {
  const { repo, remote } = createFixtureRepoWithRemote()
  harness.track(path.dirname(remote))
  pinFastForwardPull(repo)
  const git = gitIn(repo)
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'published\n')
  git(['add', '.'])
  git(['commit', '-m', 'add notes'])
  git(['push', 'origin', 'main'])
  advanceRemote(remote, REMOTE_MESSAGE)
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'scratch\n')
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })
  await openLocalChanges(page)
  await expect(page.getByTestId('status-file-row').filter({ hasText: 'notes.txt' })).toBeVisible({
    timeout: 10_000
  })

  await syncUntilBehind(page)

  await harness.expectToast({ type: 'success', title: 'Pulled' }, () => syncButton(page).click())

  await openHistory(page)
  await expect(page.getByTestId('commit-row').filter({ hasText: REMOTE_MESSAGE })).toBeVisible({
    timeout: 10_000
  })

  expect(commitSubjects(repo)).toEqual([REMOTE_MESSAGE, 'add notes', 'initial'])
  expect(fs.readFileSync(path.join(repo, 'notes.txt'), 'utf8')).toBe('scratch\n')
  expect(porcelainStatus(repo)).toEqual([' M notes.txt'])
})
