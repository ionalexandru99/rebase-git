import fs from 'node:fs'
import path from 'node:path'
import {
  commitSubjects,
  createFixtureRepo,
  expect,
  openLocalChanges,
  porcelainStatus,
  stageFileFromRow,
  test
} from './fixtures'

test('launches and opens a real repository through the production process boundary', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('tab', { name: path.basename(repo) })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible()
  await expect(page.getByText('initial').first()).toBeVisible()
})

test('stages and commits a file through the visible UI', async ({ harness }) => {
  const repo = createFixtureRepo()
  fs.writeFileSync(path.join(repo, 'note.txt'), 'hello\n')
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)
  await stageFileFromRow(page, 'note.txt')
  await page.getByRole('textbox', { name: 'Commit message' }).fill('add note')
  await page.getByRole('button', { name: 'Commit 1 file' }).click()

  await expect(page.getByText('Working tree clean')).toBeVisible()
  await harness.close()
  expect(porcelainStatus(repo)).toEqual([])
  expect(commitSubjects(repo)[0]).toBe('add note')
})
