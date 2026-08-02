import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CloneRepoDialogView } from '../CloneRepoDialogView'

function renderView(overrides: Partial<Parameters<typeof CloneRepoDialogView>[0]> = {}) {
  const onUrlChange = overrides.onUrlChange ?? vi.fn()
  const onChooseParentDir = overrides.onChooseParentDir ?? vi.fn()
  const onSubmit = overrides.onSubmit ?? vi.fn()
  const onCancel = overrides.onCancel ?? vi.fn()
  const onDismiss = overrides.onDismiss ?? vi.fn()
  const view = render(
    <CloneRepoDialogView
      url={overrides.url ?? ''}
      parentDir={overrides.parentDir === undefined ? '/work' : overrides.parentDir}
      folderName={overrides.folderName === undefined ? null : overrides.folderName}
      urlLooksValid={overrides.urlLooksValid ?? true}
      canSubmit={overrides.canSubmit ?? false}
      cloning={overrides.cloning ?? false}
      error={overrides.error ?? null}
      progress={overrides.progress ?? null}
      onUrlChange={onUrlChange}
      onChooseParentDir={onChooseParentDir}
      onSubmit={onSubmit}
      onCancel={onCancel}
      onDismiss={onDismiss}
    />
  )
  return { view, onUrlChange, onChooseParentDir, onSubmit, onCancel, onDismiss }
}

describe('CloneRepoDialogView', () => {
  it('renders the resolved destination and reports form intent', () => {
    const { onUrlChange, onChooseParentDir, onSubmit } = renderView({
      url: 'https://github.com/acme/app.git',
      folderName: 'app',
      canSubmit: true
    })

    expect(screen.getByText('/work')).toBeInTheDocument()
    expect(screen.getByText('/app')).toBeInTheDocument()
    fireEvent.input(screen.getByRole('textbox', { name: 'Repository URL' }), {
      target: { value: 'git@github.com:acme/next.git' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))

    expect(onUrlChange).toHaveBeenCalledWith('git@github.com:acme/next.git')
    expect(onChooseParentDir).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('renders a Windows destination with its native separator', () => {
    renderView({ parentDir: 'C:\\code\\', folderName: 'app' })

    expect(screen.getByText('C:\\code')).toBeInTheDocument()
    expect(screen.getByText('\\app')).toBeInTheDocument()
  })

  it('explains when a destination has not been selected', () => {
    renderView({ parentDir: null })

    expect(screen.getByText('Choose a folder to clone into')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled()
  })

  it('prioritizes URL validation, then reports clone errors and progress', () => {
    const { view } = renderView({
      urlLooksValid: false,
      error: 'Clone failed',
      progress: { phase: 'Receiving objects', percent: 42 }
    })
    expect(screen.getByText(/Enter an HTTPS or SSH repository URL/)).toBeInTheDocument()
    expect(screen.queryByTestId('clone-error')).not.toBeInTheDocument()

    view.rerender(
      <CloneRepoDialogView
        url="https://github.com/acme/app.git"
        parentDir="/work"
        folderName="app"
        urlLooksValid={true}
        canSubmit={false}
        cloning={false}
        error="Clone failed"
        progress={{ phase: 'Receiving objects', percent: 42 }}
        onUrlChange={vi.fn()}
        onChooseParentDir={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByTestId('clone-error')).toHaveTextContent('Clone failed')
  })

  it('shows progress and locks fields during cloning', () => {
    renderView({ cloning: true, progress: { phase: 'Receiving objects', percent: 42 } })

    expect(screen.getByTestId('clone-progress')).toHaveTextContent('Receiving objects')
    expect(screen.getByTestId('clone-progress')).toHaveTextContent('42%')
    expect(screen.getByRole('textbox', { name: 'Repository URL' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Change…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cloning…' })).toBeDisabled()
  })

  it('reports cancellation and overlay dismissal separately', () => {
    const { onCancel, onDismiss } = renderView()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
