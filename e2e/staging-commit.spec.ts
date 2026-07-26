import fs from 'node:fs'
import path from 'node:path'
import {
  commitSubjects,
  createFixtureRepo,
  expect,
  fileRowCheckbox,
  openHistory,
  openLocalChanges,
  porcelainStatus,
  test
} from './fixtures'

test('stages a file via checkbox and commits through the UI, draining the tree into history', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  fs.writeFileSync(path.join(repo, 'note.txt'), 'hello\n')
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)

  const note = fileRowCheckbox(page, 'note.txt')
  await expect(note).toBeVisible({ timeout: 10_000 })
  await note.click()
  await expect(note).toBeChecked({ timeout: 10_000 })

  const commitButton = page.getByRole('button', { name: /^Commit/ })
  await expect(commitButton).toHaveText(/Commit 1 file/)

  const commitMessage = page.getByRole('textbox', { name: 'Commit message' })
  await commitMessage.fill('add note from ui')
  await expect(commitButton).toBeEnabled()
  await commitButton.click()

  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 10_000 })

  await openHistory(page)
  await expect(page.getByText('add note from ui').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/2 commits/)).toBeVisible({ timeout: 10_000 })

  expect(commitSubjects(repo)).toEqual(['add note from ui', 'initial'])
  expect(porcelainStatus(repo)).toEqual([])
})

test('Stage all / Unstage all toggles every row and gates the Commit button', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  fs.appendFileSync(path.join(repo, 'README.md'), 'second line\n')
  fs.writeFileSync(path.join(repo, 'note.txt'), 'note\n')
  fs.writeFileSync(path.join(repo, 'second.txt'), 'second\n')
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })
  await openLocalChanges(page)

  const readme = fileRowCheckbox(page, 'README.md')
  const note = fileRowCheckbox(page, 'note.txt')
  const second = fileRowCheckbox(page, 'second.txt')

  await expect(readme).toBeVisible({ timeout: 10_000 })
  await expect(readme).not.toBeChecked()
  await expect(note).not.toBeChecked()
  await expect(second).not.toBeChecked()

  const subtitle = page.getByText(/\d+ files.*\d+ staged/)
  await expect(subtitle).toHaveText(/3 files.*0 staged/)

  const message = page.getByRole('textbox', { name: 'Commit message' })
  const commitButton = page.getByRole('button', { name: /^Commit/ })

  await message.fill('msg')
  await expect(commitButton).toHaveText('Commit')
  await expect(commitButton).toBeDisabled()

  await page.getByRole('button', { name: 'Stage all', exact: true }).click()

  await expect(readme).toBeChecked({ timeout: 10_000 })
  await expect(note).toBeChecked()
  await expect(second).toBeChecked()
  await expect(subtitle).toHaveText(/3 files.*3 staged/)
  await expect(page.getByRole('button', { name: 'Unstage all', exact: true })).toBeVisible()
  await expect(commitButton).toHaveText('Commit 3 files')
  await expect(commitButton).toBeEnabled()

  await message.fill('')
  await expect(commitButton).toBeDisabled()

  await message.fill('msg')
  await expect(commitButton).toBeEnabled()

  await page.getByRole('button', { name: 'Unstage all', exact: true }).click()

  await expect(readme).not.toBeChecked({ timeout: 10_000 })
  await expect(note).not.toBeChecked()
  await expect(second).not.toBeChecked()
  await expect(subtitle).toHaveText(/3 files.*0 staged/)
  await expect(page.getByRole('button', { name: 'Stage all', exact: true })).toBeVisible()
  await expect(commitButton).toHaveText('Commit')
  await expect(commitButton).toBeDisabled()
})

test('selecting a modified file renders diff hunks and staging a hunk flips its checkbox', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  fs.appendFileSync(
    path.join(repo, 'README.md'),
    'line one\nline two\nline three\nline four\nline five\n'
  )
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)

  const fileRow = page.getByTestId('status-file-row')
  const fileButton = fileRow.getByRole('button', { name: 'README.md' })
  await expect(fileButton).toBeVisible({ timeout: 10_000 })
  await fileButton.click()

  const diffBody = page.getByTestId('diff-body')
  await expect(diffBody).toBeVisible({ timeout: 10_000 })
  await expect(diffBody.getByTestId('diff-hunk').first()).toBeVisible({ timeout: 10_000 })
  expect(await diffBody.getByTestId('diff-hunk').count()).toBeGreaterThanOrEqual(1)

  const stageHunk = diffBody.getByRole('checkbox', { name: 'Stage hunk' }).first()
  await expect(stageHunk).toBeVisible({ timeout: 10_000 })
  await stageHunk.click()

  await expect(diffBody.getByRole('checkbox', { name: 'Unstage hunk' }).first()).toBeVisible({
    timeout: 10_000
  })
  await expect(fileRowCheckbox(page, 'README.md')).toBeChecked({ timeout: 10_000 })
})

test('scrolls a long working-tree diff instead of clipping it', async ({ harness }) => {
  const repo = createFixtureRepo()
  const lines = Array.from({ length: 400 }, (_unused, index) => `line ${index}`).join('\n')
  fs.writeFileSync(path.join(repo, 'README.md'), `${lines}\n`)
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)
  const diffBody = page.getByTestId('diff-body')
  await expect(diffBody.getByTestId('diff-hunk').first()).toBeVisible({ timeout: 10_000 })

  const overflows = await diffBody.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1
  )
  expect(overflows).toBe(true)

  await diffBody.evaluate((element) => {
    element.scrollTop = 400
  })
  expect(await diffBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})
