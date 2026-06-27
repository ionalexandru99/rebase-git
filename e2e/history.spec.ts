import fs from 'node:fs'
import path from 'node:path'
import { createFixtureRepo, expect, fileRowCheckbox, gitIn, openLocalChanges, test } from './fixtures'

test('resets the branch to an earlier commit via the history context menu', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n')
  git(['add', '.'])
  git(['commit', '-m', 'second commit'])
  const page = await harness.openRepo(repo)

  await expect(page.getByText('second commit')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/\b2 commits\b/)).toBeVisible({ timeout: 10_000 })

  await page.getByText('initial').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Reset branch here \(soft\)/ }).click()

  await expect(page.getByText(/\b1 commit\b/)).toBeVisible({ timeout: 10_000 })

  await openLocalChanges(page)
  await expect(fileRowCheckbox(page, 'a.txt')).toBeChecked({ timeout: 10_000 })
})

test('typing in the commit filter dims non-matching rows without removing them', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  fs.writeFileSync(path.join(repo, 'alpha.txt'), 'alpha\n')
  git(['add', '.'])
  git(['commit', '-m', 'alpha change'])
  fs.writeFileSync(path.join(repo, 'beta.txt'), 'beta\n')
  git(['add', '.'])
  git(['commit', '-m', 'beta change'])
  const page = await harness.openRepo(repo)

  const alphaRow = page.getByTestId('commit-row').filter({ hasText: 'alpha change' })
  const betaRow = page.getByTestId('commit-row').filter({ hasText: 'beta change' })
  await expect(alphaRow).toBeVisible({ timeout: 10_000 })
  await expect(betaRow).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/3 commits/)).toBeVisible({ timeout: 10_000 })

  await page.getByRole('textbox', { name: 'Filter commits' }).fill('alpha')

  await expect(alphaRow).toHaveCSS('opacity', '1', { timeout: 10_000 })
  await expect(betaRow).toHaveCSS('opacity', '0.35', { timeout: 10_000 })
  await expect(page.getByText(/3 commits/)).toBeVisible()
})
