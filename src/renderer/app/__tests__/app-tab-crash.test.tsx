import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openedRepoResponse } from '../../../test/builders'
import { renderApp } from '../../../test/render-app'
import { repoQueryKeys } from '../../features/repository-identity'
import { identityQueryKey } from '../../stores/identity'
import { createQueryClient } from '../QueryProvider'
import { mockBaseAPI } from './app-test-harness'

const CRASHED_REPO = '/home/user/projects/my-app'
const HEALTHY_REPO = '/home/user/projects/other-app'

vi.mock('../TabView', () => ({
  TabView: () => {
    throw new Error('cannot read length of null')
  }
}))

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('a tab that crashes while rendering', () => {
  it('keeps the window chrome and the tab rail alive', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/projects' })

    const { container } = renderApp()

    const crashScreen = await screen.findByTestId('crash-screen')
    expect(crashScreen).toHaveAttribute('data-scope', 'tab')
    expect(screen.getByRole('navigation', { name: 'Open repositories' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open new tab' })).toBeInTheDocument()
    expect(container.querySelector('.drag-region')).not.toBeNull()
  })

  it('reports the crash to the main process', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/projects' })

    renderApp()

    await waitFor(() => {
      expect(window.electronAPI.reportRendererError).toHaveBeenCalled()
    })
    const report = vi.mocked(window.electronAPI.reportRendererError).mock.calls[0]?.[0]
    expect(report?.message).toBe('cannot read length of null')
  })

  it('drops the failed tab caches on retry and leaves the other tabs loaded', async () => {
    mockBaseAPI({ workingDirectory: '/home/user/projects' })
    vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
      tabs: [CRASHED_REPO],
      activeIndex: 0
    })
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openedRepoResponse(CRASHED_REPO))

    const client = createQueryClient({ gcTime: Number.POSITIVE_INFINITY })
    client.setQueryData(repoQueryKeys(CRASHED_REPO).status, { poisoned: true })
    client.setQueryData(identityQueryKey(CRASHED_REPO), { poisoned: true })
    client.setQueryData(repoQueryKeys(HEALTHY_REPO).status, { kept: true })
    client.setQueryData(identityQueryKey(HEALTHY_REPO), { kept: true })

    renderApp({ client })
    await screen.findByTestId('crash-screen')
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(client.getQueryData(repoQueryKeys(CRASHED_REPO).status)).toBeUndefined()
    expect(client.getQueryData(identityQueryKey(CRASHED_REPO))).toBeUndefined()
    expect(client.getQueryData(repoQueryKeys(HEALTHY_REPO).status)).toEqual({ kept: true })
    expect(client.getQueryData(identityQueryKey(HEALTHY_REPO))).toEqual({ kept: true })
  })
})
