import { createFixtureRepo, expect, refTree, test } from './fixtures'

test('creates a tag at a branch then deletes it through the Tags section', async ({ harness }) => {
  const repo = createFixtureRepo()
  const page = await harness.openRepo(repo)

  const tree = refTree(page)
  await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({ timeout: 10_000 })

  await tree.getByTitle('main', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Create tag here' }).click()

  const createDialog = page.getByRole('dialog')
  await createDialog.getByLabel('Tag name').fill('v1.0')
  await createDialog.getByRole('button', { name: 'Create' }).click()

  await tree.getByRole('button', { name: /Tags/ }).click()
  await expect(tree.getByTitle('v1.0', { exact: true })).toBeVisible({ timeout: 10_000 })

  await tree.getByTitle('v1.0', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete tag' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()

  await expect(tree.getByTitle('v1.0', { exact: true })).toBeHidden({ timeout: 10_000 })
  await expect(tree.getByRole('button', { name: 'Tags 0' })).toBeVisible({ timeout: 10_000 })
})
