import fs from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { worktreeDiffBody, worktreeDiffLine } from './diff-locators'
import {
  createFixtureRepo,
  expect,
  fileRow,
  gitIn,
  gitOut,
  gitStoppingOnConflict,
  openLocalChanges,
  porcelainStatus,
  stagedFileRow,
  test,
  unstagedFileRow
} from './fixtures'

const gutterNumber = (page: Page, lineNumber: number): Locator =>
  worktreeDiffBody(page).locator(`[data-column-number="${lineNumber}"]`).first()

async function shiftClickGutterNumber(page: Page, lineNumber: number): Promise<void> {
  const cell = gutterNumber(page, lineNumber)
  await cell.waitFor({ timeout: 10_000 })
  const box = await cell.boundingBox()
  if (!box) {
    throw new Error('gutter number cell is not visible')
  }
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up('Shift')
}

async function dragSelectGutterNumbers(page: Page, start: number, end: number): Promise<void> {
  const startCell = gutterNumber(page, start)
  const endCell = gutterNumber(page, end)
  await startCell.waitFor({ timeout: 10_000 })
  const startBox = await startCell.boundingBox()
  const endBox = await endCell.boundingBox()
  if (!startBox || !endBox) {
    throw new Error('gutter number cells are not visible')
  }
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 6 })
  await page.mouse.up()
}

function createRepoWithTwoHunks(): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const base = `${Array.from({ length: 40 }, (_unused, index) => `line ${index}`).join('\n')}\n`
  fs.writeFileSync(path.join(repo, 'long.txt'), base)
  git(['add', '.'])
  git(['commit', '-m', 'add long file'])
  fs.writeFileSync(
    path.join(repo, 'long.txt'),
    base
      .replace('line 2\n', 'line 2\nadded A\nadded B\n')
      .replace('line 36\n', 'line 36 edited\n')
  )
  return repo
}

async function openWorktreeFile(page: Page, file: string, group: 'staged' | 'unstaged') {
  await fileRow(page, file, group).getByRole('button', { name: file, exact: true }).click()
}

const stagedDiff = (repo: string) => gitOut(repo, ['diff', '--cached', '--unified=0', 'long.txt'])

test('stages a gutter-selected subset of lines, then unstages one of them back', async ({
  harness
}) => {
  const repo = createRepoWithTwoHunks()
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)
  await openWorktreeFile(page, 'long.txt', 'unstaged')
  await expect(worktreeDiffLine(page, 'added A').first()).toBeVisible({ timeout: 10_000 })

  await dragSelectGutterNumbers(page, 4, 5)
  await page.getByRole('button', { name: 'Stage 2 selected lines' }).click()

  await expect(stagedFileRow(page, 'long.txt')).toBeVisible({ timeout: 10_000 })
  await expect(unstagedFileRow(page, 'long.txt')).toBeVisible()
  await expect.poll(() => porcelainStatus(repo), { timeout: 10_000 }).toEqual(['MM long.txt'])
  await expect.poll(() => stagedDiff(repo)).toContain('+added A')
  expect(stagedDiff(repo)).toContain('+added B')
  expect(stagedDiff(repo)).not.toContain('edited')

  await openWorktreeFile(page, 'long.txt', 'staged')
  await expect(worktreeDiffLine(page, 'added A').first()).toBeVisible({ timeout: 10_000 })
  await expect(worktreeDiffLine(page, 'line 36 edited')).toHaveCount(0)

  await dragSelectGutterNumbers(page, 4, 4)
  await page.getByRole('button', { name: 'Unstage 1 selected line' }).click()

  await expect.poll(() => stagedDiff(repo), { timeout: 10_000 }).not.toContain('+added A')
  expect(stagedDiff(repo)).toContain('+added B')
  await expect.poll(() => porcelainStatus(repo)).toEqual(['MM long.txt'])
})

test('extends a line selection with shift-click before staging', async ({ harness }) => {
  const repo = createRepoWithTwoHunks()
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)
  await openWorktreeFile(page, 'long.txt', 'unstaged')
  await expect(worktreeDiffLine(page, 'added A').first()).toBeVisible({ timeout: 10_000 })

  await dragSelectGutterNumbers(page, 4, 4)
  await expect(page.getByRole('button', { name: 'Stage 1 selected line' })).toBeVisible()

  await shiftClickGutterNumber(page, 5)
  await page.getByRole('button', { name: 'Stage 2 selected lines' }).click()

  await expect.poll(() => stagedDiff(repo), { timeout: 10_000 }).toContain('+added A')
  expect(stagedDiff(repo)).toContain('+added B')
  expect(stagedDiff(repo)).not.toContain('edited')
})

test('offers no line-staging affordance on a conflicted file', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const conflictFile = path.join(repo, 'conflict.txt')
  fs.writeFileSync(conflictFile, 'base\n')
  git(['add', '.'])
  git(['commit', '-m', 'add conflict file'])
  git(['checkout', '-b', 'feature'])
  fs.writeFileSync(conflictFile, 'feature-side\n')
  git(['add', '.'])
  git(['commit', '-m', 'feature side'])
  git(['checkout', 'main'])
  fs.writeFileSync(conflictFile, 'main-side\n')
  git(['add', '.'])
  git(['commit', '-m', 'main side'])
  gitStoppingOnConflict(repo)(['merge', 'feature'])

  const page = await harness.openRepo(repo)
  await openLocalChanges(page)
  await fileRow(page, 'conflict.txt', 'conflicts')
    .getByRole('button', { name: 'conflict.txt', exact: true })
    .click()
  await expect(worktreeDiffLine(page, 'feature-side').first()).toBeVisible({ timeout: 10_000 })

  const conflictNumber = gutterNumber(page, 2)
  await conflictNumber.waitFor({ timeout: 10_000 })
  const box = await conflictNumber.boundingBox()
  if (!box) {
    throw new Error('conflict gutter number is not visible')
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()

  await expect(page.getByRole('button', { name: /selected line/ })).toHaveCount(0)
  expect(porcelainStatus(repo)).toContain('UU conflict.txt')
})
