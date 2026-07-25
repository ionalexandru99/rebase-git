import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { createFixtureRepo, expect, gitIn, test } from './fixtures'

// A branchy history: several side branches merged back at different points, so the rail has to hold
// multiple lanes, curves in both directions, merge rings and collapsed-merge glyphs at once.
function createBranchyRepo(): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  for (let branch = 0; branch < 4; branch++) {
    git(['checkout', '-b', `feature-${branch}`, 'main'])
    for (let commit = 0; commit < 3; commit++) {
      fs.writeFileSync(path.join(repo, `feature-${branch}.txt`), `work ${commit}\n`)
      git(['add', '.'])
      git(['commit', '-m', `feature ${branch} commit ${commit}`])
    }
    git(['checkout', 'main'])
    fs.writeFileSync(path.join(repo, 'main.txt'), `main ${branch}\n`)
    git(['add', '.'])
    git(['commit', '-m', `main work ${branch}`])
    git(['merge', '--no-ff', '--no-edit', '-m', `merge feature-${branch}`, `feature-${branch}`])
  }
  return repo
}

// Pixels the rail has actually painted. The draw runs on an animation frame, so callers poll this.
function paintedPixels(page: Page, scrollTop?: number): Promise<number> {
  return page.evaluate((offset) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="commit-graph-canvas"]')
    if (!canvas) {
      return 0
    }
    if (offset !== undefined) {
      const scroller = document.querySelector<HTMLElement>('[data-testid="history-scroll"]')
      if (scroller) {
        scroller.scrollTop = offset
      }
    }
    return new Promise<number>((resolve) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const pixels = canvas
            .getContext('2d')
            ?.getImageData(0, 0, canvas.width, canvas.height).data
          let painted = 0
          for (let index = 3; index < (pixels?.length ?? 0); index += 4) {
            if ((pixels as Uint8ClampedArray)[index] > 0) {
              painted++
            }
          }
          resolve(painted)
        })
      )
    })
  }, scrollTop)
}

test('renders the commit graph rail for a branchy history', async ({ harness }) => {
  const repo = createBranchyRepo()
  const page = await harness.openRepo(repo)

  await expect(page.getByTestId('commit-graph-canvas')).toBeVisible()
  await expect(page.getByTestId('commit-row').first()).toBeVisible()

  // The rail is genuinely drawn, not a blank bitmap sized to the viewport.
  await expect.poll(() => paintedPixels(page)).toBeGreaterThan(500)
})

test('renders side-branch lanes when a merge is expanded', async ({ harness }) => {
  const repo = createBranchyRepo()
  const page = await harness.openRepo(repo)
  await expect(page.getByTestId('commit-row').first()).toBeVisible()

  // Expanding shifts the rows below, so each click is resolved against the current DOM.
  for (let merge = 0; merge < 2; merge++) {
    await page.getByRole('button', { name: 'Expand merge side branch' }).first().click()
  }

  await expect(page.getByText('feature 3 commit 2')).toBeVisible()

  const railOffsets = await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="commit-row"]')]
    return rows.map((row) => row.querySelector<HTMLElement>('span[style*="left"]')?.style.left)
  })

  // Side-branch rows sit a lane further in than the mainline, so their text starts further right.
  expect(new Set(railOffsets.filter(Boolean)).size).toBeGreaterThan(1)
})

test('keeps drawing the rail after a fast scroll to the middle of the log', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  for (let commit = 0; commit < 400; commit++) {
    fs.writeFileSync(path.join(repo, 'file.txt'), `commit ${commit}\n`)
    git(['add', '.'])
    git(['commit', '-m', `commit ${commit}`])
  }
  const page = await harness.openRepo(repo)
  await expect(page.getByTestId('commit-row').first()).toBeVisible()

  await expect.poll(() => paintedPixels(page, 0)).toBeGreaterThan(500)
  // The rail follows the live scroll offset rather than the last committed React range.
  await expect.poll(() => paintedPixels(page, 4_000)).toBeGreaterThan(500)
})
