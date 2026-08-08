import type { ResolvedIdentity } from '@shared/schemas/git'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsView, type SettingsViewProps } from '../SettingsView'

const GLOBAL_IDENTITY = { name: 'Global Name', email: 'global@example.com' }

const identityWith = (local: ResolvedIdentity['local']): ResolvedIdentity => ({
  local,
  global: GLOBAL_IDENTITY,
  effective: { ...GLOBAL_IDENTITY, ...local }
})

function makeProps(overrides: Partial<SettingsViewProps> = {}): SettingsViewProps {
  return {
    repoLabel: 'rebase',
    identity: identityWith({}),
    saving: false,
    error: null,
    onSave: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }
}

function renderView(overrides: Partial<SettingsViewProps> = {}) {
  const props = makeProps(overrides)
  render(<SettingsView {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Git identity' }))
  return props
}

const appSection = () => within(screen.getByRole('group', { name: 'App settings' }))
const repoSection = () => within(screen.getByRole('group', { name: 'Repository settings' }))

describe('SettingsView', () => {
  it('opens on the General section and switches to Git identity from the nav', () => {
    render(<SettingsView {...makeProps()} />)

    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }))
    expect(nav.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('region', { name: 'General' })).toBeInTheDocument()

    fireEvent.click(nav.getByRole('button', { name: 'Git identity' }))

    expect(nav.getByRole('button', { name: 'Git identity' })).toHaveAttribute(
      'aria-current',
      'true'
    )
    expect(screen.getByRole('region', { name: 'Git identity' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'General' })).toBeNull()
  })

  it('shows the inherited app identity as placeholder text when the repo has no override', () => {
    renderView()

    expect(repoSection().getByLabelText('Name')).toHaveValue('')
    expect(repoSection().getByLabelText('Name')).toHaveAttribute('placeholder', 'Global Name')
    expect(repoSection().getByLabelText('Email')).toHaveAttribute(
      'placeholder',
      'global@example.com'
    )
    expect(appSection().getByLabelText('Name')).toHaveValue('Global Name')
  })

  it('shows only the app section when the tab has no repository', () => {
    renderView({ repoLabel: null })

    expect(screen.getByRole('group', { name: 'App settings' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Repository settings' })).toBeNull()
  })

  it('saves the app identity at global scope', () => {
    const { onSave } = renderView()

    fireEvent.change(appSection().getByLabelText('Name'), { target: { value: 'New Name' } })
    fireEvent.click(appSection().getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith('global', {
      name: 'New Name',
      email: 'global@example.com'
    })
  })

  it('writes only the repository fields the user filled in', () => {
    const { onSave } = renderView()

    fireEvent.change(repoSection().getByLabelText('Email'), {
      target: { value: 'work@example.com' }
    })
    fireEvent.click(repoSection().getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith('local', { email: 'work@example.com' })
  })

  it('offers "use app settings" only for the fields the repository overrides', () => {
    renderView({ identity: identityWith({ email: 'local@example.com' }) })

    expect(
      repoSection().getByRole('button', { name: 'Use app settings for email' })
    ).toBeInTheDocument()
    expect(repoSection().queryByRole('button', { name: 'Use app settings for name' })).toBeNull()
  })

  it('clears a repository override back to the inherited app value', () => {
    const { onClear } = renderView({ identity: identityWith({ email: 'local@example.com' }) })

    fireEvent.click(repoSection().getByRole('button', { name: 'Use app settings for email' }))

    expect(onClear).toHaveBeenCalledWith(['email'])
  })

  it('clears an override when its repository field is emptied and saved', () => {
    const { onSave, onClear } = renderView({
      identity: identityWith({ name: 'Local Name', email: 'local@example.com' })
    })

    fireEvent.change(repoSection().getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.click(repoSection().getByRole('button', { name: 'Save' }))

    expect(onClear).toHaveBeenCalledWith(['name'])
    expect(onSave).toHaveBeenCalledWith('local', { email: 'local@example.com' })
  })

  it('refuses to save a blank app identity', () => {
    const { onSave } = renderView()

    fireEvent.change(appSection().getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.click(appSection().getByRole('button', { name: 'Save' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(appSection().getByRole('alert')).toHaveTextContent(/name cannot be empty/i)
  })

  it('points a screen reader at the field it rejected', () => {
    renderView()

    fireEvent.change(appSection().getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.click(appSection().getByRole('button', { name: 'Save' }))

    const nameInput = appSection().getByLabelText('Name')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAccessibleDescription(/name cannot be empty/i)
    expect(appSection().getByLabelText('Email')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('holds both Save buttons inert while a write is in flight', () => {
    renderView({ saving: true })

    expect(appSection().getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(repoSection().getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('surfaces the failure the sidecar reported', () => {
    renderView({ error: 'user.email has multiple values' })

    expect(screen.getByTestId('settings-error')).toHaveTextContent('user.email has multiple values')
  })

  it('closes the settings view', () => {
    const { onClose } = renderView()

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
