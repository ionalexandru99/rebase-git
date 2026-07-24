import type { LogChunk } from '@shared/schemas/git'
import { describe, expect, it, vi } from 'vitest'
import { createPlaywrightMcpElectronApi, PLAYWRIGHT_MCP_REPO_PATH } from '../electron-api'

describe('Playwright MCP Electron API', () => {
  it('starts with a realistic repository available', async () => {
    const api = createPlaywrightMcpElectronApi()

    await expect(api.getOnboardingComplete()).resolves.toBe(true)
    await expect(api.getPersistedTabs()).resolves.toEqual({
      tabs: [null],
      activeIndex: 0
    })
    await expect(api.openRepo(PLAYWRIGHT_MCP_REPO_PATH, 1)).resolves.toMatchObject({
      _tag: 'Ok',
      result: {
        path: PLAYWRIGHT_MCP_REPO_PATH,
        defaultBranch: 'main'
      }
    })
    await expect(
      api.sidecarRequest('getStatus', { repoPath: PLAYWRIGHT_MCP_REPO_PATH })
    ).resolves.toMatchObject({
      _tag: 'Ok',
      status: {
        current: 'main',
        modified: ['src/renderer/App.tsx'],
        staged: ['src/main/index.ts'],
        not_added: ['notes/manual-test.md']
      }
    })
  })

  it('supports staging and committing through the renderer RPC seam', async () => {
    const api = createPlaywrightMcpElectronApi()
    const onRepoChanged = vi.fn()
    api.onRepoChanged(onRepoChanged)

    await api.sidecarRequest('stageFile', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH,
      file: 'src/renderer/App.tsx'
    })
    await expect(
      api.sidecarRequest('getStatus', { repoPath: PLAYWRIGHT_MCP_REPO_PATH })
    ).resolves.toMatchObject({
      _tag: 'Ok',
      status: {
        modified: [],
        staged: ['src/main/index.ts', 'src/renderer/App.tsx']
      }
    })

    await expect(
      api.sidecarRequest('commit', {
        repoPath: PLAYWRIGHT_MCP_REPO_PATH,
        message: 'Test the browser harness'
      })
    ).resolves.toMatchObject({
      _tag: 'Ok',
      result: { branch: 'main', summary: { changes: 2 } }
    })
    await expect(
      api.sidecarRequest('getStatus', { repoPath: PLAYWRIGHT_MCP_REPO_PATH })
    ).resolves.toMatchObject({
      _tag: 'Ok',
      status: { staged: [] }
    })
    expect(onRepoChanged).toHaveBeenCalled()
  })

  it('streams deterministic commit history', async () => {
    const api = createPlaywrightMcpElectronApi()
    const onLogChunk = vi.fn()
    api.onLogChunk(onLogChunk)

    await api.startLogStream(PLAYWRIGHT_MCP_REPO_PATH, { streamId: 7 })
    await Promise.resolve()

    expect(onLogChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: PLAYWRIGHT_MCP_REPO_PATH,
        done: true,
        hasMore: false,
        streamId: 7,
        commits: expect.arrayContaining([
          expect.objectContaining({ message: 'Make Rebase testable from Chromium' })
        ])
      })
    )
  })

  it('paginates a large manual history without gaps or duplicates', async () => {
    const api = createPlaywrightMcpElectronApi({ historyCount: 2_005 })
    const onLogChunk = vi.fn()
    api.onLogChunk(onLogChunk)

    await api.startLogStream(PLAYWRIGHT_MCP_REPO_PATH, {
      streamId: 1,
      maxCount: 2_000
    })
    await Promise.resolve()
    await api.startLogStream(PLAYWRIGHT_MCP_REPO_PATH, {
      streamId: 2,
      skip: 2_000,
      maxCount: 2_000
    })
    await Promise.resolve()

    const first = onLogChunk.mock.calls[0]?.[0] as LogChunk
    const second = onLogChunk.mock.calls[1]?.[0] as LogChunk
    const commits = [...first.commits, ...second.commits]
    expect(first.hasMore).toBe(true)
    expect(second.hasMore).toBe(false)
    expect(commits).toHaveLength(2_005)
    expect(new Set(commits.map((commit) => commit.hash)).size).toBe(2_005)
  })

  it('can expose a deterministic conflict for visual testing', async () => {
    const api = createPlaywrightMcpElectronApi({ conflicted: true })

    await expect(
      api.sidecarRequest('getStatus', { repoPath: PLAYWRIGHT_MCP_REPO_PATH })
    ).resolves.toMatchObject({
      status: {
        conflicted: ['src/conflict.ts'],
        files: expect.arrayContaining([
          expect.objectContaining({ path: 'src/conflict.ts', index: 'U', working_dir: 'U' })
        ])
      }
    })
  })

  it('keeps streamed history decorations aligned with checkout', async () => {
    const api = createPlaywrightMcpElectronApi()
    const onLogChunk = vi.fn()
    api.onLogChunk(onLogChunk)

    await api.sidecarRequest('checkout', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH,
      refKind: 'local',
      fullPath: 'feature/streaming'
    })
    await expect(
      api.sidecarRequest('commit', {
        repoPath: PLAYWRIGHT_MCP_REPO_PATH,
        message: 'Commit on feature'
      })
    ).resolves.toMatchObject({ result: { branch: 'feature/streaming' } })
    await api.startLogStream(PLAYWRIGHT_MCP_REPO_PATH)
    await Promise.resolve()

    const chunk = onLogChunk.mock.calls[0]?.[0] as LogChunk | undefined
    expect(chunk?.commits.some((commit) => commit.refs.includes('HEAD -> feature/streaming'))).toBe(
      true
    )
    expect(chunk?.commits.some((commit) => commit.refs.includes('HEAD -> main'))).toBe(false)
  })

  it('creates branches and tags at their requested commits', async () => {
    const api = createPlaywrightMcpElectronApi()
    const onLogChunk = vi.fn()
    api.onLogChunk(onLogChunk)
    const targetHash = '26d2349a8d4d978a23c8baba564e0119eb21004c'

    await api.sidecarRequest('createBranch', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH,
      name: 'release/manual',
      startPoint: targetHash,
      startPointKind: 'local'
    })
    await api.sidecarRequest('createTag', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH,
      name: 'manual-v2',
      ref: targetHash,
      refKind: 'local'
    })
    await api.startLogStream(PLAYWRIGHT_MCP_REPO_PATH)
    await Promise.resolve()

    const chunk = onLogChunk.mock.calls[0]?.[0] as LogChunk | undefined
    const target = chunk?.commits.find((commit) => commit.hash === targetHash)
    expect(target?.refs).toContain('release/manual')
    expect(target?.refs).toContain('tag: manual-v2')
  })

  it('stashes and restores the selected working-tree files', async () => {
    const api = createPlaywrightMcpElectronApi()

    await api.sidecarRequest('stashPush', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH,
      message: 'manual stash',
      files: ['notes/manual-test.md']
    })
    await expect(
      api.sidecarRequest('getStatus', { repoPath: PLAYWRIGHT_MCP_REPO_PATH })
    ).resolves.toMatchObject({ status: { not_added: [] } })
    const stashList = (await api.sidecarRequest('stashList', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH
    })) as { stashes: Array<{ index: number; oid: string }> }
    expect(stashList.stashes).toHaveLength(2)
    expect(stashList.stashes.map((stash) => stash.index)).toEqual([0, 1])
    expect(new Set(stashList.stashes.map((stash) => stash.oid)).size).toBe(2)
    const newStashOid = stashList.stashes[0].oid

    await api.sidecarRequest('stashPop', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH,
      index: 0,
      expectedOid: newStashOid
    })
    await expect(
      api.sidecarRequest('getStatus', { repoPath: PLAYWRIGHT_MCP_REPO_PATH })
    ).resolves.toMatchObject({
      status: { not_added: expect.arrayContaining(['notes/manual-test.md']) }
    })
    await expect(
      api.sidecarRequest('stashList', { repoPath: PLAYWRIGHT_MCP_REPO_PATH })
    ).resolves.toMatchObject({
      stashes: [{ index: 0, oid: '1c7a31006f3b79198ec715f83f7b81897fc4fbbc' }]
    })
  })

  it('stashes all statuses exactly and gives repeated stashes unique identities', async () => {
    const api = createPlaywrightMcpElectronApi()
    const initial = (await api.sidecarRequest('getStatus', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH
    })) as { status: Record<string, unknown> }

    await api.sidecarRequest('stashPush', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH,
      message: 'all changes'
    })
    await expect(
      api.sidecarRequest('getStatus', { repoPath: PLAYWRIGHT_MCP_REPO_PATH })
    ).resolves.toMatchObject({
      status: { modified: [], staged: [], not_added: [], files: [] }
    })
    const firstList = (await api.sidecarRequest('stashList', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH
    })) as { stashes: Array<{ index: number; oid: string }> }
    const firstOid = firstList.stashes[0].oid
    await api.sidecarRequest('stashPop', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH,
      index: 0,
      expectedOid: firstOid
    })
    await expect(
      api.sidecarRequest('getStatus', { repoPath: PLAYWRIGHT_MCP_REPO_PATH })
    ).resolves.toEqual({ _tag: 'Ok', status: initial.status })

    await api.sidecarRequest('stashPush', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH,
      message: 'all changes again'
    })
    const secondList = (await api.sidecarRequest('stashList', {
      repoPath: PLAYWRIGHT_MCP_REPO_PATH
    })) as { stashes: Array<{ index: number; oid: string }> }
    expect(secondList.stashes.map((stash) => stash.index)).toEqual([0, 1])
    expect(secondList.stashes[0].oid).not.toBe(firstOid)
    expect(new Set(secondList.stashes.map((stash) => stash.oid)).size).toBe(2)
  })

  it('can start at onboarding for manual coverage of first-run flows', async () => {
    const api = createPlaywrightMcpElectronApi({ onboardingComplete: false })

    await expect(api.getOnboardingComplete()).resolves.toBe(false)
    await expect(api.getPersistedTabs()).resolves.toEqual({ tabs: [null], activeIndex: 0 })
    await expect(api.selectFolder()).resolves.toBe('/Users/playwright/Projects')
    await expect(api.scanForRepos('/Users/playwright/Projects')).resolves.toEqual({
      _tag: 'Ok',
      repos: [PLAYWRIGHT_MCP_REPO_PATH]
    })
  })
})
