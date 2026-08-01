import fs from 'node:fs'
import path from 'node:path'
import {
  type AppHarness,
  commitParents,
  commitSubjects,
  createFixtureRepo,
  expect,
  gitIn,
  openLocalChanges,
  porcelainStatus,
  refTree,
  test
} from './fixtures'

const MAIN_SIDE = 'main-side\n'
const FEATURE_SIDE = 'feature-side\n'

function createConflictingRepo(): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const conflictFile = path.join(repo, 'conflict.txt')
  fs.writeFileSync(conflictFile, 'base\n')
  git(['add', '.'])
  git(['commit', '-m', 'add conflict file'])
  git(['checkout', '-b', 'feature'])
  fs.writeFileSync(conflictFile, FEATURE_SIDE)
  git(['add', '.'])
  git(['commit', '-m', 'feature side'])
  git(['checkout', 'main'])
  fs.writeFileSync(conflictFile, MAIN_SIDE)
  git(['add', '.'])
  git(['commit', '-m', 'main side'])
  return repo
}

const mergeFeatureIntoMain = async (harness: AppHarness): Promise<void> => {
  const page = harness.page
  const featureBranch = refTree(page).getByTitle('feature', { exact: true })
  await expect(featureBranch).toBeVisible({ timeout: 15_000 })
  await featureBranch.click({ button: 'right' })
  const mergeAction = page.getByRole('menuitem', { name: 'Merge into main' })
  await expect(mergeAction).toBeVisible({ timeout: 10_000 })
  await harness.expectToast(
    {
      type: 'warning',
      title: 'Merged feature hit conflicts',
      description: 'Resolve the conflicted files, then commit or abort.'
    },
    () => mergeAction.click()
  )
  await openLocalChanges(page)
}

test('resolving a conflicted merge in the app finishes it as a merge commit', async ({
  harness
}) => {
  const repo = createConflictingRepo()
  const page = await harness.openRepo(repo)

  await mergeFeatureIntoMain(harness)

  const banner = page.getByRole('status').filter({ hasText: 'Merging feature into main' })
  await expect(banner).toBeVisible({ timeout: 10_000 })
  await expect(banner).toContainText(
    '1 merge conflict — resolve conflict.txt, then stage it to continue.'
  )

  const conflictRow = page.getByTestId('status-file-row').filter({ hasText: 'conflict.txt' })
  await expect(conflictRow.getByRole('img', { name: 'conflicted' })).toBeVisible({ timeout: 10_000 })

  await conflictRow.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Keep feature' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Keep main' }).click()

  await expect(banner).toContainText('All conflicts are resolved — commit below to finish the merge.')

  await expect(page.getByText(/the merge is still in progress/)).toBeVisible()
  await expect(page.getByText('Nothing to commit — every change is on a branch.')).toHaveCount(0)

  const commitMessage = page.getByRole('textbox', { name: 'Commit message' })
  await expect(commitMessage).toHaveValue("Merge branch 'feature'", { timeout: 10_000 })

  await page.getByRole('button', { name: /^Commit/ }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Merging' })).toHaveCount(0, {
    timeout: 10_000
  })
  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 10_000 })

  expect(porcelainStatus(repo)).toEqual([])
  expect(commitParents(repo)).toHaveLength(2)
  expect(commitSubjects(repo)[0]).toBe("Merge branch 'feature'")
  expect(fs.readFileSync(path.join(repo, 'conflict.txt'), 'utf8')).toBe(MAIN_SIDE)
})

test('resolving a modify/delete conflict toward the deletion drops the file', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const doomedFile = path.join(repo, 'doomed.txt')
  fs.writeFileSync(doomedFile, 'base\n')
  git(['add', '.'])
  git(['commit', '-m', 'add doomed file'])
  git(['checkout', '-b', 'feature'])
  git(['rm', '-q', 'doomed.txt'])
  git(['commit', '-m', 'drop the doomed file'])
  git(['checkout', 'main'])
  fs.writeFileSync(doomedFile, MAIN_SIDE)
  git(['add', '.'])
  git(['commit', '-m', 'main side'])
  const page = await harness.openRepo(repo)

  await mergeFeatureIntoMain(harness)

  const banner = page.getByRole('status').filter({ hasText: 'Merging feature into main' })
  await expect(banner).toBeVisible({ timeout: 10_000 })

  const conflictRow = page.getByTestId('status-file-row').filter({ hasText: 'doomed.txt' })
  await expect(conflictRow.getByRole('img', { name: 'conflicted' })).toBeVisible({ timeout: 10_000 })

  await conflictRow.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Keep the file' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Delete the file' }).click()

  await expect(banner).toContainText('All conflicts are resolved')

  await page.getByRole('button', { name: /^Commit/ }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Merging' })).toHaveCount(0, {
    timeout: 10_000
  })

  expect(porcelainStatus(repo)).toEqual([])
  expect(commitParents(repo)).toHaveLength(2)
  expect(fs.existsSync(doomedFile)).toBe(false)
})

test('aborting a conflicted merge restores the pre-merge state', async ({ harness }) => {
  const repo = createConflictingRepo()
  const page = await harness.openRepo(repo)

  await mergeFeatureIntoMain(harness)

  const banner = page.getByRole('status').filter({ hasText: 'Merging feature into main' })
  await expect(banner).toBeVisible({ timeout: 10_000 })

  await banner.getByRole('button', { name: 'Abort merge' }).click()

  const confirmDialog = page.getByRole('dialog')
  await expect(confirmDialog).toBeVisible()
  await expect(confirmDialog).toContainText('Abort this merge?')
  await confirmDialog.getByRole('button', { name: 'Abort merge' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Merging' })).toHaveCount(0, {
    timeout: 10_000
  })
  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('status-file-row')).toHaveCount(0)

  expect(porcelainStatus(repo)).toEqual([])
  expect(commitSubjects(repo)[0]).toBe('main side')
  expect(commitParents(repo)).toHaveLength(1)
  expect(fs.readFileSync(path.join(repo, 'conflict.txt'), 'utf8')).toBe(MAIN_SIDE)
})

test('a merge aborted from outside the app clears the banner unprompted', async ({ harness }) => {
  const repo = createConflictingRepo()
  const page = await harness.openRepo(repo)

  await mergeFeatureIntoMain(harness)

  const banner = page.getByRole('status').filter({ hasText: 'Merging feature into main' })
  await expect(banner).toBeVisible({ timeout: 10_000 })

  gitIn(repo)(['merge', '--abort'])

  await expect(page.getByRole('status').filter({ hasText: 'Merging' })).toHaveCount(0, {
    timeout: 20_000
  })
  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('status-file-row')).toHaveCount(0)

  expect(porcelainStatus(repo)).toEqual([])
  expect(commitSubjects(repo)[0]).toBe('main side')
  expect(fs.readFileSync(path.join(repo, 'conflict.txt'), 'utf8')).toBe(MAIN_SIDE)
})
