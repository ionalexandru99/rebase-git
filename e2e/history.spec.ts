import fs from 'node:fs'
import path from 'node:path'
import { createFixtureRepo, expect, fileRowCheckbox, gitIn, openLocalChanges, test } from './fixtures'

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

  await expect(page.getByText('second commit')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/\b2 commits\b/)).toBeVisible({ timeout: 10_000 })

  await page.getByText('initial').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Reset branch here \(soft\)/ }).click()

  await expect(page.getByText(/\b1 commit\b/)).toBeVisible({ timeout: 10_000 })

  await openLocalChanges(page)
  await expect(fileRowCheckbox(page, 'a.txt')).toBeChecked({ timeout: 10_000 })
})

test('keeps the Author / SHA / Date columns legible on a wide graph while scrolling', async ({
  harness
}) => {
  const repo = createWideGraphRepo(16, 24)
  const page = await harness.openRepo(repo)

  await expect(page.getByText(/filler 23/).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Author', { exact: true })).toBeVisible()
  await expect(page.getByText('SHA', { exact: true })).toBeVisible()
  await expect(page.getByText('Date', { exact: true })).toBeVisible()

  const scroll = page.getByTestId('history-scroll')
  await scroll.evaluate((element) => {
    element.scrollTo(0, element.scrollHeight)
  })

  const mergeRow = page.getByTestId('commit-row').filter({ hasText: 'wide octopus merge' })
  await expect(mergeRow).toBeVisible({ timeout: 10_000 })

  const dateCell = mergeRow.locator('time')
  await expect(dateCell).toBeVisible()
  await expect(mergeRow.getByText('Test', { exact: true })).toBeVisible()

  const containerBox = await scroll.boundingBox()
  const dateBox = await dateCell.boundingBox()
  if (!containerBox || !dateBox) {
    throw new Error('expected bounding boxes for the scroll container and date cell')
  }
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
  const dateBox = await dateCell.boundingBox()
  if (!dateBox) {
    throw new Error('expected a bounding box for the date cell')
  }
  await page.mouse.click(dateBox.x + dateBox.width / 2, dateBox.y + dateBox.height / 2, {
    button: 'right'
  })

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

  await page.getByRole('textbox', { name: 'Filter commits' }).fill('alpha')

  await expect(alphaRow).toHaveCSS('opacity', '1', { timeout: 10_000 })
  await expect(betaRow).toHaveCSS('opacity', '0.35', { timeout: 10_000 })
  await expect(page.getByText(/3 commits/)).toBeVisible()
})
