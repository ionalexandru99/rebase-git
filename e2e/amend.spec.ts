import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureRepo, expect, gitIn, openHistory, openLocalChanges, test } from './fixtures'

const gitOut = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })

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

test('drops a file from the last commit while amending, surfacing it as a working change', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  // A second commit adds feature.txt — this becomes HEAD, the commit we amend.
  fs.writeFileSync(path.join(repo, 'feature.txt'), 'feature\n')
  git(['add', '.'])
  git(['commit', '-m', 'add feature'])

  const page = await harness.openRepo(repo)
  await openLocalChanges(page)

  const amendToggle = page.getByRole('checkbox', { name: /amend last commit/i })
  await expect(amendToggle).toBeVisible({ timeout: 10_000 })
  await amendToggle.click()

  // The "From last commit" group lists feature.txt kept (checked); untick it to drop.
  const dropToggle = page.getByRole('checkbox', { name: /drop feature\.txt from last commit/i })
  await expect(dropToggle).toBeVisible({ timeout: 10_000 })
  await dropToggle.click()

  // Dropping flips the row to its kept-out state: the checkbox is now an unchecked "Keep" control.
  await expect(page.getByRole('checkbox', { name: /keep feature\.txt in last commit/i })).not.toBeChecked()

  const amendButton = page.getByRole('button', { name: 'Amend', exact: true })
  await expect(amendButton).toBeEnabled()
  await amendButton.click()

  // The amend lands: the rewritten commit no longer carries the dropped file.
  const headHasFeature = () => {
    try {
      git(['show', 'HEAD:feature.txt'])
      return true
    } catch {
      return false
    }
  }
  await expect.poll(headHasFeature, { timeout: 10_000 }).toBe(false)

  // ...and it surfaces as an untracked working-tree change.
  await expect(page.getByRole('checkbox', { name: /stage feature\.txt/i })).toBeVisible({
    timeout: 10_000
  })
})

test('drops a single hunk of a last-commit file while amending, keeping the rest', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  const parent = 'a1\na2\na3\na4\na5\na6\na7\na8\na9\na10\na11\na12\na13\n'
  const head = 'A1\na2\na3\na4\na5\na6\na7\na8\na9\na10\na11\na12\nA13\n'
  fs.writeFileSync(path.join(repo, 'multi.txt'), parent)
  git(['add', '.'])
  git(['commit', '-m', 'add multi'])
  fs.writeFileSync(path.join(repo, 'multi.txt'), head)
  git(['add', '.'])
  git(['commit', '-m', 'edit multi top and bottom'])

  const page = await harness.openRepo(repo)
  await openLocalChanges(page)

  const amendToggle = page.getByRole('checkbox', { name: /amend last commit/i })
  await expect(amendToggle).toBeVisible({ timeout: 10_000 })
  await amendToggle.click()

  // Select the last-commit file to inspect its committed diff, then drop just its first hunk.
  await page.getByText('multi.txt').click()
  const firstHunkDrop = page.getByRole('checkbox', { name: 'Drop hunk' }).first()
  await expect(firstHunkDrop).toBeVisible({ timeout: 10_000 })
  await firstHunkDrop.click()

  const amendButton = page.getByRole('button', { name: 'Amend', exact: true })
  await expect(amendButton).toBeEnabled()
  await amendButton.click()

  // The dropped hunk (top) reverts to the parent line while the kept hunk (bottom) stays in the commit.
  await expect.poll(() => gitOut(repo, 'show', 'HEAD:multi.txt').split('\n')[0], {
    timeout: 10_000
  }).toBe('a1')
  expect(gitOut(repo, 'show', 'HEAD:multi.txt').trimEnd().split('\n').at(-1)).toBe('A13')
})
