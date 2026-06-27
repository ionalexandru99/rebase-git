import path from 'node:path'
import { createFixtureRepo, expect, test } from './fixtures'

test('a Push on a repo with no remote surfaces an error toast', async ({ harness }) => {
  const repo = createFixtureRepo()
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })

  const pushButton = page.getByRole('button', { name: 'Push' })
  await expect(pushButton).toBeVisible({ timeout: 10_000 })
  await pushButton.click()

  await expect(page.getByText('Pushed failed')).toBeVisible({ timeout: 10_000 })
})
