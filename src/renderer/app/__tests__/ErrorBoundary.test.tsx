import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../ErrorBoundary'
import { queryClient } from '../QueryProvider'

function Boom(props: { failing: boolean }) {
  if (props.failing) {
    throw new Error('cannot read length of null')
  }
  return <div data-testid="app-body">timeline</div>
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  queryClient.clear()
})

describe('crash boundary', () => {
  it('renders the app untouched while nothing throws', () => {
    render(
      <ErrorBoundary scope="app">
        <Boom failing={false} />
      </ErrorBoundary>
    )

    expect(screen.getByTestId('app-body')).toBeInTheDocument()
    expect(screen.queryByTestId('crash-screen')).not.toBeInTheDocument()
  })

  it('shows a recovery screen instead of a blank window when a render throws', () => {
    render(
      <ErrorBoundary scope="app">
        <Boom failing={true} />
      </ErrorBoundary>
    )

    expect(screen.getByTestId('crash-screen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /restart the window/i })).toBeInTheDocument()
    expect(screen.queryByTestId('app-body')).not.toBeInTheDocument()
  })

  it('never puts the raw error text in front of the user', () => {
    render(
      <ErrorBoundary scope="app">
        <Boom failing={true} />
      </ErrorBoundary>
    )

    const crashScreen = screen.getByTestId('crash-screen')
    expect(crashScreen).not.toHaveTextContent('cannot read length of null')
    expect(crashScreen).not.toHaveTextContent(/Error:/)
    expect(crashScreen).not.toHaveTextContent(/\bat \w+/)
  })

  it('reports the failure to the main process so it lands in the log file', () => {
    render(
      <ErrorBoundary scope="app">
        <Boom failing={true} />
      </ErrorBoundary>
    )

    expect(window.electronAPI.reportRendererError).toHaveBeenCalledOnce()
    const report = vi.mocked(window.electronAPI.reportRendererError).mock.calls[0]?.[0]
    expect(report?.message).toBe('cannot read length of null')
    expect(report?.stack).toContain('cannot read length of null')
    expect(report?.componentStack).toContain('Boom')
  })

  it('stays on the recovery screen when reporting the failure fails', () => {
    vi.mocked(window.electronAPI.reportRendererError).mockRejectedValue(new Error('ipc gone'))

    render(
      <ErrorBoundary scope="app">
        <Boom failing={true} />
      </ErrorBoundary>
    )

    expect(screen.getByTestId('crash-screen')).toBeInTheDocument()
  })

  it('drops the cached Git data on retry so the same payload cannot crash it again', () => {
    queryClient.setQueryData(['status', '/repo'], { poisoned: true })

    render(
      <ErrorBoundary scope="app">
        <Boom failing={true} />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(queryClient.getQueryData(['status', '/repo'])).toBeUndefined()
  })

  it('drops only the failed tab cache, leaving the other tabs loaded', () => {
    queryClient.setQueryData(['repo', '/broken', 'status'], { poisoned: true })
    queryClient.setQueryData(['repo', '/healthy', 'status'], { kept: true })
    queryClient.setQueryData(['identity', '/healthy'], { kept: true })

    render(
      <ErrorBoundary
        scope="tab"
        onReset={() => queryClient.removeQueries({ queryKey: ['repo', '/broken'] })}
      >
        <Boom failing={true} />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(queryClient.getQueryData(['repo', '/broken', 'status'])).toBeUndefined()
    expect(queryClient.getQueryData(['repo', '/healthy', 'status'])).toEqual({ kept: true })
    expect(queryClient.getQueryData(['identity', '/healthy'])).toEqual({ kept: true })
  })

  it('recovers the app when the user retries and the render succeeds', () => {
    const { rerender } = render(
      <ErrorBoundary scope="app">
        <Boom failing={true} />
      </ErrorBoundary>
    )
    expect(screen.getByTestId('crash-screen')).toBeInTheDocument()

    rerender(
      <ErrorBoundary scope="app">
        <Boom failing={false} />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByTestId('app-body')).toBeInTheDocument()
    expect(screen.queryByTestId('crash-screen')).not.toBeInTheDocument()
  })

  it('reloads the window when the user asks for a restart', () => {
    const reload = vi.fn()
    const original = window.location.reload
    Object.defineProperty(window.location, 'reload', { value: reload, configurable: true })

    render(
      <ErrorBoundary scope="app">
        <Boom failing={true} />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: /restart the window/i }))

    expect(reload).toHaveBeenCalledOnce()
    Object.defineProperty(window.location, 'reload', { value: original, configurable: true })
  })

  it('copies the stack and the component stack for a bug report', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(
      <ErrorBoundary scope="app">
        <Boom failing={true} />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: /copy details/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument()
    })
    const copied = writeText.mock.calls[0]?.[0] as string
    expect(copied).toContain('cannot read length of null')
    expect(copied).toContain('component stack:')
    expect(copied).toContain('Boom')
  })
})

describe('crash boundary scope', () => {
  it('keeps the window draggable when the whole app goes down', () => {
    const { container } = render(
      <ErrorBoundary scope="app">
        <Boom failing={true} />
      </ErrorBoundary>
    )

    expect(container.querySelector('.drag-region')).not.toBeNull()
  })

  it('still draws when the bridge itself is what broke', () => {
    const original = window.electronAPI
    window.electronAPI = new Proxy(
      {},
      {
        get() {
          throw new TypeError('electronAPI is gone')
        }
      }
    ) as typeof original

    try {
      render(
        <ErrorBoundary scope="app">
          <Boom failing={true} />
        </ErrorBoundary>
      )

      expect(screen.getByTestId('crash-screen')).toBeInTheDocument()
    } finally {
      window.electronAPI = original
    }
  })

  it('leaves the surrounding chrome alone when a single tab goes down', () => {
    const { container } = render(
      <ErrorBoundary scope="tab">
        <Boom failing={true} />
      </ErrorBoundary>
    )

    expect(container.querySelector('.drag-region')).toBeNull()
    expect(screen.getByTestId('crash-screen')).toHaveAttribute('data-scope', 'tab')
    expect(screen.getByTestId('crash-screen')).toHaveTextContent(/other tabs are unaffected/i)
  })
})
