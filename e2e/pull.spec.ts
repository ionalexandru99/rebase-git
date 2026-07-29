import fs from 'node:fs'
import path from 'node:path'
import {
  advanceRemote,
  commitSubjects,
  createFixtureRepoWithRemote,
  expect,
  gitIn,
  openHistory,
  openLocalChanges,
  porcelainStatus,
  test
} from './fixtures'

const LOCAL_README = '# fixture\nlocal edit\n'
const REMOTE_MESSAGE = 'teammate note'

// The app pulls with `--ff-only`, but a developer whose global config sets `pull.rebase=true` makes
// git run its rebase preconditions anyway. Pinning the repo keeps these tests measuring the app
// instead of whatever git config the machine running them happens to carry.
function pinFastForwardPull(repo: string): void {
  gitIn(repo)(['config', 'pull.rebase', 'false'])
}

test('a pull that would overwrite a local edit fails without touching the file', async ({
  harness
}) => {
  const { repo, remote } = createFixtureRepoWithRemote()
  harness.track(path.dirname(remote))
  pinFastForwardPull(repo)
  advanceRemote(remote, REMOTE_MESSAGE)
  // The remote commit and the uncommitted edit touch the same file, so git refuses before it can
  // produce a conflict to resolve.
  fs.writeFileSync(path.join(repo, 'README.md'), LOCAL_README)
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })
  await openLocalChanges(page)

  const toast = await harness.expectToast({ type: 'error', title: 'Pulled failed' }, () =>
    page.getByRole('button', { name: 'Pull', exact: true }).click()
  )
  expect(toast.description).toMatch(/would be overwritten/i)

  // Refusing is only safe if it is also inert: the edit and the branch have to be exactly as before.
  expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe(LOCAL_README)
  expect(porcelainStatus(repo)).toEqual([' M README.md'])
  expect(commitSubjects(repo)).toEqual(['initial'])

  await expect(page.getByRole('status').filter({ hasText: 'Merging' })).toHaveCount(0)
  const conflictBadge = page.getByTestId('status-file-row').getByRole('img', { name: 'conflicted' })
  await expect(conflictBadge).toHaveCount(0)
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

  await harness.expectToast({ type: 'success', title: 'Pulled' }, () =>
    page.getByRole('button', { name: 'Pull', exact: true }).click()
  )

  await openHistory(page)
  await expect(page.getByTestId('commit-row').filter({ hasText: REMOTE_MESSAGE })).toBeVisible({
    timeout: 10_000
  })

  expect(commitSubjects(repo)).toEqual([REMOTE_MESSAGE, 'add notes', 'initial'])
  expect(fs.readFileSync(path.join(repo, 'notes.txt'), 'utf8')).toBe('scratch\n')
  expect(porcelainStatus(repo)).toEqual([' M notes.txt'])
})
