import { createFixtureRepo, expect, openHistory, openLocalChanges, test } from './fixtures'

test('rewords the last commit via the amend toggle and lands the new message in history', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const page = await harness.openRepo(repo)

  await openLocalChanges(page)

  // Clean working tree, but there's a HEAD to amend, so the panel + amend toggle are present.
  const amendToggle = page.getByRole('checkbox', { name: /amend last commit/i })
  await expect(amendToggle).toBeVisible({ timeout: 10_000 })
  await amendToggle.click()

  const message = page.getByRole('textbox', { name: 'Commit message' })
  await expect(message).toHaveValue('initial', { timeout: 10_000 })

  await message.fill('reworded via amend')

  const amendButton = page.getByRole('button', { name: 'Amend', exact: true })
  await expect(amendButton).toBeEnabled()
  await amendButton.click()

  await openHistory(page)
  await expect(page.getByText('reworded via amend').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('initial', { exact: true })).toHaveCount(0)
})
