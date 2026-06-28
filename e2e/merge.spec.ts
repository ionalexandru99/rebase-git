import fs from 'node:fs'
import path from 'node:path'
import { createFixtureRepo, expect, gitIn, openLocalChanges, refTree, test } from './fixtures'

test('merging a non-conflicting branch from the ref tree adds a merge commit to history', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  git(['checkout', '-b', 'feature'])
  fs.writeFileSync(path.join(repo, 'feature-only.txt'), 'feature\n')
  git(['add', '.'])
  git(['commit', '-m', 'feature work'])
  git(['checkout', 'main'])
  fs.writeFileSync(path.join(repo, 'main-only.txt'), 'main\n')
  git(['add', '.'])
  git(['commit', '-m', 'main work'])
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('main work').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/2 commits/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('feature work')).toBeHidden()

  await refTree(page).getByTitle('feature', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Merge into main/ }).click()

  await expect(page.getByText(/Merge branch 'feature'/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Merge commit with 2 parents')).toBeVisible({ timeout: 10_000 })

  // The merge collapses its side branch by default, so 'feature work' stays hidden until expanded.
  await expect(page.getByText('feature work')).toBeHidden()
  await expect(page.getByText(/3 commits/)).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Expand merge side branch' }).click()
  await expect(page.getByText('feature work').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/4 commits/)).toBeVisible({ timeout: 10_000 })
})

test('merging a conflicting branch surfaces the conflict warning and leaves the tree dirty', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  git(['checkout', '-b', 'feature'])
  fs.writeFileSync(path.join(repo, 'conflict.txt'), 'feature-side\n')
  git(['add', '.'])
  git(['commit', '-m', 'feature side'])
  git(['checkout', 'main'])
  fs.writeFileSync(path.join(repo, 'conflict.txt'), 'main-side\n')
  git(['add', '.'])
  git(['commit', '-m', 'main side'])
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })

  await refTree(page).getByTitle('feature', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Merge into main/ }).click()

  await expect(page.getByText(/Merged feature hit conflicts/)).toBeVisible({ timeout: 10_000 })

  await openLocalChanges(page)

  const conflictRow = page.getByTestId('status-file-row').filter({ hasText: 'conflict.txt' })
  await expect(conflictRow.getByRole('img', { name: 'conflicted' })).toBeVisible({
    timeout: 10_000
  })
})
