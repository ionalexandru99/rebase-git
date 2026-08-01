import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { createFixtureRepo, expect, gitIn, test } from './fixtures'

function appendLinearCommits(repo: string, count: number): void {
  const stream: string[] = []
  for (let commit = 0; commit < count; commit++) {
    const content = `commit ${commit}\n`
    const message = `commit ${commit}`
    const mark = commit + 1
    stream.push(`blob\nmark :${mark}\ndata ${Buffer.byteLength(content)}\n${content}\n`)
    stream.push(
      'commit refs/heads/main\n' +
        'author Test <test@example.com> 1700000000 +0000\n' +
        'committer Test <test@example.com> 1700000000 +0000\n' +
        `data ${Buffer.byteLength(message)}\n${message}\n` +
        (commit === 0 ? 'from refs/heads/main^0\n' : '') +
        `M 100644 :${mark} file.txt\n\n`
    )
  }
  execFileSync('git', ['fast-import', '--quiet'], {
    cwd: repo,
    input: stream.join(''),
    stdio: ['pipe', 'ignore', 'ignore']
  })
  execFileSync('git', ['reset', '--hard', 'main'], { cwd: repo, stdio: 'ignore' })
}

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

function paintedPixels(page: Page, scrollTop?: number): Promise<number> {
  return page.evaluate((offset) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="commit-graph-canvas"]')
    if (!canvas) {
      return 0
    }
    if (offset !== undefined) {
      const scroller = document.querySelector<HTMLElement>('[data-testid="history-scroll"]')
      if (!scroller) {
        return 0
      }
      scroller.scrollTop = offset
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

  await expect.poll(() => paintedPixels(page)).toBeGreaterThan(500)
})

test('renders side-branch lanes when a merge is expanded', async ({ harness }) => {
  const repo = createBranchyRepo()
  const page = await harness.openRepo(repo)
  await expect(page.getByTestId('commit-row').first()).toBeVisible()

  for (let merge = 0; merge < 2; merge++) {
    await page.getByRole('button', { name: 'Expand merge side branch' }).first().click()
  }

  await expect(page.getByText('feature 3 commit 2')).toBeVisible()

  const railOffsets = await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="commit-row"]')]
    return rows.map((row) => row.querySelector<HTMLElement>('span[style*="left"]')?.style.left)
  })

  expect(new Set(railOffsets.filter(Boolean)).size).toBeGreaterThan(1)
})

test('keeps drawing the rail after a fast scroll to the middle of the log', async ({ harness }) => {
  const repo = createFixtureRepo()
  appendLinearCommits(repo, 400)
  const page = await harness.openRepo(repo)

  await expect.poll(() => paintedPixels(page, 0), { timeout: 20_000 }).toBeGreaterThan(500)
  await expect.poll(() => paintedPixels(page, 4_000), { timeout: 20_000 }).toBeGreaterThan(500)
})
