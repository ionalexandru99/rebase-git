import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureRepo, expect, test } from './fixtures'

const statusReadOwner = 10_001
const commitOwner = 10_002
const mergeOwner = 10_003

test.describe('Rebase E2E', () => {
  test('window opens and title is correct', async ({ harness }) => {
    const page = harness.page
    const title = await page.title()
    expect(title).toBeTruthy()
  })

  test('window becomes visible after ready-to-show', async ({ harness }) => {
    test.skip(harness.deploymentName !== 'electron', 'Electron lifecycle contract')
    await expect
      .poll(() => harness.isWindowVisible(), { timeout: 10_000 })
      .toBe(true)
    expect(harness.launchCount()).toBe(1)
    await expect.poll(() => harness.inspectLifecycle()).toMatchObject({
      sidecarProcessCount: 1,
      sidecarRespawnCount: 0
    })
  })

  test('Linux Electron runs use a private virtual display', async ({ harness }) => {
    test.skip(process.platform !== 'linux', 'Linux display isolation contract')
    test.skip(process.env.REBASE_E2E_USE_DESKTOP === '1', 'Interactive desktop opt-in')
    test.skip(harness.deploymentName !== 'electron', 'Electron display isolation contract')
    expect(process.env.REBASE_E2E_VIRTUAL_DISPLAY).toBe('1')
    expect(process.env.DISPLAY).not.toBe(process.env.REBASE_E2E_HOST_DISPLAY)
    expect(await harness.isWindowVisible()).toBe(true)
  })

  test('shows the onboarding screen on first launch', async ({ harness }) => {
    test.skip(harness.deploymentName !== 'electron', 'Electron persistence defaults')
    const page = harness.page
    await page.waitForLoadState('domcontentloaded')

    const state = await page.evaluate(async () => {
      const api = (
        window as unknown as {
          electronAPI: {
            getActiveWorkspace: () => Promise<string | null>
            getOnboardingComplete: () => Promise<boolean>
            getPersistedTabs: () => Promise<{ tabs: Array<string | null>; activeIndex: number }>
            getRecentRepos: () => Promise<string[]>
            getRefTreeToggles: () => Promise<string[]>
            getSidebarPrefs: () => Promise<{ open: boolean; width: number }>
            getWorkspaces: () => Promise<string[]>
          }
        }
      ).electronAPI
      const [
        activeWorkspace,
        onboardingComplete,
        persistedTabs,
        recentRepos,
        refTreeToggles,
        sidebarPrefs,
        workspaces
      ] = await Promise.all([
        api.getActiveWorkspace(),
        api.getOnboardingComplete(),
        api.getPersistedTabs(),
        api.getRecentRepos(),
        api.getRefTreeToggles(),
        api.getSidebarPrefs(),
        api.getWorkspaces()
      ])
      return {
        activeWorkspace,
        onboardingComplete,
        persistedTabs,
        recentRepos,
        refTreeToggles,
        sidebarPrefs,
        workspaces,
        localStorageKeys: Object.keys(localStorage)
      }
    })

    expect(state).toEqual({
      activeWorkspace: null,
      onboardingComplete: false,
      persistedTabs: { tabs: [null], activeIndex: 0 },
      recentRepos: [],
      refTreeToggles: [],
      sidebarPrefs: { open: true, width: 244 },
      workspaces: [],
      localStorageKeys: []
    })
    await expect(page.getByRole('heading', { name: 'Welcome to Rebase' })).toBeVisible()
  })

  test('shows the select working folder button', async ({ harness }) => {
    const page = harness.page
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('button', { name: 'Select Working Folder' })).toBeVisible()
  })

  test('renderer reaches the sidecar through the preload proxy for status and local branches', async ({
    harness
  }) => {
    test.skip(harness.deploymentName !== 'electron', 'Electron preload contract')
    const repo = createFixtureRepo()
    harness.track(repo)
    const page = harness.page
    try {
      const result = await page.evaluate(async ({ owner, repoPath }) => {
        const api = (
          window as unknown as {
            electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>
          }
        ).electronAPI
        const open = (await api.openRepo(repoPath, owner)) as { _tag: string }
        const status = (await api.sidecarRequest('getStatus', { repoPath })) as { _tag: string }
        const branches = (await api.sidecarRequest('getLocalBranches', { repoPath })) as {
          _tag: string
          branches?: { current: string }
        }
        return {
          open: open._tag,
          exposesSidecarConfig: 'getSidecarConfig' in api,
          statusTag: status._tag,
          branchesTag: branches._tag,
          currentBranch: branches.branches?.current
        }
      }, { owner: statusReadOwner, repoPath: repo })

      expect(result.open).toBe('Ok')
      expect(result.exposesSidecarConfig).toBe(false)
      expect(result.statusTag).toBe('Ok')
      expect(result.branchesTag).toBe('Ok')
      expect(result.currentBranch).toBe('main')
    } finally {
      await page
        .evaluate(async ({ owner, repoPath }) => {
          const api = (
            window as unknown as {
              electronAPI?: { closeRepo?: (path: string, owner: number) => Promise<unknown> }
            }
          ).electronAPI
          await api?.closeRepo?.(repoPath, owner)
        }, { owner: statusReadOwner, repoPath: repo })
        .catch(() => {})
    }
  })

  test('commits through the typed RPC write seam end to end', async ({ harness }) => {
    test.skip(harness.deploymentName !== 'electron', 'Electron preload contract')
    const repo = createFixtureRepo()
    harness.track(repo)
    const page = harness.page
    fs.writeFileSync(path.join(repo, 'second.txt'), 'second\n')
    try {
      const result = await page.evaluate(async ({ owner, repoPath }) => {
        const api = (
          window as unknown as {
            electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>
          }
        ).electronAPI
        const open = (await api.openRepo(repoPath, owner)) as { _tag: string }
        await api.sidecarRequest('stageFile', { repoPath, file: 'second.txt' })
        const committed = (await api.sidecarRequest('commit', {
          repoPath,
          message: 'second from e2e'
        })) as { _tag: string; result?: { commit?: string } }

        const unopened = (await api.sidecarRequest('commit', {
          repoPath: '/no/such/path/from/e2e',
          message: 'never lands'
        })) as { _tag: string }

        return {
          open: open._tag,
          committedTag: committed._tag,
          committedHash: committed.result?.commit ?? '',
          unopenedTag: unopened._tag
        }
      }, { owner: commitOwner, repoPath: repo })

      expect(result.open).toBe('Ok')
      expect(result.committedTag).toBe('Ok')
      expect(result.committedHash).toBeTruthy()
      expect(result.unopenedTag).toBe('GitError')
    } finally {
      await page
        .evaluate(async ({ owner, repoPath }) => {
          const api = (
            window as unknown as {
              electronAPI?: { closeRepo?: (path: string, owner: number) => Promise<unknown> }
            }
          ).electronAPI
          await api?.closeRepo?.(repoPath, owner)
        }, { owner: commitOwner, repoPath: repo })
        .catch(() => {})
    }
  })

  test('a merge conflict flows end to end as a typed Conflict through the RPC seam', async ({
    harness
  }) => {
    test.skip(harness.deploymentName !== 'electron', 'Electron preload contract')
    const repo = createFixtureRepo()
    harness.track(repo)
    const page = harness.page
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
    git(['checkout', '-b', 'feature'])
    fs.writeFileSync(path.join(repo, 'conflict.txt'), 'feature-side\n')
    git(['add', '.'])
    git(['commit', '-m', 'feature side'])
    git(['checkout', 'main'])
    fs.writeFileSync(path.join(repo, 'conflict.txt'), 'main-side\n')
    git(['add', '.'])
    git(['commit', '-m', 'main side'])
    try {
      const result = await page.evaluate(async ({ owner, repoPath }) => {
        const api = (
          window as unknown as {
            electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>
          }
        ).electronAPI
        const open = (await api.openRepo(repoPath, owner)) as { _tag: string }
        const conflicted = (await api.sidecarRequest('mergeBranch', {
          repoPath,
          refKind: 'local',
          fullPath: 'feature'
        })) as { _tag: string; message?: string }

        const cleanRepo = (await api.sidecarRequest('mergeBranch', {
          repoPath: '/no/such/path/from/e2e',
          refKind: 'local',
          fullPath: 'feature'
        })) as { _tag: string }

        return {
          open: open._tag,
          conflictedTag: conflicted._tag,
          conflictedMessage: conflicted.message ?? '',
          missingTag: cleanRepo._tag
        }
      }, { owner: mergeOwner, repoPath: repo })

      expect(result.open).toBe('Ok')
      expect(result.conflictedTag).toBe('Conflict')
      expect(result.conflictedMessage).toBeTruthy()
      expect(result.missingTag).toBe('GitError')
    } finally {
      try {
        git(['merge', '--abort'])
      } catch {}
      await page
        .evaluate(async ({ owner, repoPath }) => {
          const api = (
            window as unknown as {
              electronAPI?: { closeRepo?: (path: string, owner: number) => Promise<unknown> }
            }
          ).electronAPI
          await api?.closeRepo?.(repoPath, owner)
        }, { owner: mergeOwner, repoPath: repo })
        .catch(() => {})
    }
  })

  test('restored repo renders branches and history in the UI', async ({ harness }) => {
    const repo = createFixtureRepo()
    const page = await harness.openRepo(repo)

    await expect(page.getByRole('tab', { name: path.basename(repo) })).toBeVisible()
    await expect(page.getByRole('button', { name: 'main current' })).toBeVisible({
      timeout: 10_000
    })
    await expect(page.getByText('initial').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/0 commits/)).not.toBeVisible()
  })
})
