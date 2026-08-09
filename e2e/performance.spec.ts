import fs from 'node:fs'
import path from 'node:path'
import { worktreeDiffLine } from './diff-locators'
import {
  appendLinearCommits,
  createFixtureRepo,
  expect,
  gitIn,
  openLocalChanges,
  stageFileFromRow,
  stagedFileRow,
  test,
  unstageFileFromRow,
  unstagedFileRow
} from './fixtures'

export const latencyCeilingsMilliseconds = {
  startup: 2_000,
  repositoryOpen: 1_000,
  statusRefresh: 500,
  stage: 150,
  unstage: 150,
  diffRender: 200,
  historyPage: 250
} as const

async function measure(task: () => Promise<void>): Promise<number> {
  const startedAt = performance.now()
  await task()
  return performance.now() - startedAt
}

async function loadedHistoryCount(page: import('@playwright/test').Page): Promise<number> {
  const summary = page.getByText(/[\d,]+ loaded · more available/)
  if ((await summary.count()) === 0) {
    return 0
  }
  const text = await summary.textContent()
  const match = text?.match(/([\d,]+) loaded/)
  return match ? Number(match[1]?.replaceAll(',', '')) : 0
}

const statusObservationKey = '__REBASE_STATUS_OBSERVED_AT__'

async function observeStatusFile(page: import('@playwright/test').Page, file: string): Promise<void> {
  await page.evaluate(
    ({ key, expectedFile }) => {
      const target = window as unknown as Record<string, unknown>
      target[key] = null
      const scan = () => {
        const visible = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="status-file-row"]')
        ).some(
          (element) =>
            element.dataset.file === expectedFile && element.getClientRects().length > 0
        )
        if (visible && target[key] === null) {
          target[key] = Date.now()
        }
      }
      new MutationObserver(scan).observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true
      })
      scan()
    },
    { key: statusObservationKey, expectedFile: file }
  )
}

async function statusFileObservedAt(page: import('@playwright/test').Page): Promise<number> {
  let observedAt: number | null = null
  await expect
    .poll(
      async () => {
        observedAt = await page.evaluate(
          (key) =>
            ((window as unknown as Record<string, unknown>)[key] as number | null) ?? null,
          statusObservationKey
        )
        return observedAt
      },
      { timeout: 2_000, intervals: [25] }
    )
    .not.toBeNull()
  return observedAt as number
}

function createPerformanceRepo(): string {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  for (let index = 0; index < 200; index++) {
    fs.writeFileSync(path.join(repo, `tracked-${index}.txt`), `tracked ${index}\n`)
  }
  git(['add', '.'])
  git(['commit', '-m', 'representative tracked files'])
  appendLinearCommits(repo, 9_998)
  return repo
}

test('an external edit refreshes visible status within the parity ceiling', async ({ harness }) => {
  const repo = createFixtureRepo()
  const page = await harness.openRepo(repo)
  await openLocalChanges(page)

  await observeStatusFile(page, 'external.txt')
  const startedAt = Date.now()
  fs.writeFileSync(path.join(repo, 'external.txt'), 'changed outside Rebase\n')
  const elapsed = (await statusFileObservedAt(page)) - startedAt

  await expect(unstagedFileRow(page, 'external.txt')).toBeVisible()
  expect(elapsed).toBeLessThanOrEqual(latencyCeilingsMilliseconds.statusRefresh)
})

const baselineTest = process.env.REBASE_PERFORMANCE === '1' ? test : test.skip

baselineTest('records the 0.0.1 parity baseline on a representative repository', async ({
  harness
}, testInfo) => {
  test.setTimeout(180_000)

  const measurements: Record<keyof typeof latencyCeilingsMilliseconds, number> = {
    startup: harness.launchDurationMilliseconds(),
    repositoryOpen: 0,
    statusRefresh: 0,
    stage: 0,
    unstage: 0,
    diffRender: 0,
    historyPage: 0
  }
  const repo = createPerformanceRepo()
  let page = harness.page
  let initialLoadedHistoryCount = 0

  measurements.repositoryOpen = await measure(async () => {
    page = await harness.openRepo(repo)
    await expect(page.getByText(/[\d,]+ loaded · more available/)).toBeVisible({ timeout: 30_000 })
    initialLoadedHistoryCount = await loadedHistoryCount(page)
  })

  measurements.historyPage = await measure(async () => {
    await page
      .getByTestId('history-scroll')
      .evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect
      .poll(() => loadedHistoryCount(page), { timeout: 30_000 })
      .toBeGreaterThan(initialLoadedHistoryCount)
  })

  await openLocalChanges(page)
  await observeStatusFile(page, 'working.txt')
  const externalEditStartedAt = Date.now()
  fs.writeFileSync(
    path.join(repo, 'working.txt'),
    Array.from({ length: 100 }, (_unused, index) => `working line ${index}`).join('\n') + '\n'
  )
  measurements.statusRefresh = (await statusFileObservedAt(page)) - externalEditStartedAt

  measurements.diffRender = await measure(async () => {
    await unstagedFileRow(page, 'working.txt')
      .getByRole('button', { name: 'working.txt', exact: true })
      .click()
    await expect(worktreeDiffLine(page, 'working line 0').first()).toBeVisible({ timeout: 2_000 })
  })

  measurements.stage = await measure(async () => {
    await stageFileFromRow(page, 'working.txt')
    await expect(stagedFileRow(page, 'working.txt')).toBeVisible({ timeout: 2_000 })
  })

  measurements.unstage = await measure(async () => {
    await unstageFileFromRow(page, 'working.txt')
    await expect(unstagedFileRow(page, 'working.txt')).toBeVisible({ timeout: 2_000 })
  })

  await testInfo.attach('performance-results.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          deployment: harness.deploymentName,
          platform: `${process.platform}-${process.arch}`,
          repository: { commits: 10_000, trackedFiles: 202 },
          cacheState: 'cold application profile; warm OS filesystem cache after fixture creation',
          ceilingsMilliseconds: latencyCeilingsMilliseconds,
          measurementsMilliseconds: measurements
        },
        null,
        2
      )
    ),
    contentType: 'application/json'
  })

  for (const metric of Object.keys(latencyCeilingsMilliseconds) as Array<
    keyof typeof latencyCeilingsMilliseconds
  >) {
    expect(measurements[metric], metric).toBeLessThanOrEqual(latencyCeilingsMilliseconds[metric])
  }
})
