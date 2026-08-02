import type { CommitDetail } from '@shared/schemas/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommitDiffSelection } from '@/features/diff/CommitDiffView'
import { CommitDetailPaneView } from '../CommitDetailPane'
import { makeHistoryEntry } from './fixtures'

const detail: CommitDetail = {
  sha: 'aaaaaaa1',
  author: { name: 'Ada Author', email: 'ada@example.com' },
  authorDate: '2026-07-21T09:42:00.000Z',
  subject: 'Extract the view',
  body: 'Keep repository queries outside the view.',
  files: []
}

const singleViewProps = {
  mode: 'single' as const,
  sha: detail.sha,
  entry: makeHistoryEntry({ hash: detail.sha, message: detail.subject }),
  remotes: {},
  remoteNames: new Set<string>(),
  detail,
  fetching: false,
  error: undefined,
  renderDiff: () => null
}

describe('CommitDetailPaneView', () => {
  it('renders its empty selection without repository providers', () => {
    render(<CommitDetailPaneView mode="empty" />)

    expect(screen.getByText('No commit selected')).toBeInTheDocument()
  })

  it('renders commit metadata and actions from props', async () => {
    const onCommitAction = vi.fn()
    render(<CommitDetailPaneView {...singleViewProps} onCommitAction={onCommitAction} />)

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Extract the view')
    expect(screen.getByText('No file changes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    expect(onCommitAction).toHaveBeenCalledWith('revert', 'aaaaaaa1', 'Extract the view')
  })

  it('passes the selected file to an injected diff view', async () => {
    const renderDiff = vi.fn((selection: CommitDiffSelection | null) => (
      <div data-testid="selected-diff">{selection?.file ?? 'none'}</div>
    ))
    render(
      <CommitDetailPaneView
        {...singleViewProps}
        detail={{
          ...detail,
          files: [
            {
              path: 'src/history.ts',
              status: 'M',
              additions: 4,
              deletions: 1,
              binary: false
            }
          ]
        }}
        renderDiff={renderDiff}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('selected-diff')).toHaveTextContent('src/history.ts')
    })
    expect(renderDiff).toHaveBeenLastCalledWith({
      commit: 'aaaaaaa1',
      file: 'src/history.ts',
      renameSource: undefined,
      binary: false
    })
  })

  it('summarizes multiple commits from loaded details', () => {
    const secondSha = 'bbbbbbb2'
    render(
      <CommitDetailPaneView
        mode="multi"
        shas={[detail.sha, secondSha]}
        commitsByHash={
          new Map([
            [detail.sha, singleViewProps.entry],
            [secondSha, makeHistoryEntry({ hash: secondSha, message: 'Second commit' })]
          ])
        }
        details={[
          {
            ...detail,
            files: [
              {
                path: 'src/history.ts',
                status: 'M',
                additions: 4,
                deletions: 1,
                binary: false
              }
            ]
          }
        ]}
        pending={false}
        truncated={false}
      />
    )

    expect(screen.getByText('2 commits selected')).toBeInTheDocument()
    expect(screen.getByText('1 file change')).toBeInTheDocument()
    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(screen.getByText('−1')).toBeInTheDocument()
    expect(screen.getByText('Second commit')).toBeInTheDocument()
  })
})
