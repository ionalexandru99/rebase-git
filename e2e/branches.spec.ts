import fs from 'node:fs'
import path from 'node:path'
import {
  createFixtureRepo,
  currentBranch,
  expect,
  gitIn,
  localBranches,
  refTree,
  revParse,
  test
} from './fixtures'

test('double-clicking a branch leaf checks it out and moves the current pill', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const git = gitIn(repo)
  git(['checkout', '-b', 'feature'])
  fs.writeFileSync(path.join(repo, 'extra.txt'), 'extra\n')
  git(['add', '.'])
  git(['commit', '-m', 'extra commit'])
  git(['checkout', 'main'])
  const page = await harness.openRepo(repo)

  const tree = refTree(page)
  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })

  const featureLeaf = tree.getByTitle('feature', { exact: true })
  await expect(featureLeaf).toBeVisible({ timeout: 10_000 })
  await featureLeaf.dblclick()

  await expect(page.getByRole('button', { name: 'feature current' })).toBeVisible({
    timeout: 10_000
  })
  await expect(page.getByRole('button', { name: 'main current' })).toBeHidden()
  await expect(tree.getByTitle('feature', { exact: true }).getByTestId('current-ref-check')).toBeVisible()

  expect(currentBranch(repo)).toBe('feature')
})

test('creating a branch from a leaf context menu checks it out', async ({ harness }) => {
  const repo = createFixtureRepo()
  const page = await harness.openRepo(repo)

  const tree = refTree(page)
  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })
  await expect(tree.getByRole('button', { name: 'Local branches 1' })).toBeVisible({
    timeout: 10_000
  })

  await tree.getByTitle('main', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New branch from here' }).click()

  await page.getByLabel('Branch name').fill('wip')
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByRole('button', { name: 'wip current' })).toBeVisible({ timeout: 10_000 })
  await expect(tree.getByTitle('wip', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(tree.getByRole('button', { name: 'Local branches 2' })).toBeVisible({
    timeout: 10_000
  })

  expect(currentBranch(repo)).toBe('wip')
  expect(localBranches(repo).sort()).toEqual(['main', 'wip'])
  expect(revParse(repo, 'wip')).toBe(revParse(repo, 'main'))
})

test('renames a non-current branch through the ref-tree context menu', async ({ harness }) => {
  const repo = createFixtureRepo({ branches: ['feature'] })
  const page = await harness.openRepo(repo)

  const tree = refTree(page)
  const featureLeaf = tree.getByTitle('feature', { exact: true })
  await expect(featureLeaf).toBeVisible({ timeout: 10_000 })

  await featureLeaf.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Rename/ }).click()

  const nameInput = page.getByLabel('New branch name')
  await expect(nameInput).toBeVisible({ timeout: 10_000 })
  await nameInput.fill('feature2')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()

  await expect(tree.getByTitle('feature2', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(tree.getByTitle('feature', { exact: true })).toBeHidden({ timeout: 10_000 })

  expect(localBranches(repo).sort()).toEqual(['feature2', 'main'])
})

test('deletes a non-current branch through the context menu and confirm dialog', async ({
  harness
}) => {
  const repo = createFixtureRepo({ branches: ['feature'] })
  const page = await harness.openRepo(repo)

  const tree = refTree(page)
  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })

  const featureBranch = tree.getByTitle('feature', { exact: true })
  await expect(featureBranch).toBeVisible({ timeout: 10_000 })

  const localBranchesSection = tree.getByRole('button', { name: /Local branches/ })
  await expect(localBranchesSection).toContainText('2', { timeout: 10_000 })

  await featureBranch.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()

  const confirmDialog = page.getByRole('dialog')
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: 'Delete' }).click()

  await expect(featureBranch).toBeHidden({ timeout: 10_000 })
  await expect(localBranchesSection).toContainText('1', { timeout: 10_000 })

  expect(localBranches(repo)).toEqual(['main'])
})
