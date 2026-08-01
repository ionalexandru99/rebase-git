import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import {
  commitListWidth,
  createFixtureRepo,
  expect,
  gitIn,
  openLocalChanges,
  setWindowSize,
  test
} from './fixtures'

const LAUNCH_WINDOW = { width: 1200, height: 800 }

test('keeps the four-column shell usable at the minimum window size', async ({ harness }) => {
  const repo = createFixtureRepo()
  fs.appendFileSync(path.join(repo, 'README.md'), 'responsive diff\n')
  let page = await harness.openRepo(repo)
  await page.evaluate(() => localStorage.setItem('rebase:local-files-width', '620'))
  page = await harness.reload()

  try {
    await setWindowSize(harness.app(), 800, 600)

    await expect(page.getByRole('complementary', { name: 'Branches' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Filter refs' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Commits' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Details' })).toBeVisible()
    await expect(page.getByTestId('status-dock')).toBeVisible()
    await expect(page.getByTestId('commit-row').first()).toBeVisible({ timeout: 10_000 })

    await openLocalChanges(page)
    await page
      .getByTestId('status-file-row')
      .getByRole('button', { name: 'README.md', exact: true })
      .click()
    await expect(page.getByTestId('diff-body')).toBeVisible({ timeout: 10_000 })

    const shellFits = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="repo-shell"]') as HTMLElement | null
      const details = document.querySelector('section[aria-label="Details"]') as HTMLElement | null
      const commits = document.querySelector('section[aria-label="Commits"]') as HTMLElement | null
      if (!shell || !details || !commits) {
        throw new Error('shell columns missing')
      }
      const shellBox = shell.getBoundingClientRect()
      const detailsBox = details.getBoundingClientRect()
      return {
        detailsWidth: Math.round(detailsBox.width),
        commitsWidth: Math.round(commits.getBoundingClientRect().width),
        detailsInsideShell: detailsBox.right <= shellBox.right + 1
      }
    })
    expect(shellFits.detailsInsideShell).toBe(true)
    expect(shellFits.detailsWidth).toBeGreaterThan(0)
    expect(shellFits.commitsWidth).toBeGreaterThan(0)

    await setWindowSize(harness.app(), 1280, 800)
    await page.getByRole('button', { name: 'Repository actions' }).click()
    await page.getByRole('menuitem', { name: 'Reset layout' }).click()

    await expect.poll(() => commitListWidth(page), { timeout: 10_000 }).toBe(400)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('rebase:local-files-width')), {
        timeout: 10_000
      })
      .toBe('320')
  } finally {
    await setWindowSize(harness.app(), LAUNCH_WINDOW.width, LAUNCH_WINDOW.height)
  }
})

test('adapts commit rows to the width of the commit list', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  fs.writeFileSync(path.join(repo, 'note.txt'), 'note\n')
  git(['add', '.'])
  git([
    '-c',
    'user.name=Wilhelmina Author',
    '-c',
    'user.email=wilhelmina@example.com',
    'commit',
    '-m',
    'a commit with an author'
  ])

  const rowShape = async (page: Page) => {
    const row = page.getByTestId('commit-row').filter({ hasText: 'a commit with an author' })
    const box = await row.boundingBox()
    return {
      height: Math.round(box?.height ?? 0),
      twoLine: (await row.getByTestId('commit-row-meta').count()) > 0,
      showsAuthorName: (await row.getByText('Wilhelmina Author').count()) > 0
    }
  }

  const expectRowShape = async (
    page: Page,
    expected: { height: number; twoLine: boolean; showsAuthorName: boolean }
  ) => {
    const row = page.getByTestId('commit-row').filter({ hasText: 'a commit with an author' })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => rowShape(page), { timeout: 15_000 }).toEqual(expected)
  }

  const narrowPage = await harness.openRepo(repo, { listPaneWidths: { [repo]: 400 } })
  expect(await commitListWidth(narrowPage)).toBe(400)
  await expectRowShape(narrowPage, {
    height: 44,
    twoLine: true,
    showsAuthorName: true
  })

  const widePage = await harness.openRepo(repo, { listPaneWidths: { [repo]: 560 } })
  expect(await commitListWidth(widePage)).toBe(560)
  await expectRowShape(widePage, {
    height: 30,
    twoLine: false,
    showsAuthorName: false
  })

  const extraWidePage = await harness.openRepo(repo, { listPaneWidths: { [repo]: 700 } })
  expect(await commitListWidth(extraWidePage)).toBe(700)
  await expectRowShape(extraWidePage, {
    height: 30,
    twoLine: false,
    showsAuthorName: true
  })
})
