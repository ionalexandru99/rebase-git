import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { advanceRemote, createFixtureRepoWithRemote, expect, gitIn, test } from './fixtures'

const revParse = (repo: string, ref: string): string =>
  execFileSync('git', ['rev-parse', ref], { cwd: repo, encoding: 'utf8' }).trim()

test('force-push republishes a Diverged branch, escalating to a pinned overwrite when refused', async ({
  harness
}) => {
  const { repo, remote } = createFixtureRepoWithRemote()
  harness.track(path.dirname(remote))
  const git = gitIn(repo)

  fs.writeFileSync(path.join(repo, 'work.txt'), 'v1\n')
  git(['add', '.'])
  git(['commit', '-m', 'feature work'])
  git(['push'])

  fs.writeFileSync(path.join(repo, 'work.txt'), 'v2\n')
  git(['commit', '-a', '--amend', '-m', 'feature work (amended)'])

  advanceRemote(remote, 'teammate work')

  const page = await harness.openRepo(repo)
  await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible({ timeout: 10_000 })

  const pushButton = page.getByRole('button', { name: 'Push', exact: true })
  await expect(pushButton).toBeVisible({ timeout: 10_000 })
  await pushButton.click()

  const tier1 = page.getByRole('button', { name: /force push \(with lease\)/i })
  await expect(tier1).toBeVisible({ timeout: 10_000 })
  await tier1.click()

  const dialog = page.getByRole('dialog')
  const overwrite = dialog.getByRole('button', { name: /overwrite remote anyway/i })
  await expect(overwrite).toBeVisible({ timeout: 10_000 })
  await expect(dialog.getByText('teammate work')).toBeVisible()
  await overwrite.click()

  await expect(page.getByText('Overwrote remote')).toBeVisible({ timeout: 10_000 })

  expect(revParse(repo, 'main')).toBe(revParse(repo, 'origin/main'))
})
