import fs from 'node:fs'
import path from 'node:path'
import {
  commitDetailPane,
  commitListRegion,
  commitListWidth,
  createFixtureRepo,
  dragListDivider,
  expect,
  gitIn,
  listDivider,
  releaseListDividerDrag,
  test,
  workingCopyRow
} from './fixtures'

const LIST_PANE_DEFAULT_WIDTH = 400
const LIST_PANE_MIN_WIDTH = 300
const LIST_PANE_MAX_WIDTH = 820

function createTwoCommitRepo(): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  fs.writeFileSync(path.join(repo, 'note.txt'), 'note\n')
  git(['add', '.'])
  git(['commit', '-m', 'add a note'])
  return repo
}

test('drags the commit-list divider within its bounds and resets on double-click', async ({
  harness
}) => {
  const repo = createTwoCommitRepo()
  const page = await harness.openRepo(repo)

  await expect(commitListRegion(page)).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_DEFAULT_WIDTH)
  await expect(page.getByTestId('list-pane-width-tooltip')).toHaveCount(0)

  await dragListDivider(page, 160, { release: false })
  const tooltip = page.getByTestId('list-pane-width-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveText(/^\d+px$/)
  await expect(tooltip).toHaveText(`${await commitListWidth(page)}px`)
  await releaseListDividerDrag(page)

  await expect(tooltip).toHaveCount(0)
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_DEFAULT_WIDTH + 160)

  await dragListDivider(page, 600)
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_MAX_WIDTH)

  await dragListDivider(page, -900)
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_MIN_WIDTH)

  await listDivider(page).dblclick()
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_DEFAULT_WIDTH)
})

test('persists a dragged commit-list width per repo tab, outliving a renderer reload', async ({
  harness
}) => {
  const repoA = createTwoCommitRepo()
  const repoB = createTwoCommitRepo()
  let page = await harness.openTabs([repoA, repoB])

  const tabA = page.getByRole('tab', { name: path.basename(repoA) })
  const tabB = page.getByRole('tab', { name: path.basename(repoB) })
  await expect(tabA).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_DEFAULT_WIDTH)

  await dragListDivider(page, 220)
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_DEFAULT_WIDTH + 220)

  await tabB.click()
  await expect(tabB).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_DEFAULT_WIDTH)

  await dragListDivider(page, -60)
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_DEFAULT_WIDTH - 60)

  await tabA.click()
  await expect(tabA).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_DEFAULT_WIDTH + 220)

  page = await harness.reload()

  await expect(commitListRegion(page)).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(() => commitListWidth(page), { timeout: 15_000 })
    .toBe(LIST_PANE_DEFAULT_WIDTH + 220)

  await page.getByRole('tab', { name: path.basename(repoB) }).click()
  await expect.poll(() => commitListWidth(page)).toBe(LIST_PANE_DEFAULT_WIDTH - 60)
})

test('shows refs, commits, detail and the status dock at once, with the working copy pinned', async ({
  harness
}) => {
  const repo = createTwoCommitRepo()
  fs.appendFileSync(path.join(repo, 'note.txt'), 'a local edit\n')
  const page = await harness.openRepo(repo)

  await expect(page.getByTestId('repo-shell')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('complementary', { name: 'Branches' })).toBeVisible()
  await expect(commitListRegion(page)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Details' })).toBeVisible()
  await expect(page.getByTestId('status-dock')).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Open repositories' })).toHaveCount(0)

  const pinnedRow = workingCopyRow(page)
  await expect(pinnedRow).toBeVisible()
  const firstCommitRow = page.getByTestId('commit-row').first()
  await expect(firstCommitRow).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(
      async () => {
        const pinnedBox = await pinnedRow.boundingBox()
        const firstCommitBox = await firstCommitRow.boundingBox()
        if (!pinnedBox || !firstCommitBox) {
          return null
        }
        return firstCommitBox.y - pinnedBox.y
      },
      { timeout: 10_000 }
    )
    .toBeGreaterThan(0)

  await page.getByTestId('commit-row').filter({ hasText: 'initial' }).click()
  const pane = commitDetailPane(page)
  await expect(pane.getByTestId('commit-meta')).toContainText('initial', { timeout: 10_000 })
  await expect(pane.getByTestId('commit-file-row').first()).toContainText('README.md')

  await pinnedRow.click()
  await expect(page.getByTestId('working-copy-header')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('working-copy-header')).toContainText('Working copy')
  await expect(page.getByTestId('working-copy-header')).toContainText('1 file · 0 staged')
  await expect(page.getByTestId('commit-bar')).toBeVisible()
  await expect(page.getByTestId('status-file-row').filter({ hasText: 'note.txt' })).toBeVisible()
  await expect(pane).toHaveCount(0)
})

test('the workspace columns fill the window height and the status dock sits at the bottom', async ({
  harness
}) => {
  const repo = createTwoCommitRepo()
  const page = await harness.openRepo(repo)

  const viewportHeight = await page.evaluate(() => window.innerHeight)
  const dockBox = await page.getByTestId('status-dock').boundingBox()
  if (!dockBox) {
    throw new Error('the status dock has no bounding box')
  }
  expect(dockBox.y + dockBox.height).toBeGreaterThan(viewportHeight - 2)

  const listBox = await commitListRegion(page).boundingBox()
  if (!listBox) {
    throw new Error('the commit list has no bounding box')
  }
  expect(listBox.height).toBeGreaterThan(viewportHeight * 0.8)
})
