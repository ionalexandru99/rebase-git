import type { ResolvedIdentity } from '@shared/schemas/git'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsView, type SettingsViewProps } from '../SettingsView'

const GLOBAL_IDENTITY = { name: 'Global Name', email: 'global@example.com' }

const identity: ResolvedIdentity = {
  local: {},
  global: GLOBAL_IDENTITY,
  effective: GLOBAL_IDENTITY
}

function renderView(overrides: Partial<SettingsViewProps> = {}) {
  const props: SettingsViewProps = {
    repoLabel: 'rebase',
    identity,
    saving: false,
    error: null,
    onSave: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }
  render(<SettingsView {...props} />)
  return props
}

const searchInput = () => screen.getByRole('combobox', { name: 'Search settings' })

describe('SettingsSearch', () => {
  it('replaces the nav list with results while typing and restores it when cleared', () => {
    renderView()

    fireEvent.change(searchInput(), { target: { value: 'nightly' } })

    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull()
    const results = within(screen.getByRole('listbox', { name: 'Search results' }))
    expect(results.getByRole('option', { name: /Update channel/ })).toBeInTheDocument()

    fireEvent.change(searchInput(), { target: { value: '' } })

    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'Search results' })).toBeNull()
  })

  it('says when nothing matches', () => {
    renderView()

    fireEvent.change(searchInput(), { target: { value: 'kubernetes' } })

    expect(screen.getByRole('status')).toHaveTextContent('No settings match your search.')
    expect(screen.queryByRole('listbox', { name: 'Search results' })).toBeNull()
  })

  it('moves through results with the arrow keys', () => {
    renderView()

    fireEvent.change(searchInput(), { target: { value: 'email' } })

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(searchInput()).toHaveAttribute('aria-activedescendant', options[0].id)

    fireEvent.keyDown(searchInput(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    expect(searchInput()).toHaveAttribute('aria-activedescendant', options[1].id)

    fireEvent.keyDown(searchInput(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(searchInput(), { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('jumps to the owning section on Enter and marks the target row', () => {
    renderView()

    fireEvent.change(searchInput(), { target: { value: 'nightly' } })
    fireEvent.keyDown(searchInput(), { key: 'Enter' })

    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }))
    expect(nav.getByRole('button', { name: 'Updates' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('region', { name: 'Updates' })).toBeInTheDocument()
    expect(searchInput()).toHaveValue('')

    const channelRow = screen.getByRole('group', { name: 'Update channel' })
    expect(channelRow).toHaveAttribute('data-settings-row-highlight', 'true')
  })

  it('jumps to the arrow-selected result, not the first one', () => {
    renderView()

    fireEvent.change(searchInput(), { target: { value: 'email' } })
    fireEvent.keyDown(searchInput(), { key: 'ArrowDown' })
    fireEvent.keyDown(searchInput(), { key: 'Enter' })

    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }))
    expect(nav.getByRole('button', { name: 'Git identity' })).toHaveAttribute(
      'aria-current',
      'true'
    )
    expect(screen.getByRole('group', { name: 'Repository settings' })).toHaveAttribute(
      'data-settings-row-highlight',
      'true'
    )
    expect(screen.getByRole('group', { name: 'App settings' })).not.toHaveAttribute(
      'data-settings-row-highlight'
    )
  })

  it('jumps when a result is clicked', () => {
    renderView()

    fireEvent.change(searchInput(), { target: { value: 'changelog' } })
    fireEvent.click(screen.getByRole('option', { name: /Release notes/ }))

    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }))
    expect(nav.getByRole('button', { name: 'About' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('group', { name: 'Release notes' })).toHaveAttribute(
      'data-settings-row-highlight',
      'true'
    )
  })

  it('focuses the search field on /', () => {
    renderView()

    fireEvent.keyDown(window, { key: '/' })

    expect(searchInput()).toHaveFocus()
  })

  it('leaves / alone while focus is in a text field', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Git identity' }))

    const appSettings = within(screen.getByRole('group', { name: 'App settings' }))
    const nameInput = appSettings.getByLabelText('Name')
    nameInput.focus()

    fireEvent.keyDown(nameInput, { key: '/' })

    expect(nameInput).toHaveFocus()
    expect(searchInput()).not.toHaveFocus()
  })

  it('leaves / alone while a dialog is open', () => {
    renderView()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    try {
      fireEvent.keyDown(window, { key: '/' })
      expect(searchInput()).not.toHaveFocus()
    } finally {
      dialog.remove()
    }
  })

  it('clears the query on Escape', () => {
    renderView()

    fireEvent.change(searchInput(), { target: { value: 'nightly' } })
    fireEvent.keyDown(searchInput(), { key: 'Escape' })

    expect(searchInput()).toHaveValue('')
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
  })
})
