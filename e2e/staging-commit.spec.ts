import fs from 'node:fs'
import path from 'node:path'
import { clickHunkAction, worktreeDiffBody, worktreeDiffLine } from './diff-locators'
import {
  commitSubjects,
  createFixtureRepo,
  expect,
  fileRow,
  gitIn,
  openHistory,
  openLocalChanges,
  porcelainStatus,
  stageFileFromRow,
  stagedFileRow,
  test,
  unstageFileFromRow,
  unstagedFileRow,
  workingCopyRow
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

  const workingCopyHeader = page.getByTestId('working-copy-header')
  const subtitle = workingCopyHeader.getByText(/\d+ files.*\d+ staged/)
  await expect(subtitle).toHaveText(/3 files.*0 staged/)

  const message = page.getByRole('textbox', { name: 'Commit message' })
  const commitButton = page.getByRole('button', { name: /^Commit/ })
  const fileList = page.getByTestId('status-file-scroll')
  const headerStageAll = workingCopyHeader.getByRole('button', { name: 'Stage all', exact: true })

  await message.fill('msg')
  await expect(commitButton).toHaveText('Commit')
  await expect(commitButton).toBeDisabled()
  await expect(headerStageAll).toBeEnabled()

  await fileList.getByRole('button', { name: 'Stage all', exact: true }).click()

  await expect(stagedFileRow(page, 'README.md')).toBeVisible({ timeout: 10_000 })
  await expect(stagedFileRow(page, 'note.txt')).toBeVisible()
  await expect(stagedFileRow(page, 'second.txt')).toBeVisible()
  await expect(subtitle).toHaveText(/3 files.*3 staged/)
  await expect(fileList.getByRole('button', { name: 'Stage all', exact: true })).toHaveCount(0)
  await expect(headerStageAll).toBeDisabled()
  await expect(commitButton).toHaveText('Commit 3 files')
  await expect(commitButton).toBeEnabled()

  await message.fill('')
  await expect(commitButton).toBeDisabled()

  await message.fill('msg')
  await expect(commitButton).toBeEnabled()

  await fileList.getByRole('button', { name: 'Unstage all', exact: true }).click()

  await expect(unstagedFileRow(page, 'README.md')).toBeVisible({ timeout: 10_000 })
  await expect(unstagedFileRow(page, 'note.txt')).toBeVisible()
  await expect(unstagedFileRow(page, 'second.txt')).toBeVisible()
  await expect(subtitle).toHaveText(/3 files.*0 staged/)
  await expect(fileList.getByRole('button', { name: 'Unstage all', exact: true })).toHaveCount(0)
  await expect(headerStageAll).toBeEnabled()
  await expect(commitButton).toHaveText('Commit')
  await expect(commitButton).toBeDisabled()
})

test('stages a hovered hunk from the detail pane and commits it through the one-line bar', async ({
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

  await expect(worktreeDiffBody(page)).toBeVisible({ timeout: 10_000 })
  await expect(worktreeDiffLine(page, 'line three').first()).toBeVisible({ timeout: 10_000 })

  await clickHunkAction(page, 'line three', 'Stage hunk')

  await expect(stagedFileRow(page, 'README.md')).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(() => porcelainStatus(repo).some((entry) => entry.includes('README.md')), {
      timeout: 10_000
    })
    .toBe(true)
  await expect(workingCopyRow(page)).toContainText('1 staged · 0 unstaged', { timeout: 10_000 })

  await page.getByRole('textbox', { name: 'Commit message' }).fill('publish the hunk')
  await page.getByRole('button', { name: /^Commit 1 file$/ }).click()

  await expect(workingCopyRow(page)).toContainText('No changes', { timeout: 10_000 })
  expect(commitSubjects(repo)).toEqual(['publish the hunk', 'initial'])
  expect(porcelainStatus(repo)).toEqual([])
})

test('lists a partially staged file in both groups, each row showing only its side', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const base = `${Array.from({ length: 40 }, (_unused, index) => `line ${index}`).join('\n')}\n`
  fs.writeFileSync(path.join(repo, 'long.txt'), base)
  git(['add', '.'])
  git(['commit', '-m', 'add long file'])
  fs.writeFileSync(
    path.join(repo, 'long.txt'),
    base.replace('line 2\n', 'line 2 edited\n').replace('line 36\n', 'line 36 edited\n')
  )
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)
  await unstagedFileRow(page, 'long.txt').getByRole('button', { name: 'long.txt', exact: true }).click()

  await expect(worktreeDiffLine(page, 'line 2 edited').first()).toBeVisible({ timeout: 10_000 })

  await clickHunkAction(page, 'line 2 edited', 'Stage hunk')

  await expect(stagedFileRow(page, 'long.txt')).toBeVisible({ timeout: 10_000 })
  await expect(unstagedFileRow(page, 'long.txt')).toBeVisible()
  await expect.poll(() => porcelainStatus(repo), { timeout: 10_000 }).toEqual(['MM long.txt'])

  await expect(worktreeDiffLine(page, 'line 36 edited').first()).toBeVisible({ timeout: 10_000 })
  await expect(worktreeDiffLine(page, 'line 2 edited')).toHaveCount(0)

  await stagedFileRow(page, 'long.txt').getByRole('button', { name: 'long.txt', exact: true }).click()

  await expect(worktreeDiffLine(page, 'line 2 edited').first()).toBeVisible({ timeout: 10_000 })
  await expect(worktreeDiffLine(page, 'line 36 edited')).toHaveCount(0)

  await clickHunkAction(page, 'line 2 edited', 'Unstage hunk')

  await expect.poll(() => porcelainStatus(repo), { timeout: 10_000 }).toEqual([' M long.txt'])
})

test('discards a hunk from the worktree after confirming, leaving other edits alone', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const base = `${Array.from({ length: 40 }, (_unused, index) => `line ${index}`).join('\n')}\n`
  fs.writeFileSync(path.join(repo, 'long.txt'), base)
  git(['add', '.'])
  git(['commit', '-m', 'add long file'])
  fs.writeFileSync(
    path.join(repo, 'long.txt'),
    base.replace('line 2\n', 'line 2 edited\n').replace('line 36\n', 'line 36 edited\n')
  )
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)
  await unstagedFileRow(page, 'long.txt').getByRole('button', { name: 'long.txt', exact: true }).click()

  await expect(worktreeDiffLine(page, 'line 2 edited').first()).toBeVisible({ timeout: 10_000 })

  await clickHunkAction(page, 'line 2 edited', 'Discard hunk')

  const confirmDialog = page.getByRole('dialog')
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: 'Discard' }).click()

  await expect
    .poll(() => fs.readFileSync(path.join(repo, 'long.txt'), 'utf8').includes('line 2 edited'), {
      timeout: 10_000
    })
    .toBe(false)
  expect(fs.readFileSync(path.join(repo, 'long.txt'), 'utf8')).toContain('line 36 edited')
  await expect(worktreeDiffLine(page, 'line 36 edited').first()).toBeVisible({ timeout: 10_000 })
})

test('scrolls a long working-tree diff instead of clipping it', async ({ harness }) => {
  const repo = createFixtureRepo()
  const lines = Array.from({ length: 400 }, (_unused, index) => `line ${index}`).join('\n')
  fs.writeFileSync(path.join(repo, 'README.md'), `${lines}\n`)
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)
  await expect(worktreeDiffLine(page, 'line 0').first()).toBeVisible({ timeout: 10_000 })

  const overflows = await worktreeDiffBody(page)
    .locator('.scroll-host')
    .evaluate((element) => element.scrollHeight > element.clientHeight + 1)
  expect(overflows).toBe(true)

  const scrollHost = worktreeDiffBody(page).locator('.scroll-host')
  await scrollHost.evaluate((element) => {
    element.scrollTop = 400
  })
  expect(await scrollHost.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})
