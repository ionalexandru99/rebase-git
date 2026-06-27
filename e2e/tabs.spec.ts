import fs from 'node:fs'
import path from 'node:path'
import {
  createFixtureRepo,
  expect,
  fileRowCheckbox,
  gitIn,
  openHistory,
  openLocalChanges,
  test
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

  const page = await harness.openTabs([repoA, repoB])

  const tabA = page.getByRole('tab', { name: path.basename(repoA) })
  const tabB = page.getByRole('tab', { name: path.basename(repoB) })
  await expect(tabA).toBeVisible()
  await expect(tabB).toBeVisible()
  await expect(tabA).toHaveAttribute('aria-selected', 'true')
  await expect(tabB).toHaveAttribute('aria-selected', 'false')

  await openLocalChanges(page)
  await fileRowCheckbox(page, 'extra.txt').click()
  await expect(fileRowCheckbox(page, 'extra.txt')).toBeChecked({ timeout: 10_000 })
  await page.getByRole('textbox', { name: 'Commit message' }).fill('alpha commit')
  await page.getByRole('button', { name: /Commit \d+ file/ }).click()

  await openHistory(page)
  await expect(page.getByText('alpha commit').first()).toBeVisible({ timeout: 10_000 })

  await tabB.click()
  await expect(tabB).toHaveAttribute('aria-selected', 'true')
  await expect(tabA).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByText('beta only').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('alpha commit').first()).toBeHidden()

  await tabA.click()
  await expect(tabA).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('alpha commit').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('beta only').first()).toBeHidden()
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
  const page = await harness.relaunch()

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

test('persisted tabs and theme survive a second relaunch without re-seeding', async ({
  harness
}) => {
  const repoA = createFixtureRepo()
  const page = await harness.openRepo(repoA)

  await expect(page.getByRole('tab', { name: path.basename(repoA) })).toBeVisible({
    timeout: 10_000
  })
  await expect(page.locator('html')).toHaveClass(/dark/)

  const switchToLight = page.getByRole('button', { name: 'Switch to light theme' })
  await expect(switchToLight).toBeVisible({ timeout: 10_000 })
  await switchToLight.click()

  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('theme')), { timeout: 10_000 })
    .toBe('light')

  const relaunched = await harness.relaunch()

  await expect(relaunched.getByRole('tab', { name: path.basename(repoA) })).toBeVisible({
    timeout: 10_000
  })
  await expect(relaunched.locator('html')).not.toHaveClass(/dark/)
  await expect(relaunched.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible({
    timeout: 10_000
  })
  expect(await relaunched.evaluate(() => localStorage.getItem('theme'))).toBe('light')
})
