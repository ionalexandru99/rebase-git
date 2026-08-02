import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MissingIdentityCallout } from '../MissingIdentityCallout'

function renderCallout(overrides: Partial<Parameters<typeof MissingIdentityCallout>[0]> = {}) {
  const onSave = overrides.onSave ?? vi.fn()
  render(
    <MissingIdentityCallout
      effective={overrides.effective ?? {}}
      saving={overrides.saving ?? false}
      error={overrides.error ?? null}
      onSave={onSave}
    />
  )
  return {
    onSave,
    name: screen.getByLabelText('Name'),
    email: screen.getByLabelText('Email'),
    save: screen.getByRole('button', { name: 'Save identity' })
  }
}

describe('MissingIdentityCallout', () => {
  it('explains that git needs an identity before the commit', () => {
    renderCallout()

    expect(screen.getByText('Tell git who you are before committing')).toBeInTheDocument()
  })

  it('keeps saving unavailable until both values are filled in', () => {
    const { name, email, save } = renderCallout()
    expect(save).toBeDisabled()

    fireEvent.input(name, { target: { value: 'Ada Lovelace' } })
    expect(save).toBeDisabled()

    fireEvent.input(email, { target: { value: '  ' } })
    expect(save).toBeDisabled()

    fireEvent.input(email, { target: { value: 'ada@example.com' } })
    expect(save).toBeEnabled()
  })

  it('carries over the value git already knows so only the missing one is typed', () => {
    const { name, email, save } = renderCallout({ effective: { name: 'Ada Lovelace' } })

    expect(name).toHaveValue('Ada Lovelace')
    expect(email).toHaveValue('')
    expect(save).toBeDisabled()
  })

  it('saves for every repository by default', () => {
    const { name, email, save, onSave } = renderCallout()
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
    const { name, email, save, onSave } = renderCallout()

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
    renderCallout({
      effective: { name: 'Ada Lovelace', email: 'ada@example.com' },
      saving: true,
      error: 'could not lock config file'
    })

    expect(screen.getByText('could not lock config file')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save identity' })).toBeDisabled()
  })
})
