import fs from 'node:fs'
import path from 'node:path'
import { createFixtureRepo, expect, openLocalChanges, porcelainStatus, test } from './fixtures'

test('discards a single tracked file through the row context menu and confirm dialog', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\nmodified\n')
  fs.writeFileSync(path.join(repo, 'note.txt'), 'note\n')
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })
  await openLocalChanges(page)

  const readmeRow = page.getByTestId('status-file-row').filter({ hasText: 'README.md' })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })

  await readmeRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Discard changes' }).click()

  const confirmDialog = page.getByRole('dialog')
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: 'Discard' }).click()

  await expect(page.getByTestId('status-file-row').filter({ hasText: 'README.md' })).toHaveCount(0, {
    timeout: 10_000
  })
  await expect(page.getByTestId('status-file-row').filter({ hasText: 'note.txt' })).toBeVisible()
  await expect
    .poll(() => fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), { timeout: 10_000 })
    .not.toContain('modified')

  expect(porcelainStatus(repo)).toEqual(['?? note.txt'])
})

test('discard all empties the working tree to the clean state', async ({ harness }) => {
  const repo = createFixtureRepo()
  fs.writeFileSync(path.join(repo, 'untracked-one.txt'), 'one\n')
  fs.writeFileSync(path.join(repo, 'untracked-two.txt'), 'two\n')
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\nmodified\n')
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })
  await openLocalChanges(page)

  const discardAllTrigger = page.getByRole('button', { name: 'Discard all' })
  await expect(discardAllTrigger).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('status-file-row')).not.toHaveCount(0)
  await discardAllTrigger.click()

  const confirmDialog = page.getByRole('dialog')
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: 'Discard all' }).click()

  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('status-file-row')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /amend last commit/i })).toBeVisible()

  expect(porcelainStatus(repo)).toEqual([])
  expect(fs.existsSync(path.join(repo, 'untracked-one.txt'))).toBe(false)
  expect(fs.existsSync(path.join(repo, 'untracked-two.txt'))).toBe(false)
  expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).not.toContain('modified')
})
