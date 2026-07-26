import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { createFixtureRepo, expect, gitIn, revParse, setWindowSize, test } from './fixtures'

function createDetailRepo(): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'one\ntwo\nthree\n')
  fs.writeFileSync(path.join(repo, 'doomed.txt'), 'bye\n')
  fs.writeFileSync(path.join(repo, 'src', 'deep', 'nested.txt'), 'nested one\n')
  git(['add', '.'])
  git(['commit', '-m', 'add files'])

  fs.writeFileSync(path.join(repo, 'keep.txt'), 'one\nTWO\nthree\n')
  fs.writeFileSync(path.join(repo, 'fresh.txt'), 'brand new\n')
  fs.writeFileSync(path.join(repo, 'src', 'deep', 'nested.txt'), 'nested TWO\n')
  git(['rm', '-q', 'doomed.txt'])
  git(['add', '-A'])
  git([
    '-c',
    'user.name=Ada Author',
    '-c',
    'user.email=ada@example.com',
    'commit',
    '-m',
    'reshape the files\n\nThe body explains the rationale.'
  ])
  return repo
}

const commitRow = (page: Page, subject: string) =>
  page.getByTestId('commit-row').filter({ hasText: subject })

const detailsPanel = (page: Page) => page.getByTestId('commit-details-panel')

const fileRow = (page: Page, name: string) =>
  detailsPanel(page).getByTestId('commit-file-row').filter({ hasText: name })

test('shows a commit’s message, identity, files and diff in the details panel', async ({
  harness
}) => {
  const repo = createDetailRepo()
  const sha = revParse(repo, 'HEAD')
  const page = await harness.openRepo(repo)

  await expect(page.getByText('reshape the files')).toBeVisible({ timeout: 10_000 })
  await expect(detailsPanel(page)).toBeHidden()

  await commitRow(page, 'reshape the files').dblclick()

  const panel = detailsPanel(page)
  await expect(panel).toBeVisible({ timeout: 10_000 })
  await expect(panel.getByText('The body explains the rationale.')).toBeVisible()
  const meta = panel.getByTestId('commit-meta')
  await expect(meta.getByText('Author', { exact: true })).toBeVisible()
  await expect(meta.getByText('Parent')).toHaveCount(0)
  await expect(meta.getByText('Ada Author')).toBeVisible()
  await expect(meta.getByText('ada@example.com')).toBeVisible()
  await expect(panel.getByTestId('commit-stats')).toContainText('4 files')
  await expect(panel.getByRole('button', { name: `Copy full SHA ${sha}` })).toBeVisible()

  // The changed files read as a tree: the directory first, then the root-level files.
  const directories = panel.getByTestId('commit-directory-row')
  await expect(directories).toHaveCount(1)
  await expect(directories.first()).toContainText('src/deep')

  const fileRows = panel.getByTestId('commit-file-row')
  await expect(fileRows).toHaveCount(4)
  await expect(fileRows.nth(0)).toContainText('nested.txt')
  await expect(fileRows.nth(1)).toContainText('doomed.txt')
  await expect(fileRows.nth(2)).toContainText('fresh.txt')
  await expect(fileRows.nth(3)).toContainText('keep.txt')

  // The first file in tree order has its diff on screen without a second click.
  await expect(panel.getByTestId('diff-hunk')).toBeVisible()
  await expect(panel.getByTestId('diff-body')).toContainText('nested TWO')

  await fileRow(page, 'keep.txt').click()
  await expect(panel.getByTestId('diff-body')).toContainText('TWO')

  // A commit that already exists is read-only: nothing to stage, unstage or drop.
  await expect(panel.locator('input[type="checkbox"]')).toHaveCount(0)
})

test('collapses a directory in the changed-files tree without changing the diff', async ({
  harness
}) => {
  const repo = createDetailRepo()
  const page = await harness.openRepo(repo)

  await expect(page.getByText('reshape the files')).toBeVisible({ timeout: 10_000 })
  await commitRow(page, 'reshape the files').dblclick()

  const panel = detailsPanel(page)
  await expect(panel.getByTestId('diff-hunk')).toBeVisible({ timeout: 10_000 })
  await expect(fileRow(page, 'nested.txt')).toBeVisible()

  await panel.getByTestId('commit-directory-row').click()

  await expect(fileRow(page, 'nested.txt')).toHaveCount(0)
  await expect(fileRow(page, 'keep.txt')).toBeVisible()
  await expect(panel.getByTestId('diff-body')).toContainText('nested TWO')

  await panel.getByTestId('commit-directory-row').click()
  await expect(fileRow(page, 'nested.txt')).toBeVisible()
})

test('scrolls a long commit diff inside the panel', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const lines = Array.from({ length: 400 }, (_unused, index) => `line ${index}`).join('\n')
  fs.writeFileSync(path.join(repo, 'big.txt'), `${lines}\n`)
  git(['add', '.'])
  git(['commit', '-m', 'add a long file'])
  const page = await harness.openRepo(repo)

  await expect(page.getByText('add a long file')).toBeVisible({ timeout: 10_000 })
  await commitRow(page, 'add a long file').dblclick()

  const panel = detailsPanel(page)
  await expect(panel.getByTestId('diff-hunk').first()).toBeVisible({ timeout: 10_000 })

  const body = panel.getByTestId('diff-body')
  const overflows = await body.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1
  )
  expect(overflows).toBe(true)

  await body.evaluate((element) => {
    element.scrollTop = 400
  })
  expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

test('selects several commits and summarises them instead of guessing a merged diff', async ({
  harness
}) => {
  const repo = createDetailRepo()
  const page = await harness.openRepo(repo)

  await expect(page.getByText('reshape the files')).toBeVisible({ timeout: 10_000 })

  await commitRow(page, 'reshape the files').dblclick()
  await expect(detailsPanel(page).getByTestId('diff-hunk')).toBeVisible({ timeout: 10_000 })

  await commitRow(page, 'initial').click({ modifiers: ['Shift'] })

  const panel = detailsPanel(page)
  await expect(panel.getByText('3 commits selected')).toBeVisible()
  const summary = panel.getByTestId('commit-selection-summary')
  await expect(summary).toContainText('reshape the files')
  await expect(summary).toContainText('add files')
  await expect(summary).toContainText('initial')
  await expect(panel.getByTestId('diff-hunk')).toHaveCount(0)

  // First Escape gives the graph its height back; the selection survives for a follow-up action.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(commitRow(page, 'reshape the files')).toHaveAttribute('data-selected', 'true')

  await page.keyboard.press('Escape')
  await expect(commitRow(page, 'reshape the files')).not.toHaveAttribute('data-selected', 'true')
})

test('follows a plain click while open, and closes from the panel button', async ({ harness }) => {
  const repo = createDetailRepo()
  const page = await harness.openRepo(repo)

  await expect(page.getByText('reshape the files')).toBeVisible({ timeout: 10_000 })
  await commitRow(page, 'reshape the files').dblclick()

  const panel = detailsPanel(page)
  await expect(panel).toBeVisible({ timeout: 10_000 })

  // The panel follows a plain click once it is open, auto-selecting that commit's first file.
  await commitRow(page, 'add files').click()
  await expect(panel.getByTestId('commit-stats')).toContainText('3 files', { timeout: 10_000 })
  await expect(panel.getByTestId('commit-file-row').first()).toContainText('nested.txt')
  await expect(panel.getByTestId('diff-body')).toContainText('nested one')

  await fileRow(page, 'keep.txt').click()
  await expect(panel.getByTestId('diff-body')).toContainText('three')

  await panel.getByRole('button', { name: 'Close commit details' }).click()
  await expect(panel).toBeHidden()
  await expect(commitRow(page, 'add files')).toHaveAttribute('data-selected', 'true')
})

const LONG_BODY = Array.from(
  { length: 30 },
  (_unused, index) => `Body paragraph line ${index} explaining the change in some detail.`
).join('\n')

function createWordyRepo(): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'src', 'deep', 'long.txt'), 'seed\n')
  git(['add', '.'])
  git(['commit', '-m', 'seed'])

  const lines = Array.from({ length: 80 }, (_unused, index) => `line ${index}`).join('\n')
  fs.writeFileSync(path.join(repo, 'src', 'deep', 'long.txt'), `${lines}\n`)
  git(['add', '-A'])
  git(['commit', '-m', `feat: a wordy commit\n\n${LONG_BODY}`])
  return repo
}

// A long message must never cost the reader the identity rows, the file tree or the diff — at any
// window size, and at any remembered panel height. 800x560 is the app's smallest window.
const PANEL_LAYOUT_CASES = [
  { width: 1600, height: 1000, storedHeight: 900 },
  { width: 1200, height: 800, storedHeight: 360 },
  { width: 1000, height: 700, storedHeight: 360 },
  { width: 800, height: 560, storedHeight: 260 },
  { width: 800, height: 560, storedHeight: 900 }
]

test('keeps every region of the details panel usable at any window size', async ({ harness }) => {
  const repo = createWordyRepo()
  const page = await harness.openRepo(repo)

  for (const size of PANEL_LAYOUT_CASES) {
    await page.evaluate(
      (value) => localStorage.setItem('rebase:commit-details-height', String(value)),
      size.storedHeight
    )
    await setWindowSize(harness.app(), size.width, size.height)
    await page.reload()

    await expect(page.getByText('feat: a wordy commit')).toBeVisible({ timeout: 15_000 })
    await commitRow(page, 'a wordy commit').dblclick()
    const panel = detailsPanel(page)
    await expect(panel.getByTestId('diff-hunk').first()).toBeVisible({ timeout: 10_000 })

    const layout = await page.evaluate(() => {
      const find = (selector: string) => document.querySelector(selector) as HTMLElement | null
      const panelElement = find('[data-testid="commit-details-panel"]')
      const meta = find('[data-testid="commit-meta"]')
      const body = find('[data-testid="commit-body"]')
      const rows = meta?.querySelector('dl') as HTMLElement | null
      const files = find('[data-testid="commit-file-scroll"]')
      const diff = find('[data-testid="commit-details-panel"] [data-testid="diff-body"]')
      const graph = find('[data-testid="history-scroll"]')
      if (!panelElement || !meta || !body || !rows || !files || !diff || !graph) {
        throw new Error('details panel regions missing')
      }
      const panelBox = panelElement.getBoundingClientRect()
      const rowsBox = rows.getBoundingClientRect()
      return {
        rowsFullyInsidePanel:
          rowsBox.top >= panelBox.top - 1 && rowsBox.bottom <= panelBox.bottom + 1,
        metaShareOfPanel: meta.clientHeight / panelElement.clientHeight,
        bodyHeight: body.clientHeight,
        bodyScrolls: body.scrollHeight > body.clientHeight,
        filesHeight: files.clientHeight,
        diffHeight: diff.clientHeight,
        diffScrolls: diff.scrollHeight > diff.clientHeight,
        graphHeight: graph.clientHeight
      }
    })

    const at = `${size.width}x${size.height} @ ${size.storedHeight}px`
    // The labelled rows are the first thing to protect: they never scroll out or get clipped.
    expect(layout.rowsFullyInsidePanel, `rows inside panel at ${at}`).toBe(true)
    // The body gives up space instead, and stays reachable by scrolling.
    expect(layout.bodyHeight, `body visible at ${at}`).toBeGreaterThan(16)
    expect(layout.bodyScrolls, `body scrolls at ${at}`).toBe(true)
    expect(layout.metaShareOfPanel, `metadata share at ${at}`).toBeLessThanOrEqual(0.46)
    // The files and the diff keep the majority, and a long diff scrolls rather than clipping.
    expect(layout.filesHeight, `file tree at ${at}`).toBeGreaterThan(48)
    expect(layout.diffHeight, `diff at ${at}`).toBeGreaterThan(24)
    expect(layout.diffScrolls, `diff scrolls at ${at}`).toBe(true)
    // And the panel never swallows the timeline it belongs to.
    expect(layout.graphHeight, `graph at ${at}`).toBeGreaterThan(64)
  }
})
