import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeGitStatus } from '../../../test/builders'
import { StatusDock } from '../StatusDock'

function renderDock(overrides: Partial<Parameters<typeof StatusDock>[0]> = {}) {
  return render(
    <StatusDock
      branch={overrides.branch === undefined ? 'main' : overrides.branch}
      ahead={overrides.ahead ?? 0}
      behind={overrides.behind ?? 0}
      status={overrides.status ?? null}
      lastFetchedAt={overrides.lastFetchedAt}
    />
  )
}

const dock = () => screen.getByTestId('status-dock')

afterEach(() => {
  vi.useRealTimers()
})

describe('StatusDock', () => {
  it('names the checked-out branch', () => {
    renderDock({ branch: 'feature/ui' })

    expect(dock()).toHaveTextContent('feature/ui')
  })

  it('says detached when no branch is checked out', () => {
    renderDock({ branch: null })

    expect(dock()).toHaveTextContent('detached')
  })

  it('shows the drift arrows only when the branch has drifted', () => {
    const level = renderDock({ ahead: 0, behind: 0 })
    expect(dock().textContent).not.toContain('↑')
    expect(dock().textContent).not.toContain('↓')
    level.unmount()

    renderDock({ ahead: 3, behind: 1 })

    expect(dock()).toHaveTextContent('↑3')
    expect(dock()).toHaveTextContent('↓1')
  })

  it('counts the working copy, leaving conflicts out when there are none', () => {
    renderDock({
      status: makeGitStatus({
        files: [
          { path: 'a.ts', index: 'M', working_dir: ' ' },
          { path: 'b.ts', index: ' ', working_dir: 'M' },
          { path: 'c.ts', index: '?', working_dir: '?' }
        ]
      })
    })

    expect(dock()).toHaveTextContent('3 changed')
    expect(dock()).toHaveTextContent('1 staged')
    expect(dock().textContent).not.toContain('conflict')
  })

  it('counts conflicts when the working tree has them', () => {
    renderDock({
      status: makeGitStatus({
        files: [
          { path: 'a.ts', index: 'U', working_dir: 'U' },
          { path: 'b.ts', index: ' ', working_dir: 'M' }
        ],
        conflicted: ['a.ts']
      })
    })

    expect(dock()).toHaveTextContent('1 conflict')
  })

  it('keeps the fetch age ticking without another render', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'))
    renderDock({ lastFetchedAt: Date.now() })
    expect(dock()).toHaveTextContent('Fetched just now')

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(dock()).toHaveTextContent('Fetched 1m ago')
  })

  it('leaves the fetch age out until a fetch has happened', () => {
    renderDock({ lastFetchedAt: null })

    expect(dock().textContent).not.toContain('Fetched')
  })
})
