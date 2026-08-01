import fs from 'node:fs'
import path from 'node:path'
import {
  type AppHarness,
  commitSubjects,
  createFixtureRepo,
  currentBranch,
  expect,
  gitIn,
  gitStoppingOnConflict,
  openHistory,
  openLocalChanges,
  porcelainStatus,
  refTree,
  test
} from './fixtures'

const FEATURE_ALPHA = 'feature-alpha\n'
const FEATURE_BETA = 'feature-beta\n'
const MAIN_ALPHA = 'main-alpha\n'
const MAIN_BETA = 'main-beta\n'

function createTwoStopRepo(sideBranch: string): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const alpha = path.join(repo, 'alpha.txt')
  const beta = path.join(repo, 'beta.txt')
  fs.writeFileSync(alpha, 'base-alpha\n')
  fs.writeFileSync(beta, 'base-beta\n')
  git(['add', '.'])
  git(['commit', '-m', 'add alpha and beta'])

  git(['checkout', '-b', sideBranch])
  fs.writeFileSync(alpha, FEATURE_ALPHA)
  git(['add', '.'])
  git(['commit', '-m', `${sideBranch} touches alpha`])
  fs.writeFileSync(beta, FEATURE_BETA)
  git(['add', '.'])
  git(['commit', '-m', `${sideBranch} touches beta`])

  git(['checkout', 'main'])
  fs.writeFileSync(alpha, MAIN_ALPHA)
  fs.writeFileSync(beta, MAIN_BETA)
  git(['add', '.'])
  git(['commit', '-m', 'main touches alpha and beta'])
  return repo
}

const conflictRow = (harness: AppHarness, file: string) =>
  harness.page.getByTestId('status-file-row').filter({ hasText: file })

async function openConflictMenu(harness: AppHarness, file: string): Promise<void> {
  const row = conflictRow(harness, file)
  await expect(row.getByRole('img', { name: 'conflicted' })).toBeVisible({ timeout: 15_000 })
  await row.click({ button: 'right' })
}

async function takeSide(harness: AppHarness, file: string, choice: string | RegExp): Promise<void> {
  await openConflictMenu(harness, file)
  await harness.page.getByRole('menuitem', { name: choice }).click()
}

test('a rebase started in a terminal appears on its own and continues through both conflicts', async ({
  harness
}) => {
  const repo = createTwoStopRepo('feature')
  gitIn(repo)(['checkout', 'feature'])
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('button', { name: 'feature current' })).toBeVisible({
    timeout: 10_000
  })
  await openLocalChanges(page)
  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 10_000 })

  gitStoppingOnConflict(repo)(['rebase', 'main'])

  const banner = page.getByRole('status').filter({ hasText: 'Rebasing feature onto main' })
  await expect(banner).toBeVisible({ timeout: 20_000 })
  await expect(banner).toContainText('1/2')
  await expect(banner).toContainText('1 merge conflict — resolve alpha.txt, then stage it to continue.')

  await openConflictMenu(harness, 'alpha.txt')
  await expect(page.getByRole('menuitem', { name: 'Keep main' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Keep feature' }).click()

  await expect(banner).toContainText('All conflicts are resolved — continue to finish the rebase.', {
    timeout: 10_000
  })

  await harness.expectToast(
    {
      type: 'warning',
      title: 'Continued rebase hit conflicts',
      description: 'Resolve and stage the conflicted files, then finish from the conflict banner.'
    },
    () => banner.getByRole('button', { name: 'Continue rebase' }).click()
  )

  await expect(banner).toContainText('2/2', { timeout: 15_000 })
  await takeSide(harness, 'beta.txt', 'Keep feature')
  await expect(banner).toContainText('All conflicts are resolved', { timeout: 10_000 })
  await banner.getByRole('button', { name: 'Continue rebase' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Rebasing' })).toHaveCount(0, {
    timeout: 15_000
  })
  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 15_000 })

  expect(currentBranch(repo)).toBe('feature')
  expect(porcelainStatus(repo)).toEqual([])
  expect(commitSubjects(repo)).toEqual([
    'feature touches beta',
    'feature touches alpha',
    'main touches alpha and beta',
    'add alpha and beta',
    'initial'
  ])
  expect(fs.readFileSync(path.join(repo, 'alpha.txt'), 'utf8')).toBe(FEATURE_ALPHA)
  expect(fs.readFileSync(path.join(repo, 'beta.txt'), 'utf8')).toBe(FEATURE_BETA)
})

test('a multi-commit cherry-pick reports its position and finishes through Continue', async ({
  harness
}) => {
  const repo = createTwoStopRepo('source')
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })
  await openLocalChanges(page)

  gitStoppingOnConflict(repo)(['cherry-pick', 'source~2..source'])

  const banner = page.getByRole('status').filter({ hasText: 'Cherry-picking' })
  await expect(banner).toBeVisible({ timeout: 20_000 })
  await expect(banner).toContainText('1/2')
  await expect(banner).toContainText('source touches alpha')

  await openConflictMenu(harness, 'alpha.txt')
  await expect(page.getByRole('menuitem', { name: 'Keep main' })).toBeVisible()
  await page.getByRole('menuitem', { name: /^Keep \S+ source touches alpha$/ }).click()

  await expect(banner).toContainText('All conflicts are resolved', { timeout: 10_000 })

  await harness.expectToast(
    {
      type: 'warning',
      title: 'Continued cherry-pick hit conflicts',
      description: 'Resolve and stage the conflicted files, then finish from the conflict banner.'
    },
    () => banner.getByRole('button', { name: 'Continue cherry-pick' }).click()
  )

  await expect(banner).toContainText('2/2', { timeout: 15_000 })
  await takeSide(harness, 'beta.txt', /^Keep \S+ source touches beta$/)
  await expect(banner).toContainText('All conflicts are resolved', { timeout: 10_000 })
  await banner.getByRole('button', { name: 'Continue cherry-pick' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Cherry-picking' })).toHaveCount(0, {
    timeout: 15_000
  })
  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 15_000 })

  expect(currentBranch(repo)).toBe('main')
  expect(porcelainStatus(repo)).toEqual([])
  expect(commitSubjects(repo)).toEqual([
    'source touches beta',
    'source touches alpha',
    'main touches alpha and beta',
    'add alpha and beta',
    'initial'
  ])
})

test('cherry-picking a conflicting commit from the history menu resolves in-app', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const contested = path.join(repo, 'contested.txt')
  fs.writeFileSync(contested, 'base\n')
  git(['add', '.'])
  git(['commit', '-m', 'add contested file'])
  git(['checkout', '-b', 'source'])
  fs.writeFileSync(contested, FEATURE_ALPHA)
  git(['add', '.'])
  git(['commit', '-m', 'source rewrites contested'])
  git(['checkout', 'main'])
  fs.writeFileSync(contested, MAIN_ALPHA)
  git(['add', '.'])
  git(['commit', '-m', 'main rewrites contested'])

  const page = await harness.openRepo(repo)
  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })
  const sourceRef = refTree(page).getByTestId('ref-tree-leaf-row').filter({ hasText: 'source' })
  await expect(sourceRef).toBeVisible({ timeout: 10_000 })
  await sourceRef.hover()
  await page.getByRole('button', { name: 'Show source on timeline' }).click()
  await openHistory(page)

  const sourceCommit = page
    .getByTestId('commit-row')
    .filter({ hasText: 'source rewrites contested' })
  await expect(sourceCommit).toBeVisible({ timeout: 10_000 })
  await sourceCommit.click({ button: 'right' })
  await harness.expectToast(
    {
      type: 'warning',
      title: /^Cherry-picked \S+ hit conflicts$/,
      description: 'Resolve the conflicted files, then commit or abort.'
    },
    () => page.getByRole('menuitem', { name: 'Cherry-pick onto current' }).click()
  )
  await openLocalChanges(page)

  const banner = page.getByRole('status').filter({ hasText: 'Cherry-picking' })
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await expect(banner).toContainText('source rewrites contested')
  await expect(banner.locator('span.tabular-nums')).toHaveCount(0)

  await takeSide(harness, 'contested.txt', /^Keep \S+ source rewrites contested$/)
  await expect(banner).toContainText('All conflicts are resolved', { timeout: 10_000 })
  await banner.getByRole('button', { name: 'Continue cherry-pick' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Cherry-picking' })).toHaveCount(0, {
    timeout: 15_000
  })
  await expect(page.getByText('Working tree clean')).toBeVisible({ timeout: 15_000 })

  expect(porcelainStatus(repo)).toEqual([])
  expect(commitSubjects(repo)[0]).toBe('source rewrites contested')
  expect(fs.readFileSync(contested, 'utf8')).toBe(FEATURE_ALPHA)
})
