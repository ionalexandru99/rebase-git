import fs from 'node:fs'
import path from 'node:path'
import {
  commitListWidth,
  createFixtureRepo,
  dragListDivider,
  expect,
  stageFileFromRow,
  stagedFileRow,
  gitIn,
  openHistory,
  openLocalChanges,
  test,
  waitForRepoSurface
} from './fixtures'

test('two repos in tabs stay isolated: committing in one leaves the other untouched', async ({
  harness
}) => {
  test.setTimeout(60_000)
  const repoA = createFixtureRepo()
  const repoB = createFixtureRepo()
  const gitA = gitIn(repoA)
  const gitB = gitIn(repoB)
  fs.writeFileSync(path.join(repoA, 'alpha.txt'), 'alpha\n')
  gitA(['add', '.'])
  gitA(['commit', '-m', 'alpha only'])
  fs.writeFileSync(path.join(repoB, 'beta.txt'), 'beta\n')
  gitB(['add', '.'])
  gitB(['commit', '-m', 'beta only'])
  fs.writeFileSync(path.join(repoA, 'extra.txt'), 'extra\n')
  const mainProcessId =
    harness.deploymentName === 'electron' ? await harness.mainProcessId() : undefined

  const page = await harness.openTabs([repoA, repoB])

  if (mainProcessId !== undefined) {
    expect(await harness.mainProcessId()).toBe(mainProcessId)
    expect(harness.launchCount()).toBe(1)
  }
  const tabA = page.getByRole('tab', { name: path.basename(repoA) })
  const tabB = page.getByRole('tab', { name: path.basename(repoB) })
  await expect(tabA).toBeVisible()
  await expect(tabB).toBeVisible()
  await expect(tabA).toHaveAttribute('aria-selected', 'true')
  await expect(tabB).toHaveAttribute('aria-selected', 'false')

  await tabB.click()
  await waitForRepoSurface(page, repoB)
  await tabA.click()
  await waitForRepoSurface(page, repoA)

  await openLocalChanges(page)
  await stageFileFromRow(page, 'extra.txt')
  await expect(stagedFileRow(page, 'extra.txt')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('textbox', { name: 'Commit message' }).fill('alpha commit')
  await page.getByRole('button', { name: /Commit \d+ file/ }).click()

  await openHistory(page)
  await expect(page.getByText('alpha commit').first()).toBeVisible({ timeout: 10_000 })
  const selectedCommit = page.getByTestId('commit-row').filter({ hasText: 'alpha only' })
  await selectedCommit.click()
  await expect(selectedCommit).toHaveAttribute('data-selected', 'true')

  await tabB.click()
  await expect(tabB).toHaveAttribute('aria-selected', 'true')
  await expect(tabA).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByText('beta only').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('alpha commit').first()).toBeHidden()

  await tabA.click()
  await expect(tabA).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('alpha commit').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('beta only').first()).toBeHidden()
  await expect(selectedCommit).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('commit-detail-pane').filter({ visible: true })).toContainText(
    'alpha only'
  )
})

test('a destructive dialog from an inactive repo is hidden and cannot be activated', async ({
  harness
}) => {
  const repoA = createFixtureRepo()
  const repoB = createFixtureRepo()
  const readmePath = path.join(repoA, 'README.md')
  fs.writeFileSync(readmePath, '# fixture\nrepo A change\n')
  const page = await harness.openTabs([repoA, repoB])

  await openLocalChanges(page)
  await page.getByRole('button', { name: 'Discard all' }).click()

  const dialog = page.getByRole('dialog')
  const destructiveAction = dialog.getByRole('button', { name: 'Discard all' })
  await expect(dialog).toBeVisible()

  const tabB = page.getByRole('tab', { name: path.basename(repoB) })
  await tabB.evaluate((element) => (element as HTMLButtonElement).click())

  await expect(tabB).toHaveAttribute('aria-selected', 'true')
  await expect(dialog).toBeHidden()
  await expect(destructiveAction.click({ timeout: 500 })).rejects.toThrow()
  expect(fs.readFileSync(readmePath, 'utf8')).toContain('repo A change')
})

test('opens a repo from the picker and re-opening routes to the existing tab', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const repoName = path.basename(repo)
  harness.track(repo)
  await harness.seed({
    workspaces: [path.dirname(repo)],
    recentRepos: [repo],
    onboardingComplete: true,
    tabs: [null],
    activeIndex: 0
  })
  const page = await harness.reload()

  await expect(page.getByRole('heading', { name: 'Open a repository' })).toBeVisible({
    timeout: 10_000
  })

  const recentCard = page.getByTestId('repo-picker-recent').filter({ hasText: repoName }).first()
  await expect(recentCard).toBeVisible({ timeout: 10_000 })
  await recentCard.click()

  const repoTab = page.getByRole('tab', { name: repoName })
  await expect(repoTab).toHaveCount(1, { timeout: 10_000 })
  await expect(repoTab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })

  await page.getByRole('button', { name: 'Open new tab' }).click()
  await expect(page.getByRole('heading', { name: 'Open a repository' })).toBeVisible({
    timeout: 10_000
  })
  await expect(page.getByRole('button', { name: 'Open new tab' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  const recentCardAgain = page
    .getByTestId('repo-picker-recent')
    .filter({ hasText: repoName })
    .first()
  await expect(recentCardAgain).toBeVisible({ timeout: 10_000 })
  await recentCardAgain.click()

  await expect(repoTab).toHaveCount(1, { timeout: 10_000 })
  await expect(repoTab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
})

test('closing tabs activates the survivor; closing the last resets to a blank picker tab', async ({
  harness
}) => {
  const repoA = createFixtureRepo()
  const repoB = createFixtureRepo()
  const basenameA = path.basename(repoA)
  const basenameB = path.basename(repoB)
  const page = await harness.openTabs([repoA, repoB])

  await expect(page.getByRole('tab')).toHaveCount(2, { timeout: 10_000 })

  await page.getByRole('button', { name: `Close tab ${basenameB}`, exact: true }).click()

  await expect(page.getByRole('tab')).toHaveCount(1, { timeout: 10_000 })
  await expect(page.getByRole('tab')).toHaveAccessibleName(basenameA)
  await expect(page.getByRole('tab')).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('button', { name: `Close tab ${basenameA}`, exact: true }).click()

  await expect(page.getByRole('tab')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByRole('heading', { name: 'Open a repository' })).toBeVisible({
    timeout: 10_000
  })
})

test('persisted tabs and their commit-list width survive a second relaunch without re-seeding', async ({
  harness
}) => {
  const repoA = createFixtureRepo()
  const page = await harness.openRepo(repoA)

  await expect(page.getByRole('tab', { name: path.basename(repoA) })).toBeVisible({
    timeout: 10_000
  })
  await expect.poll(() => commitListWidth(page), { timeout: 10_000 }).toBe(400)

  await dragListDivider(page, 180)
  await expect.poll(() => commitListWidth(page), { timeout: 10_000 }).toBe(580)

  const mainProcessId =
    harness.deploymentName === 'electron' ? await harness.mainProcessId() : undefined
  const relaunched = await harness.restart()

  if (mainProcessId !== undefined) {
    expect(await harness.mainProcessId()).not.toBe(mainProcessId)
    expect(harness.launchCount()).toBe(2)
  }
  await expect(relaunched.getByRole('tab', { name: path.basename(repoA) })).toBeVisible({
    timeout: 10_000
  })
  await expect.poll(() => commitListWidth(relaunched), { timeout: 15_000 }).toBe(580)
  if (harness.deploymentName === 'electron') {
    await expect.poll(() => harness.inspectLifecycle()).toMatchObject({
      sidecarProcessCount: 1,
      sidecarRespawnCount: 0
    })
  }
})
