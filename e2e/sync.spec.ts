import path from 'node:path'
import {
  commitSubjects,
  createFixtureRepo,
  expect,
  makeBranchAheadOfOrigin,
  revParse,
  syncButton,
  test
} from './fixtures'

test('a Sync that pushes a repo with no remote surfaces an error toast', async ({ harness }) => {
  const repo = createFixtureRepo()
  makeBranchAheadOfOrigin(repo)
  const page = await harness.openRepo(repo)

  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })

  const headBefore = revParse(repo, 'HEAD')

  const sync = syncButton(page)
  await expect(sync).toContainText('↑1', { timeout: 10_000 })
  const toast = await harness.expectToast({ type: 'error', title: 'Pushed failed' }, () =>
    sync.click()
  )
  expect(toast.description).not.toBe('')

  expect(revParse(repo, 'HEAD')).toBe(headBefore)
  expect(commitSubjects(repo)).toEqual(['work to publish', 'initial'])
})
