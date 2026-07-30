import fs from 'node:fs'
import path from 'node:path'
import {
  createFixtureRepo,
  expect,
  stagedFileRow,
  gitIn,
  openLocalChanges,
  porcelainStatus,
  stashEntries,
  test
} from './fixtures'

const STASHED_SIDE = 'stashed-side\n'
const COMMITTED_SIDE = 'committed-side\n'

// A conflicted `git stash apply` writes none of the git-dir state files the operation banner is
// built on, so it lands in the app as a bare conflicted index: no operation to name, abort or
// continue. This is the only path that reaches the legacy banner and the neutral side labels.
function createStashConflictRepo(): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const contested = path.join(repo, 'contested.txt')
  fs.writeFileSync(contested, 'base\n')
  git(['add', '.'])
  git(['commit', '-m', 'add contested file'])
  fs.writeFileSync(contested, STASHED_SIDE)
  git(['stash', 'push', '-m', 'work in progress'])
  fs.writeFileSync(contested, COMMITTED_SIDE)
  git(['add', '.'])
  git(['commit', '-m', 'committed side'])
  return repo
}

test('a conflicted stash apply resolves through the legacy banner and neutral side labels', async ({
  harness
}) => {
  const repo = createStashConflictRepo()
  const page = await harness.openRepo(repo)

  const stashRow = page.getByTestId('ref-tree-stash-row')
  await expect(stashRow).toBeVisible({ timeout: 10_000 })
  await expect(stashRow).toContainText('work in progress')

  await stashRow.click({ button: 'right' })
  await harness.expectToast(
    {
      type: 'warning',
      title: 'Applied stash hit conflicts',
      description: 'Resolve the conflicted files, then commit or abort.'
    },
    () => page.getByRole('menuitem', { name: 'Apply' }).click()
  )
  await openLocalChanges(page)

  const banner = page.getByRole('status').filter({ hasText: '1 merge conflict' })
  await expect(banner).toBeVisible({ timeout: 10_000 })
  await expect(banner).toContainText('Resolve the file, then stage it to continue.')
  // Nothing to abort or continue: offering either button here would lie about what git can do.
  await expect(banner.getByRole('button')).toHaveCount(0)

  const conflictRow = page.getByTestId('status-file-row').filter({ hasText: 'contested.txt' })
  await expect(conflictRow.getByRole('img', { name: 'conflicted' })).toBeVisible({ timeout: 10_000 })

  await conflictRow.click({ button: 'right' })
  // With no operation there are no branch names to put on the sides, so the menu falls back to
  // wording that still tells the user which blob is which.
  await expect(page.getByRole('menuitem', { name: 'Keep the current version' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Keep the incoming version' }).click()

  // Taking a side stages the file, and staging every conflict is the whole of "resolved" here.
  await expect(page.getByRole('status').filter({ hasText: 'merge conflict' })).toHaveCount(0, {
    timeout: 10_000
  })
  await expect(stagedFileRow(page, 'contested.txt')).toBeVisible({ timeout: 10_000 })

  expect(fs.readFileSync(path.join(repo, 'contested.txt'), 'utf8')).toBe(STASHED_SIDE)
  expect(porcelainStatus(repo)).toEqual(['M  contested.txt'])
  // apply, not pop — the entry outlives the conflict.
  expect(stashEntries(repo)).toHaveLength(1)
  await expect(stashRow).toBeVisible()
})
