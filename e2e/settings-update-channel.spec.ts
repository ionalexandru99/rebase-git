import { createFixtureRepo, expect, test, waitForRepoSurface } from './fixtures'

let previousUpdaterFlag: string | undefined

test.beforeAll(() => {
  previousUpdaterFlag = process.env.REBASE_ENABLE_UPDATER
  process.env.REBASE_ENABLE_UPDATER = '1'
})

test.afterAll(() => {
  if (previousUpdaterFlag === undefined) {
    delete process.env.REBASE_ENABLE_UPDATER
  } else {
    process.env.REBASE_ENABLE_UPDATER = previousUpdaterFlag
  }
})

test('keeps the chosen update channel across settings visits', async ({ harness }) => {
  const repo = createFixtureRepo()

  const page = await harness.openRepo(repo)
  await waitForRepoSurface(page, repo)

  const openUpdatesSection = async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByTestId('settings-view')).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Updates' })
      .click()
    await expect(page.getByRole('region', { name: 'Updates' })).toBeVisible()
  }

  await openUpdatesSection()

  const channelSelect = page
    .getByRole('group', { name: 'Update channel' })
    .getByRole('combobox', { name: 'Update channel' })
  await expect(channelSelect).toBeEnabled()
  await expect(channelSelect).toHaveValue('stable')
  await expect(page.getByRole('alert')).toHaveCount(0)

  await channelSelect.selectOption('nightly')
  await expect(channelSelect).toHaveValue('nightly')
  await expect(page.getByRole('alert')).toContainText('Nightly builds ship straight from main')

  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeHidden()

  await openUpdatesSection()
  await expect(channelSelect).toHaveValue('nightly')
  await expect(page.getByRole('alert')).toBeVisible()

  await channelSelect.selectOption('stable')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
