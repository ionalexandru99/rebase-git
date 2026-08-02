import fs from 'node:fs'
import path from 'node:path'
import {
  commitSubjects,
  createFixtureRepo,
  expect,
  gitIn,
  gitOut,
  openLocalChanges,
  stageFileFromRow,
  stagedFileRow,
  test
} from './fixtures'

test('blocks a commit with no git identity, fixes it inline, then commits', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  git(['config', '--local', '--unset', 'user.name'])
  git(['config', '--local', '--unset', 'user.email'])
  fs.writeFileSync(path.join(repo, 'note.txt'), 'hello\n')

  const page = await harness.openRepo(repo)
  await openLocalChanges(page)

  await expect(page.getByTestId('missing-identity-notice')).toBeVisible({ timeout: 10_000 })
  await stageFileFromRow(page, 'note.txt')
  await expect(stagedFileRow(page, 'note.txt')).toBeVisible({ timeout: 10_000 })

  const commitButton = page.getByRole('button', { name: /^Commit/ })
  await page.getByRole('textbox', { name: 'Commit message' }).fill('add note once git knows me')
  await expect(commitButton).toBeDisabled()

  await page.getByRole('button', { name: 'Set identity' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio', { name: 'All repositories' })).toBeChecked()
  await dialog.getByLabel('Name').fill('Ada Lovelace')
  await dialog.getByLabel('Email').fill('ada@work.example.com')
  await dialog.getByRole('radio', { name: 'Only this repository' }).check()
  await dialog.getByRole('button', { name: 'Save identity' }).click()

  await expect(dialog).toBeHidden({ timeout: 10_000 })
  await expect(page.getByTestId('missing-identity-notice')).toBeHidden()
  await expect(commitButton).toBeEnabled()
  await commitButton.click()

  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 10_000 })
  expect(commitSubjects(repo)).toEqual(['add note once git knows me', 'initial'])
  expect(gitOut(repo, ['log', '-1', '--format=%an <%ae>'])).toBe(
    'Ada Lovelace <ada@work.example.com>'
  )
})
