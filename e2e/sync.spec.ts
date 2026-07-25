import path from 'node:path'
import { commitSubjects, createFixtureRepo, expect, revParse, test } from './fixtures'

test('a Push on a repo with no remote surfaces an error toast', async ({ harness }) => {
  const repo = createFixtureRepo()
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })

  const headBefore = revParse(repo, 'HEAD')

  const pushButton = page.getByRole('button', { name: 'Push', exact: true })
  await expect(pushButton).toBeVisible({ timeout: 10_000 })
  const toast = await harness.expectToast(
    { type: 'error', title: 'Pushed failed' },
    () => pushButton.click()
  )
  expect(toast.description).not.toBe('')

  expect(revParse(repo, 'HEAD')).toBe(headBefore)
  expect(commitSubjects(repo)).toEqual(['initial'])
})
