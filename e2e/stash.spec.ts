import fs from 'node:fs'
import path from 'node:path'
import {
  createFixtureRepo,
  expect,
  fileRowCheckbox,
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

  const note = fileRowCheckbox(page, 'note.txt')
  await expect(note).toBeVisible({ timeout: 10_000 })
  await note.click()
  await expect(note).toBeChecked({ timeout: 10_000 })

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
