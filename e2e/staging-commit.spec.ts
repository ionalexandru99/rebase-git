import fs from 'node:fs'
import path from 'node:path'
import {
  commitSubjects,
  createFixtureRepo,
  expect,
  fileRow,
  openHistory,
  openLocalChanges,
  porcelainStatus,
  stageFileFromRow,
  stagedFileRow,
  test,
  unstageFileFromRow,
  unstagedFileRow
} from './fixtures'

test('stages a file from its row and commits through the UI, draining the tree into history', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  fs.writeFileSync(path.join(repo, 'note.txt'), 'hello\n')
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)

  await expect(unstagedFileRow(page, 'note.txt')).toBeVisible({ timeout: 10_000 })
  await stageFileFromRow(page, 'note.txt')
  await expect(stagedFileRow(page, 'note.txt')).toBeVisible({ timeout: 10_000 })

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

// The grouped lists are the staging model: a file's state is which list it is in, and staging is a
// move between them.
test('moves a file between the Unstaged and Staged groups, in the list and in the index', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  fs.writeFileSync(path.join(repo, 'note.txt'), 'hello\n')
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)

  await expect(page.getByRole('heading', { name: 'Unstaged', exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('heading', { name: 'Staged', exact: true })).toHaveCount(0)
  await expect(unstagedFileRow(page, 'note.txt')).toBeVisible()

  await stageFileFromRow(page, 'note.txt')

  await expect(stagedFileRow(page, 'note.txt')).toBeVisible({ timeout: 10_000 })
  await expect(unstagedFileRow(page, 'note.txt')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Unstaged', exact: true })).toHaveCount(0)
  await expect.poll(() => porcelainStatus(repo), { timeout: 10_000 }).toEqual(['A  note.txt'])

  await unstageFileFromRow(page, 'note.txt')

  await expect(unstagedFileRow(page, 'note.txt')).toBeVisible({ timeout: 10_000 })
  await expect(stagedFileRow(page, 'note.txt')).toHaveCount(0)
  await expect.poll(() => porcelainStatus(repo), { timeout: 10_000 }).toEqual(['?? note.txt'])
})

test('stages a file by double-clicking its row', async ({ harness }) => {
  const repo = createFixtureRepo()
  fs.writeFileSync(path.join(repo, 'note.txt'), 'hello\n')
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)
  await expect(unstagedFileRow(page, 'note.txt')).toBeVisible({ timeout: 10_000 })

  await unstagedFileRow(page, 'note.txt').dblclick()

  await expect(stagedFileRow(page, 'note.txt')).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => porcelainStatus(repo), { timeout: 10_000 }).toEqual(['A  note.txt'])
})

test('Stage all / Unstage all move whole groups and gate the Commit button', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  fs.appendFileSync(path.join(repo, 'README.md'), 'second line\n')
  fs.writeFileSync(path.join(repo, 'note.txt'), 'note\n')
  fs.writeFileSync(path.join(repo, 'second.txt'), 'second\n')
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })
  await openLocalChanges(page)

  await expect(unstagedFileRow(page, 'README.md')).toBeVisible({ timeout: 10_000 })
  await expect(unstagedFileRow(page, 'note.txt')).toBeVisible()
  await expect(unstagedFileRow(page, 'second.txt')).toBeVisible()

  const subtitle = page.getByText(/\d+ files.*\d+ staged/)
  await expect(subtitle).toHaveText(/3 files.*0 staged/)

  const message = page.getByRole('textbox', { name: 'Commit message' })
  const commitButton = page.getByRole('button', { name: /^Commit/ })

  await message.fill('msg')
  await expect(commitButton).toHaveText('Commit')
  await expect(commitButton).toBeDisabled()

  await page.getByRole('button', { name: 'Stage all', exact: true }).click()

  await expect(stagedFileRow(page, 'README.md')).toBeVisible({ timeout: 10_000 })
  await expect(stagedFileRow(page, 'note.txt')).toBeVisible()
  await expect(stagedFileRow(page, 'second.txt')).toBeVisible()
  await expect(subtitle).toHaveText(/3 files.*3 staged/)
  await expect(page.getByRole('button', { name: 'Stage all', exact: true })).toHaveCount(0)
  await expect(commitButton).toHaveText('Commit 3 files')
  await expect(commitButton).toBeEnabled()

  await message.fill('')
  await expect(commitButton).toBeDisabled()

  await message.fill('msg')
  await expect(commitButton).toBeEnabled()

  await page.getByRole('button', { name: 'Unstage all', exact: true }).click()

  await expect(unstagedFileRow(page, 'README.md')).toBeVisible({ timeout: 10_000 })
  await expect(unstagedFileRow(page, 'note.txt')).toBeVisible()
  await expect(unstagedFileRow(page, 'second.txt')).toBeVisible()
  await expect(subtitle).toHaveText(/3 files.*0 staged/)
  await expect(page.getByRole('button', { name: 'Unstage all', exact: true })).toHaveCount(0)
  await expect(commitButton).toHaveText('Commit')
  await expect(commitButton).toBeDisabled()
})

test('selecting a modified file renders diff hunks and staging its hunk carries the file over', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  fs.appendFileSync(
    path.join(repo, 'README.md'),
    'line one\nline two\nline three\nline four\nline five\n'
  )
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)

  const fileButton = fileRow(page, 'README.md', 'unstaged').getByRole('button', {
    name: 'README.md',
    exact: true
  })
  await expect(fileButton).toBeVisible({ timeout: 10_000 })
  await fileButton.click()

  const diffBody = page.getByTestId('diff-body')
  await expect(diffBody).toBeVisible({ timeout: 10_000 })
  await expect(diffBody.getByTestId('diff-hunk').first()).toBeVisible({ timeout: 10_000 })
  expect(await diffBody.getByTestId('diff-hunk').count()).toBeGreaterThanOrEqual(1)

  const stageHunk = diffBody.getByRole('checkbox', { name: 'Stage hunk' }).first()
  await expect(stageHunk).toBeVisible({ timeout: 10_000 })
  await stageHunk.click()

  // The file's only hunk is staged, so it leaves the unstaged list and the selection follows it into
  // Staged — where the same hunk now reads from the index side.
  await expect(stagedFileRow(page, 'README.md')).toBeVisible({ timeout: 10_000 })
  await expect(diffBody.getByRole('checkbox', { name: 'Unstage hunk' }).first()).toBeVisible({
    timeout: 10_000
  })
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
