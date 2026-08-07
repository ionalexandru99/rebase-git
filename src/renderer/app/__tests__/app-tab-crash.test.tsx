import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../../test/render-app'
import { mockBaseAPI } from './app-test-harness'

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
})
