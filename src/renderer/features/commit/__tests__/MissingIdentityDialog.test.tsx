import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MissingIdentityDialog } from '../MissingIdentityDialog'

function renderDialog(overrides: Partial<Parameters<typeof MissingIdentityDialog>[0]> = {}) {
  const onSave = overrides.onSave ?? vi.fn()
  const onDismiss = overrides.onDismiss ?? vi.fn()
  render(
    <MissingIdentityDialog
      effective={overrides.effective ?? {}}
      saving={overrides.saving ?? false}
      error={overrides.error ?? null}
      onSave={onSave}
      onDismiss={onDismiss}
    />
  )
  return {
    onSave,
    onDismiss,
    name: screen.getByLabelText('Name'),
    email: screen.getByLabelText('Email'),
    save: screen.getByRole('button', { name: 'Save identity' })
  }
}

describe('MissingIdentityDialog', () => {
  it('opens as a modal that explains why git cannot commit', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('Tell git who you are before committing')).toBeInTheDocument()
  })

  it('closes without saving on Cancel and on Escape', () => {
    const { onSave, onDismiss } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDismiss).toHaveBeenCalledOnce()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(2)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps saving unavailable until both values are filled in', () => {
    const { name, email, save } = renderDialog()
    expect(save).toBeDisabled()

    fireEvent.input(name, { target: { value: 'Ada Lovelace' } })
    expect(save).toBeDisabled()

    fireEvent.input(email, { target: { value: '  ' } })
    expect(save).toBeDisabled()

    fireEvent.input(email, { target: { value: 'ada@example.com' } })
    expect(save).toBeEnabled()
  })

  it('carries over the value git already knows so only the missing one is typed', () => {
    const { name, email, save } = renderDialog({ effective: { name: 'Ada Lovelace' } })

    expect(name).toHaveValue('Ada Lovelace')
    expect(email).toHaveValue('')
    expect(save).toBeDisabled()
  })

  it('saves for every repository by default', () => {
    const { name, email, save, onSave } = renderDialog()
    expect(screen.getByRole('radio', { name: 'All repositories' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Only this repository' })).not.toBeChecked()

    fireEvent.input(name, { target: { value: 'Ada Lovelace' } })
    fireEvent.input(email, { target: { value: 'ada@example.com' } })
    fireEvent.click(save)

    expect(onSave).toHaveBeenCalledWith('global', {
      name: 'Ada Lovelace',
      email: 'ada@example.com'
    })
  })

  it('saves for this repository only when that scope is chosen', () => {
    const { name, email, save, onSave } = renderDialog()

    fireEvent.input(name, { target: { value: 'Ada Lovelace' } })
    fireEvent.input(email, { target: { value: 'ada@work.example.com' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Only this repository' }))
    fireEvent.click(save)

    expect(onSave).toHaveBeenCalledWith('local', {
      name: 'Ada Lovelace',
      email: 'ada@work.example.com'
    })
  })

  it('reports a failed save and holds the action while one is in flight', () => {
    renderDialog({
      effective: { name: 'Ada Lovelace', email: 'ada@example.com' },
      saving: true,
      error: 'could not lock config file'
    })

    expect(screen.getByText('could not lock config file')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save identity' })).toBeDisabled()
  })
})
