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
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Git identity' })
    .click()

  const appSettings = page.getByRole('group', { name: 'App settings' })
  await appSettings.getByLabel('Name').fill('Ada Lovelace')
  await appSettings.getByLabel('Email').fill('ada@example.com')
  await appSettings.getByRole('button', { name: 'Save' }).click()

  await expect.poll(() => appIdentity(harness.globalGitConfigPath, 'user.name')).toBe('Ada Lovelace')
  await expect
    .poll(() => appIdentity(harness.globalGitConfigPath, 'user.email'))
    .toBe('ada@example.com')

  const repoSettings = page.getByRole('group', { name: 'Repository settings' })
  await expect(repoSettings.getByLabel('Name')).toHaveValue('')
  await expect(repoSettings.getByLabel('Name')).toHaveAttribute('placeholder', 'Ada Lovelace')
  expect(effectiveIdentity(repo, harness.globalGitConfigPath, 'user.name')).toBe('Ada Lovelace')

  await repoSettings.getByLabel('Email').fill('ada@work.example.com')
  await repoSettings.getByRole('button', { name: 'Save' }).click()

  await expect
    .poll(() => gitOut(repo, ['config', '--local', '--get', 'user.email']))
    .toBe('ada@work.example.com')

  await repoSettings.getByRole('button', { name: 'Use app settings for email' }).click()

  await expect.poll(() => readConfig(['--local', 'user.email'], { cwd: repo })).toBe('')
  expect(effectiveIdentity(repo, harness.globalGitConfigPath, 'user.email')).toBe(
    'ada@example.com'
  )

  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(settings).toBeHidden()
})

test('switches sections from the settings nav and returns to the repo on close', async ({
  harness
}) => {
  const repo = createFixtureRepo()

  const page = await harness.openRepo(repo)
  await waitForRepoSurface(page, repo)

  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByTestId('settings-view')
  await expect(settings).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  const generalItem = nav.getByRole('button', { name: 'General' })
  await expect(generalItem).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('region', { name: 'General' })).toBeVisible()

  const gitIdentityItem = nav.getByRole('button', { name: 'Git identity' })
  await gitIdentityItem.click()
  await expect(gitIdentityItem).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('region', { name: 'Git identity' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'App settings' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Repository settings' })).toBeVisible()

  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(settings).toBeHidden()
  await waitForRepoSurface(page, repo)
})

test('renders the Updates section read-only when the build cannot self-update', async ({
  harness
}) => {
  const repo = createFixtureRepo()

  const page = await harness.openRepo(repo)
  await waitForRepoSurface(page, repo)

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Updates' })
    .click()
  await expect(page.getByRole('region', { name: 'Updates' })).toBeVisible()

  const versionRow = page.getByRole('group', { name: 'Version' })
  await expect(versionRow).toBeVisible()
  await expect(versionRow).toContainText(/cannot replace itself|switched off in this build/)
  await expect(versionRow.getByRole('button')).toHaveCount(0)

  const backgroundToggle = page.getByRole('checkbox', {
    name: 'Download updates in the background'
  })
  await expect(backgroundToggle).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: 'Install when I quit' })).toBeDisabled()
})

test('keeps the chosen update channel across settings visits', async ({ harness }) => {
  const repo = createFixtureRepo()

  const page = await harness.openRepo(repo)
  await waitForRepoSurface(page, repo)

  const openUpdatesSection = async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByTestId('settings-view')).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Updates' })
      .click()
    await expect(page.getByRole('region', { name: 'Updates' })).toBeVisible()
  }

  await openUpdatesSection()

  const channelSelect = page
    .getByRole('group', { name: 'Update channel' })
    .getByRole('combobox', { name: 'Update channel' })
  await expect(channelSelect).toHaveValue('stable')
  await expect(page.getByRole('alert')).toHaveCount(0)

  await channelSelect.selectOption('nightly')
  await expect(channelSelect).toHaveValue('nightly')
  await expect(page.getByRole('alert')).toContainText('Nightly builds ship straight from main')

  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeHidden()

  await openUpdatesSection()
  await expect(channelSelect).toHaveValue('nightly')
  await expect(page.getByRole('alert')).toBeVisible()

  await channelSelect.selectOption('stable')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('search jumps to the update channel row', async ({ harness }) => {
  const repo = createFixtureRepo()

  const page = await harness.openRepo(repo)
  await waitForRepoSurface(page, repo)

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await page.keyboard.press('/')
  const searchInput = page.getByRole('combobox', { name: 'Search settings' })
  await expect(searchInput).toBeFocused()

  await searchInput.fill('nightly')
  await expect(page.getByRole('option', { name: /Update channel/ })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeHidden()

  await page.keyboard.press('Enter')

  await expect(
    page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Updates' })
  ).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('group', { name: 'Update channel' })).toBeInViewport()
  await expect(searchInput).toHaveValue('')
})

test('shows the running build in the About section', async ({ harness }) => {
  const repo = createFixtureRepo()

  const page = await harness.openRepo(repo)
  await waitForRepoSurface(page, repo)

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'About' })
    .click()
  await expect(page.getByRole('region', { name: 'About' })).toBeVisible()

  const buildRow = page.getByRole('group', { name: 'Build' })
  await expect(buildRow).toBeVisible()
  await expect(buildRow).toContainText(/Rebase \d+\.\d+\.\d+/)
  await expect(buildRow).toContainText(/Electron \d+/)
  await expect(buildRow.getByRole('button', { name: 'Copy' })).toBeVisible()
})

test('turning off reopen repositories relaunches to a single blank tab', async ({ harness }) => {
  const repo = createFixtureRepo()

  const page = await harness.openRepo(repo)
  await waitForRepoSurface(page, repo)

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  const reopenToggle = page
    .getByRole('group', { name: 'Reopen repositories on launch' })
    .getByRole('checkbox')
  await expect(reopenToggle).toBeChecked()
  await reopenToggle.click()
  await expect(reopenToggle).not.toBeChecked()
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            electronAPI: { getReopenRepositoriesOnLaunch: () => Promise<boolean> }
          }
        ).electronAPI.getReopenRepositoriesOnLaunch()
      )
    )
    .toBe(false)

  const relaunched = await harness.restart()

  await expect(relaunched.getByRole('tab')).toHaveCount(0, { timeout: 10_000 })
  await expect(relaunched.getByRole('heading', { name: 'Open a repository' })).toBeVisible({
    timeout: 10_000
  })
})
