import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { commitRow, detailsPanel, diffLine, diffLines, diffScrollHost } from './diff-locators'
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

const fileRow = (page: Page, name: string) =>
  detailsPanel(page).getByTestId('commit-file-row').filter({ hasText: name })

test('shows a commit’s message, identity, files and diff in the detail pane', async ({
  harness
}) => {
  const repo = createDetailRepo()
  const sha = revParse(repo, 'HEAD')
  const parentSha = revParse(repo, 'HEAD^')
  const page = await harness.openRepo(repo)

  const panel = detailsPanel(page)
  await expect(panel).toBeVisible({ timeout: 10_000 })
  await expect(panel.getByTestId('commit-meta')).toContainText('reshape the files', {
    timeout: 15_000
  })

  await commitRow(page, 'reshape the files').click()

  await expect(panel.getByTestId('commit-body')).toContainText('The body explains the rationale.')
  const meta = panel.getByTestId('commit-meta')
  await expect(meta.getByText('Ada Author')).toBeVisible()
  await expect(meta.getByText('ada@example.com')).toBeVisible()
  await expect(meta.getByTestId('commit-detail-sha')).toHaveText(sha.slice(0, 7))
  await expect(meta.getByTestId('commit-detail-parents')).toContainText(parentSha.slice(0, 7))
  await expect(panel.getByTestId('commit-stats')).toContainText('4 files')
  await expect(panel.getByRole('button', { name: `Copy full SHA ${sha}` })).toBeVisible()

  const directories = panel.getByTestId('commit-directory-row')
  await expect(directories).toHaveCount(1)
  await expect(directories.first()).toContainText('src/deep')

  const fileRows = panel.getByTestId('commit-file-row')
  await expect(fileRows).toHaveCount(4)
  await expect(fileRows.nth(0)).toContainText('nested.txt')
  await expect(fileRows.nth(1)).toContainText('doomed.txt')
  await expect(fileRows.nth(2)).toContainText('fresh.txt')
  await expect(fileRows.nth(3)).toContainText('keep.txt')

  await expect(diffLines(page).first()).toBeVisible({ timeout: 10_000 })
  await expect(diffLine(page, 'nested TWO').first()).toBeVisible()

  await fileRow(page, 'keep.txt').click()
  await expect(diffLine(page, /^TWO$/).first()).toBeVisible()

  await expect(panel.locator('input[type="checkbox"]')).toHaveCount(0)
})

test('collapses a directory in the changed-files tree without changing the diff', async ({
  harness
}) => {
  const repo = createDetailRepo()
  const page = await harness.openRepo(repo)

  await expect(commitRow(page, 'reshape the files')).toBeVisible({ timeout: 10_000 })
  await commitRow(page, 'reshape the files').click()

  const panel = detailsPanel(page)
  await expect(diffLines(page).first()).toBeVisible({ timeout: 10_000 })
  await expect(fileRow(page, 'nested.txt')).toBeVisible()

  await panel.getByTestId('commit-directory-row').click()

  await expect(fileRow(page, 'nested.txt')).toHaveCount(0)
  await expect(fileRow(page, 'keep.txt')).toBeVisible()
  await expect(diffLine(page, 'nested TWO').first()).toBeVisible()

  await panel.getByTestId('commit-directory-row').click()
  await expect(fileRow(page, 'nested.txt')).toBeVisible()
})

test('scrolls a long commit diff inside the pane', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const lines = Array.from({ length: 400 }, (_unused, index) => `line ${index}`).join('\n')
  fs.writeFileSync(path.join(repo, 'big.txt'), `${lines}\n`)
  git(['add', '.'])
  git(['commit', '-m', 'add a long file'])
  const page = await harness.openRepo(repo)

  await expect(commitRow(page, 'add a long file')).toBeVisible({ timeout: 10_000 })
  await commitRow(page, 'add a long file').click()

  await expect(diffLines(page).first()).toBeVisible({ timeout: 10_000 })

  const host = diffScrollHost(page)
  const overflows = await host.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1
  )
  expect(overflows).toBe(true)

  await host.evaluate((element) => {
    element.scrollTop = 400
  })
  expect(await host.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

test('selects several commits and summarises them instead of guessing a merged diff', async ({
  harness
}) => {
  const repo = createDetailRepo()
  const page = await harness.openRepo(repo)

  await expect(commitRow(page, 'reshape the files')).toBeVisible({ timeout: 10_000 })

  await commitRow(page, 'reshape the files').click()
  await expect(diffLines(page).first()).toBeVisible({ timeout: 10_000 })

  await commitRow(page, 'initial').click({ modifiers: ['Shift'] })

  const panel = detailsPanel(page)
  await expect(panel.getByText('3 commits selected')).toBeVisible()
  const summary = panel.getByTestId('commit-selection-summary')
  await expect(summary).toContainText('reshape the files')
  await expect(summary).toContainText('add files')
  await expect(summary).toContainText('initial')
  await expect(diffLines(page)).toHaveCount(0)

  await page.keyboard.press('Escape')

  await expect(summary).toHaveCount(0)
  await expect(panel.getByTestId('commit-stats')).toContainText('4 files', { timeout: 10_000 })
  await expect(commitRow(page, 'reshape the files')).not.toHaveAttribute('data-selected', 'true')
  await expect(commitRow(page, 'initial')).not.toHaveAttribute('data-selected', 'true')
})

test('follows a single click and returns to HEAD on Escape', async ({ harness }) => {
  const repo = createDetailRepo()
  const page = await harness.openRepo(repo)

  const panel = detailsPanel(page)
  await expect(panel.getByTestId('commit-stats')).toContainText('4 files', { timeout: 15_000 })

  await commitRow(page, 'add files').click()
  await expect(panel.getByTestId('commit-stats')).toContainText('3 files', { timeout: 10_000 })
  await expect(panel.getByTestId('commit-file-row').first()).toContainText('nested.txt')
  await expect(diffLine(page, 'nested one').first()).toBeVisible()
  await expect(commitRow(page, 'add files')).toHaveAttribute('data-selected', 'true')

  await fileRow(page, 'keep.txt').click()
  await expect(diffLine(page, /^three$/).first()).toBeVisible()

  await commitRow(page, 'add files').dblclick()
  await expect(commitRow(page, 'add files')).toHaveAttribute('data-selected', 'true')
  await expect(panel.getByTestId('commit-stats')).toContainText('3 files')

  await page.keyboard.press('Escape')

  await expect(commitRow(page, 'add files')).not.toHaveAttribute('data-selected', 'true')
  await expect(panel.getByTestId('commit-stats')).toContainText('4 files', { timeout: 10_000 })
  await expect(panel.getByTestId('commit-meta')).toContainText('reshape the files')
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

const PANE_LAYOUT_CASES = [
  { width: 1600, height: 1000, listPaneWidth: 820 },
  { width: 1600, height: 1000, listPaneWidth: 300 },
  { width: 1200, height: 800, listPaneWidth: 400 },
  { width: 1000, height: 700, listPaneWidth: 300 },
  { width: 800, height: 600, listPaneWidth: 300 }
]

const LAUNCH_WINDOW = { width: 1200, height: 800 }

test('keeps every region of the detail pane usable at any window and list width', async ({
  harness
}) => {
  test.setTimeout(120_000)
  const repo = createWordyRepo()

  try {
    for (const size of PANE_LAYOUT_CASES) {
      await setWindowSize(harness.app(), size.width, size.height)
      const page = await harness.openRepo(repo, {
        listPaneWidths: { [repo]: size.listPaneWidth }
      })

      const wordyCommit = commitRow(page, 'a wordy commit')
      await expect(wordyCommit).toBeVisible({ timeout: 15_000 })
      await wordyCommit.click()
      await expect(detailsPanel(page)).toBeVisible({ timeout: 10_000 })
      await expect(diffLines(page).first()).toBeVisible({ timeout: 20_000 })

      const layout = await page.evaluate(() => {
        const find = (selector: string) => document.querySelector(selector) as HTMLElement | null
        const paneElement = find('[data-testid="commit-detail-pane"]')
        const meta = find('[data-testid="commit-meta"]')
        const body = find('[data-testid="commit-body"]')
        const files = find('[data-testid="commit-file-scroll"]')
        const split = find('[data-testid="commit-detail-split"]')
        const diff = find('[data-testid="commit-detail-pane"] [data-testid="diff-body"]')
        const diffHost = diff?.firstElementChild as HTMLElement | null
        const diffColumn = split?.lastElementChild as HTMLElement | null
        const list = find('[data-testid="history-scroll"]')
        const dock = find('[data-testid="status-dock"]')
        const shell = find('[data-testid="repo-shell"]')
        if (
          !paneElement ||
          !meta ||
          !body ||
          !files ||
          !split ||
          !diff ||
          !diffHost ||
          !diffColumn ||
          !list ||
          !dock ||
          !shell
        ) {
          throw new Error('detail pane regions missing')
        }
        const paneBox = paneElement.getBoundingClientRect()
        const metaBox = meta.getBoundingClientRect()
        const shellBox = shell.getBoundingClientRect()
        return {
          metaFullyInsidePane:
            metaBox.top >= paneBox.top - 1 && metaBox.bottom <= paneBox.bottom + 1,
          metaShareOfPane: meta.clientHeight / paneElement.clientHeight,
          bodyHeight: body.clientHeight,
          bodyContentReachable: body.scrollHeight <= body.clientHeight + 1 || body.clientHeight > 40,
          filesWidth: files.clientWidth,
          filesHeight: files.clientHeight,
          diffWidth: diffColumn.clientWidth,
          diffHeight: diffHost.clientHeight,
          diffScrolls: diffHost.scrollHeight > diffHost.clientHeight,
          listWidth: list.clientWidth,
          listHeight: list.clientHeight,
          dockHeight: dock.clientHeight,
          paneInsideShell: paneBox.right <= shellBox.right + 1
        }
      })

      const at = `${size.width}x${size.height} @ list ${size.listPaneWidth}px`
      expect(layout.metaFullyInsidePane, `meta inside pane at ${at}`).toBe(true)
      expect(layout.bodyHeight, `body visible at ${at}`).toBeGreaterThan(16)
      expect(layout.bodyContentReachable, `body content reachable at ${at}`).toBe(true)
      expect(layout.metaShareOfPane, `metadata share at ${at}`).toBeLessThanOrEqual(0.46)
      expect(layout.filesWidth, `file tree width at ${at}`).toBeGreaterThan(72)
      expect(layout.filesHeight, `file tree height at ${at}`).toBeGreaterThan(48)
      expect(layout.diffWidth, `diff width at ${at}`).toBeGreaterThan(112)
      expect(layout.diffHeight, `diff height at ${at}`).toBeGreaterThan(24)
      expect(layout.diffScrolls, `diff scrolls at ${at}`).toBe(true)
      expect(layout.listWidth, `commit list at ${at}`).toBeGreaterThan(120)
      expect(layout.listHeight, `commit list height at ${at}`).toBeGreaterThan(64)
      expect(layout.dockHeight, `status dock at ${at}`).toBeGreaterThan(0)
      expect(layout.paneInsideShell, `detail pane inside the shell at ${at}`).toBe(true)
    }
  } finally {
    await setWindowSize(harness.app(), LAUNCH_WINDOW.width, LAUNCH_WINDOW.height)
  }
})
