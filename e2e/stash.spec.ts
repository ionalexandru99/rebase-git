import fs from 'node:fs'
import path from 'node:path'
import {
  createFixtureRepo,
  expect,
  gitIn,
  stageFileFromRow,
  stagedFileRow,
  unstagedFileRow,
  openLocalChanges,
  porcelainStatus,
  stashEntries,
  test
} from './fixtures'

test('stashes staged files through the StashControl and lists the stash in the sidebar', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  fs.writeFileSync(path.join(repo, 'note.txt'), 'scratch\n')
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })
  await openLocalChanges(page)

  await expect(unstagedFileRow(page, 'note.txt')).toBeVisible({ timeout: 10_000 })
  await stageFileFromRow(page, 'note.txt')
  await expect(stagedFileRow(page, 'note.txt')).toBeVisible({ timeout: 10_000 })

  const stashTrigger = page.getByRole('button', { name: /^Stash/ })
  await expect(stashTrigger).toBeEnabled({ timeout: 10_000 })
  await stashTrigger.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByRole('textbox').fill('wip-stash')
  await dialog.getByRole('button', { name: 'Stash' }).click()

  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 10_000 })

  const stashRow = page.getByTestId('ref-tree-stash-row')
  await expect(stashRow).toBeVisible({ timeout: 10_000 })
  await expect(stashRow).toContainText('wip-stash', { timeout: 10_000 })

  expect(stashEntries(repo)).toHaveLength(1)
  expect(stashEntries(repo)[0]).toContain('wip-stash')
  expect(porcelainStatus(repo)).toEqual([])
})

test('applies, pops, and drops stashes from the sidebar against the real repository', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)

  fs.writeFileSync(path.join(repo, 'applied.txt'), 'applied\n')
  git(['add', '.'])
  git(['stash', 'push', '-m', 'apply-work'])
  fs.writeFileSync(path.join(repo, 'popped.txt'), 'popped\n')
  git(['add', '.'])
  git(['stash', 'push', '-m', 'pop-work'])
  fs.writeFileSync(path.join(repo, 'dropped.txt'), 'dropped\n')
  git(['add', '.'])
  git(['stash', 'push', '-m', 'drop-work'])

  const page = await harness.openRepo(repo)
  const stashRow = (message: string) =>
    page.getByTestId('ref-tree-stash-row').filter({ hasText: message })

  await expect(stashRow('drop-work')).toBeVisible({ timeout: 10_000 })
  await stashRow('drop-work').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Drop' }).click()
  const dropDialog = page.getByRole('dialog')
  await expect(dropDialog).toContainText('Drop stash@{0}?')
  await dropDialog.getByRole('button', { name: 'Drop' }).click()
  await expect(stashRow('drop-work')).toHaveCount(0, { timeout: 10_000 })
  expect(stashEntries(repo)).toHaveLength(2)

  await stashRow('pop-work').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pop' }).click()
  await expect(stashRow('pop-work')).toHaveCount(0, { timeout: 10_000 })
  await expect.poll(() => fs.existsSync(path.join(repo, 'popped.txt'))).toBe(true)
  expect(stashEntries(repo)).toHaveLength(1)

  await stashRow('apply-work').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Apply' }).click()
  await expect.poll(() => fs.existsSync(path.join(repo, 'applied.txt'))).toBe(true)
  await expect(stashRow('apply-work')).toBeVisible({ timeout: 10_000 })
  expect(stashEntries(repo)).toHaveLength(1)
  expect(porcelainStatus(repo)).toEqual(['A  applied.txt', 'A  popped.txt'])
})
