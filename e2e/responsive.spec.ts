import fs from 'node:fs'
import path from 'node:path'
import { createFixtureRepo, expect, openLocalChanges, test } from './fixtures'

async function setWindowSize(
  harness: { app: () => import('@playwright/test').ElectronApplication },
  width: number,
  height: number
) {
  await harness.app().evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
    },
    { width, height }
  )
}

test('keeps history and diffs usable at the minimum window size', async ({ harness }) => {
  const repo = createFixtureRepo()
  fs.appendFileSync(path.join(repo, 'README.md'), 'responsive diff\n')
  let page = await harness.openRepo(repo)
  await page.evaluate(async () => {
    localStorage.setItem('rebase:local-files-width', '620')
    await (
      window as unknown as {
        electronAPI: {
          setSidebarPrefs: (prefs: { open: boolean; width: number }) => Promise<void>
        }
      }
    ).electronAPI.setSidebarPrefs({ open: true, width: 520 })
  })
  page = await harness.reload()

  await setWindowSize(harness, 800, 600)
  await expect(page.getByRole('button', { name: 'Show branches' })).toBeVisible()
  await expect(page.getByText('initial', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Date', { exact: true })).toBeHidden()
  await expect(page.getByText('SHA', { exact: true })).toBeHidden()

  await openLocalChanges(page)
  await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Diff', exact: true })).toBeVisible()
  await page.getByTestId('status-file-row').getByRole('button', { name: 'README.md' }).click()
  await expect(page.getByRole('button', { name: 'Diff', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByTestId('diff-body')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Show branches' }).click()
  await expect(page.getByRole('button', { name: 'Close branches' }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Close branches' }).last().click()
  await expect(page.getByRole('button', { name: 'Show branches' })).toBeVisible()

  await setWindowSize(harness, 1280, 800)
  await page.getByRole('button', { name: 'Repository actions' }).click()
  await page.getByRole('menuitem', { name: 'Reset layout' }).click()

  await expect(page.getByRole('searchbox', { name: 'Filter refs' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show branches' })).toBeHidden()
  await expect
    .poll(() =>
      page.evaluate(async () => ({
        filesWidth: localStorage.getItem('rebase:local-files-width'),
        sidebar: await (
          window as unknown as {
            electronAPI: {
              getSidebarPrefs: () => Promise<{ open: boolean; width: number }>
            }
          }
        ).electronAPI.getSidebarPrefs()
      }))
    )
    .toEqual({
      filesWidth: '320',
      sidebar: { open: true, width: 256 }
    })
})
