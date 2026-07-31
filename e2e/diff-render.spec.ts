import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import {
  commitRow,
  detailsPanel,
  diffBody,
  diffLine,
  diffLines,
  diffPre,
  diffScrollHost,
  styleButton
} from './diff-locators'
import { createFixtureRepo, expect, gitIn, test } from './fixtures'

const PINNED_COMMIT_ENV = {
  GIT_AUTHOR_DATE: '2024-05-06T07:08:09Z',
  GIT_COMMITTER_DATE: '2024-05-06T07:08:09Z'
}

function commitAllPinned(repo: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', message], {
    cwd: repo,
    stdio: 'ignore',
    env: { ...process.env, ...PINNED_COMMIT_ENV }
  })
}

function createModifiedFileRepo(): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'alpha\nbravo\ncharlie\ndelta\necho\n')
  git(['add', '-A'])
  git(['commit', '-m', 'seed notes'])
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'alpha\nbravo\nCHARLIE-CHANGED\ndelta\necho\n')
  commitAllPinned(repo, 'update notes')
  return repo
}

async function openCommitDetails(page: Page, subject: string): Promise<void> {
  await expect(commitRow(page, subject)).toBeVisible({ timeout: 15_000 })
  await commitRow(page, subject).dblclick()
  await expect(detailsPanel(page)).toBeVisible({ timeout: 10_000 })
}

interface DiffLineColorReading {
  actual: number[]
  expected: number[]
  overrideResolved: number[]
  appVariable: number[]
}

interface DiffColorReadings {
  addition: DiffLineColorReading
  deletion: DiffLineColorReading
}

function readDiffLineColors(page: Page): Promise<DiffColorReadings> {
  return page.evaluate(() => {
    const toRgba = (color: string): number[] => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        throw new Error('canvas context unavailable')
      }
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    const measureProbe = (parent: ParentNode, background: string): string => {
      const probe = document.createElement('div')
      probe.style.backgroundColor = background
      parent.appendChild(probe)
      const value = getComputedStyle(probe).backgroundColor
      probe.remove()
      return value
    }
    const body = document.querySelector(
      '[data-testid="commit-details-panel"] [data-testid="diff-body"]'
    )
    const container = body?.querySelector('diffs-container')
    const shadowRoot = container?.shadowRoot
    if (!body || !shadowRoot) {
      throw new Error('rendered diff missing')
    }
    const readLine = (lineType: string, overrideName: string, appVariableName: string) => {
      const line = shadowRoot.querySelector(`[data-line][data-line-type="${lineType}"]`)
      if (!line) {
        throw new Error(`rendered ${lineType} line missing`)
      }
      const lineBackgroundFormula = `light-dark(color-mix(in lab, var(--diffs-bg) 88%, var(${appVariableName})), color-mix(in lab, var(--diffs-bg) 80%, var(${appVariableName})))`
      return {
        actual: toRgba(getComputedStyle(line).backgroundColor),
        expected: toRgba(measureProbe(shadowRoot, lineBackgroundFormula)),
        overrideResolved: toRgba(measureProbe(shadowRoot, `var(${overrideName})`)),
        appVariable: toRgba(measureProbe(body, `var(${appVariableName})`))
      }
    }
    return {
      addition: readLine('change-addition', '--diffs-bg-addition-override', '--add-bg'),
      deletion: readLine('change-deletion', '--diffs-bg-deletion-override', '--del-bg')
    }
  })
}

function expectChannelsClose(actual: number[], expected: number[], tolerance: number): void {
  for (let channel = 0; channel < 4; channel++) {
    expect(Math.abs((actual[channel] ?? 0) - (expected[channel] ?? 0))).toBeLessThanOrEqual(
      tolerance
    )
  }
}

test('renders unified by default, switches to split, and persists the choice across reload', async ({
  harness
}) => {
  const repo = createModifiedFileRepo()
  const page = await harness.openRepo(repo)
  await openCommitDetails(page, 'update notes')

  await expect(diffLine(page, 'CHARLIE-CHANGED').first()).toBeVisible({ timeout: 10_000 })
  await expect(styleButton(page, 'Unified')).toHaveAttribute('aria-pressed', 'true')
  await expect(styleButton(page, 'Split')).toHaveAttribute('aria-pressed', 'false')
  await expect(diffPre(page)).toHaveAttribute('data-diff-type', 'single')
  await expect(diffBody(page).locator('code[data-unified]')).toHaveCount(1)

  await styleButton(page, 'Split').click()

  await expect(styleButton(page, 'Split')).toHaveAttribute('aria-pressed', 'true')
  await expect(styleButton(page, 'Unified')).toHaveAttribute('aria-pressed', 'false')
  await expect(diffPre(page)).toHaveAttribute('data-diff-type', 'split')
  await expect(diffBody(page).locator('code[data-deletions]')).toHaveCount(1)
  await expect(diffBody(page).locator('code[data-additions]')).toHaveCount(1)
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('rebase:diff-style')))
    .toBe('split')

  const reloaded = await harness.reload()
  await openCommitDetails(reloaded, 'update notes')

  await expect(diffLine(reloaded, 'CHARLIE-CHANGED').first()).toBeVisible({ timeout: 10_000 })
  await expect(styleButton(reloaded, 'Split')).toHaveAttribute('aria-pressed', 'true')
  await expect(styleButton(reloaded, 'Unified')).toHaveAttribute('aria-pressed', 'false')
  await expect(diffPre(reloaded)).toHaveAttribute('data-diff-type', 'split')
})

test('keeps diff line backgrounds wired to the app palette', async ({ harness }) => {
  const repo = createModifiedFileRepo()
  const page = await harness.openRepo(repo)
  await openCommitDetails(page, 'update notes')
  await expect(diffLine(page, 'CHARLIE-CHANGED').first()).toBeVisible({ timeout: 10_000 })

  const colors = await readDiffLineColors(page)
  expectChannelsClose(colors.addition.actual, colors.addition.expected, 6)
  expectChannelsClose(colors.addition.overrideResolved, colors.addition.appVariable, 4)
  expectChannelsClose(colors.deletion.actual, colors.deletion.expected, 6)
  expectChannelsClose(colors.deletion.overrideResolved, colors.deletion.appVariable, 4)
})

test('emphasises the changed word inside a modified line', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  fs.writeFileSync(path.join(repo, 'config.txt'), 'host = localhost\nport = 8080\nretries = 3\n')
  git(['add', '-A'])
  git(['commit', '-m', 'seed config'])
  fs.writeFileSync(path.join(repo, 'config.txt'), 'host = localhost\nport = 9090\nretries = 3\n')
  git(['add', '-A'])
  git(['commit', '-m', 'change the port'])

  const page = await harness.openRepo(repo)
  await openCommitDetails(page, 'change the port')

  await expect(diffLine(page, 'port = 9090').first()).toBeVisible({ timeout: 10_000 })
  const additionEmphasis = diffBody(page).locator(
    '[data-line-type="change-addition"] [data-diff-span]'
  )
  await expect(additionEmphasis.first()).toBeVisible()
  await expect(additionEmphasis.first()).toContainText('9090')
  const deletionEmphasis = diffBody(page).locator(
    '[data-line-type="change-deletion"] [data-diff-span]'
  )
  await expect(deletionEmphasis.first()).toContainText('8080')
})

test('virtualizes a large diff and materializes late content on scroll', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const lines = Array.from({ length: 2000 }, (_unused, index) => `bulk line ${index}`).join('\n')
  fs.writeFileSync(path.join(repo, 'huge.txt'), `${lines}\n`)
  git(['add', '-A'])
  git(['commit', '-m', 'add a huge file'])

  const page = await harness.openRepo(repo)
  await openCommitDetails(page, 'add a huge file')
  await expect(diffLine(page, 'bulk line 0').first()).toBeVisible({ timeout: 15_000 })

  const host = diffScrollHost(page)
  const overflows = await host.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1
  )
  expect(overflows).toBe(true)
  await expect(diffLine(page, 'bulk line 1999')).toHaveCount(0)

  await host.evaluate((element) => element.scrollTo(0, element.scrollHeight))

  await expect(diffLine(page, 'bulk line 1999').first()).toBeVisible({ timeout: 10_000 })
})

test('matches the commit-details appearance', async ({ harness }) => {
  test.skip(process.platform !== 'linux', 'screenshot baselines are captured on linux only')
  const repo = createFixtureRepo()
  fs.writeFileSync(path.join(repo, 'story.txt'), 'first\nsecond\nthird\nfourth\nfifth\n')
  commitAllPinned(repo, 'seed story')
  fs.writeFileSync(
    path.join(repo, 'story.txt'),
    'first\nsecond CHANGED\nthird\nfourth\nfifth\nsixth added\n'
  )
  commitAllPinned(repo, 'revise the story')

  const page = await harness.openRepo(repo)
  await openCommitDetails(page, 'revise the story')
  await expect(diffLine(page, 'second CHANGED').first()).toBeVisible({ timeout: 10_000 })
  await expect(diffLine(page, 'sixth added').first()).toBeVisible()

  const timestamp = detailsPanel(page).locator('[data-testid="commit-meta"] time')
  await expect(detailsPanel(page)).toHaveScreenshot('commit-details-dark.png', {
    mask: [timestamp]
  })
})

test('shows the binary notice without rendering a diff', async ({ harness }) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
    0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
  ])
  fs.writeFileSync(path.join(repo, 'logo.png'), pngBytes)
  git(['add', '-A'])
  git(['commit', '-m', 'add a logo'])

  const page = await harness.openRepo(repo)
  await openCommitDetails(page, 'add a logo')

  await expect(diffBody(page)).toContainText('Binary file — no preview available.', {
    timeout: 10_000
  })
  await expect(diffBody(page).locator('diffs-container')).toHaveCount(0)
  await expect(diffLines(page)).toHaveCount(0)
})
