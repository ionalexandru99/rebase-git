import { execFileSync } from 'node:child_process'
import { createFixtureRepo, expect, gitIn, gitOut, test, waitForRepoSurface } from './fixtures'

function readConfig(args: string[], options: { cwd?: string; globalConfigPath?: string }): string {
  try {
    return execFileSync('git', ['config', '--get', ...args], {
      cwd: options.cwd,
      encoding: 'utf8',
      env: options.globalConfigPath
        ? {
            ...process.env,
            GIT_CONFIG_GLOBAL: options.globalConfigPath,
            GIT_CONFIG_NOSYSTEM: '1'
          }
        : process.env
    }).trim()
  } catch {
    return ''
  }
}

function effectiveIdentity(repo: string, globalConfigPath: string, key: string): string {
  return readConfig([key], { cwd: repo, globalConfigPath })
}

function appIdentity(globalConfigPath: string, key: string): string {
  return readConfig(['--file', globalConfigPath, key], {})
}

test('sets the app and repository git identity from the settings view', async ({ harness }) => {
  const repo = createFixtureRepo()
  gitIn(repo)(['config', '--local', '--unset', 'user.name'])

  const page = await harness.openRepo(repo)
  await waitForRepoSurface(page, repo)

  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByTestId('settings-view')
  await expect(settings).toBeVisible()

  const appSettings = page.getByRole('region', { name: 'App settings' })
  await appSettings.getByLabel('Name').fill('Ada Lovelace')
  await appSettings.getByLabel('Email').fill('ada@example.com')
  await appSettings.getByRole('button', { name: 'Save' }).click()

  await expect.poll(() => appIdentity(harness.globalGitConfigPath, 'user.name')).toBe('Ada Lovelace')
  expect(appIdentity(harness.globalGitConfigPath, 'user.email')).toBe('ada@example.com')

  const repoSettings = page.getByRole('region', { name: 'Repository settings' })
  await expect(repoSettings.getByLabel('Name')).toHaveValue('')
  await expect(repoSettings.getByLabel('Name')).toHaveAttribute('placeholder', 'Ada Lovelace')
  expect(effectiveIdentity(repo, harness.globalGitConfigPath, 'user.name')).toBe('Ada Lovelace')

  await repoSettings.getByLabel('Email').fill('ada@work.example.com')
  await repoSettings.getByRole('button', { name: 'Save' }).click()

  await expect
    .poll(() => gitOut(repo, ['config', '--local', '--get', 'user.email']))
    .toBe('ada@work.example.com')

  await repoSettings.getByRole('button', { name: 'Use app settings for email' }).click()

  await expect
    .poll(() => effectiveIdentity(repo, harness.globalGitConfigPath, 'user.email'))
    .toBe('ada@example.com')

  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(settings).toBeHidden()
})
