import fs from 'node:fs'
import path from 'node:path'
import {
  commitListWidth,
  commitSubjects,
  createFixtureRepo,
  expect,
  stagedFileRow,
  gitIn,
  openLocalChanges,
  porcelainStatus,
  test
} from './fixtures'

function createMergeRepo(): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  git(['checkout', '-b', 'feature', 'main'])
  fs.writeFileSync(path.join(repo, 'feature.txt'), 'feature\n')
  git(['add', '.'])
  git(['commit', '-m', 'feature work'])
  git(['checkout', 'main'])
  fs.writeFileSync(path.join(repo, 'main.txt'), 'main\n')
  git(['add', '.'])
  git(['commit', '-m', 'main work'])
  git(['merge', '--no-ff', '--no-edit', '-m', 'merge feature branch', 'feature'])
  return repo
}

function createWideGraphRepo(branchCount: number, fillerCount: number): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const branches: string[] = []
  for (let index = 0; index < branchCount; index++) {
    const branch = `wide-${index}`
    git(['checkout', '-b', branch, 'main'])
    fs.writeFileSync(path.join(repo, `wide-${index}.txt`), `branch ${index}\n`)
    git(['add', '.'])
    git(['commit', '-m', `branch ${index}`])
    branches.push(branch)
  }
  git(['checkout', 'main'])
  git(['merge', '--no-edit', '-m', 'wide octopus merge', ...branches])
  for (let index = 0; index < fillerCount; index++) {
    fs.writeFileSync(path.join(repo, 'filler.txt'), `filler ${index}\n`)
    git(['add', '.'])
    git(['commit', '-m', `filler ${index}`])
  }
  return repo
}

test('resets the branch to an earlier commit via the history context menu', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n')
  git(['add', '.'])
  git(['commit', '-m', 'second commit'])
  const page = await harness.openRepo(repo)

  await expect(page.getByTestId('commit-row').filter({ hasText: 'second commit' })).toBeVisible({
    timeout: 10_000
  })
  await expect(page.getByText(/\b2 commits\b/)).toBeVisible({ timeout: 10_000 })

  await page.getByText('initial').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Reset branch here \(soft\)/ }).click()

  await expect(page.getByText(/\b1 commit\b/)).toBeVisible({ timeout: 10_000 })

  await openLocalChanges(page)
  await expect(stagedFileRow(page, 'a.txt')).toBeVisible({ timeout: 10_000 })

  expect(commitSubjects(repo)).toEqual(['initial'])
  expect(porcelainStatus(repo)).toEqual(['A  a.txt'])
})

test('collapses a merge by default and expands/collapses its side branch from the merge dot', async ({
  harness
}) => {
  const repo = createMergeRepo()
  const page = await harness.openRepo(repo)

  const sideRow = page.getByTestId('commit-row').filter({ hasText: 'feature work' })
  await expect(
    page.getByTestId('commit-row').filter({ hasText: 'merge feature branch' })
  ).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('commit-row').filter({ hasText: 'main work' })).toBeVisible()
  await expect(sideRow).toHaveCount(0)

  const canvas = page.getByTestId('commit-graph-canvas')
  const baseBox = await canvas.boundingBox()
  if (!baseBox) {
    throw new Error('expected a bounding box for the graph canvas')
  }

  const expandControl = page.getByRole('button', { name: 'Expand merge side branch' })
  await expect(expandControl).toBeVisible()
  await expandControl.click()

  await expect(sideRow).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(baseBox.width)

  await page.getByRole('button', { name: 'Collapse merge side branch' }).click()

  await expect(sideRow).toHaveCount(0)
  await expect
    .poll(async () => Math.round((await canvas.boundingBox())?.width ?? 0), { timeout: 10_000 })
    .toBe(Math.round(baseBox.width))
})

test('keeps the author, sha and date legible on a wide graph while scrolling', async ({
  harness
}) => {
  const repo = createWideGraphRepo(16, 24)
  const page = await harness.openRepo(repo, { listPaneWidths: { [repo]: 700 } })

  expect(await commitListWidth(page)).toBe(700)
  await expect(page.getByText(/filler 23/).first()).toBeVisible({ timeout: 10_000 })

  const scroll = page.getByTestId('history-scroll')
  await scroll.evaluate((element) => {
    element.scrollTo(0, element.scrollHeight)
  })

  const mergeRow = page.getByTestId('commit-row').filter({ hasText: 'wide octopus merge' })
  await expect(mergeRow).toBeVisible({ timeout: 10_000 })
  await expect(mergeRow.getByTestId('commit-row-meta')).toHaveCount(0)
  await expect(mergeRow.getByText('Test', { exact: true })).toBeVisible()

  const dateCell = mergeRow.locator('time')
  await expect(dateCell).toBeVisible()

  const containerBox = await scroll.boundingBox()
  const dateBox = await dateCell.boundingBox()
  const rowBox = await mergeRow.boundingBox()
  if (!containerBox || !dateBox || !rowBox) {
    throw new Error('expected bounding boxes for the scroll container, row and date cell')
  }
  expect(Math.round(rowBox.height)).toBe(30)
  expect(dateBox.x + dateBox.width).toBeLessThanOrEqual(containerBox.x + containerBox.width + 1)
  expect(dateBox.x).toBeGreaterThanOrEqual(containerBox.x)
})

test('opens the row context menu when right-clicking over the pinned metadata', async ({
  harness
}) => {
  const repo = createWideGraphRepo(16, 4)
  const page = await harness.openRepo(repo)

  const mergeRow = page.getByTestId('commit-row').filter({ hasText: 'wide octopus merge' })
  await expect(mergeRow).toBeVisible({ timeout: 10_000 })

  const dateCell = mergeRow.locator('time')
  await expect(dateCell).toBeVisible({ timeout: 10_000 })
  await dateCell.click({ button: 'right' })

  await expect(page.getByRole('menuitem', { name: 'Copy SHA' })).toBeVisible({ timeout: 10_000 })
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

  await page.getByRole('button', { name: 'Filter commits', exact: true }).click()
  await page.getByRole('textbox', { name: 'Filter commits' }).fill('alpha')

  await expect(alphaRow).toHaveCSS('opacity', '1', { timeout: 10_000 })
  await expect(betaRow).toHaveCSS('opacity', '0.35', { timeout: 10_000 })
  await expect(page.getByText(/3 commits/)).toBeVisible()
})
