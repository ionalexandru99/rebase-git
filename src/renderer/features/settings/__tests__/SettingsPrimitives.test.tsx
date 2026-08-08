import { render, screen, within } from '@testing-library/react'
import { WrenchIcon } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { SettingsRow } from '../SettingsRow'
import { SettingsSection } from '../SettingsSection'

describe('SettingsSection', () => {
  it('renders the title as a labelled region with its description and children', () => {
    render(
      <SettingsSection icon={WrenchIcon} title="General" description="Everyday behaviour.">
        <p>Section body</p>
      </SettingsSection>
    )

    const section = within(screen.getByRole('region', { name: 'General' }))
    expect(section.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(section.getByText('Everyday behaviour.')).toBeInTheDocument()
    expect(section.getByText('Section body')).toBeInTheDocument()
  })

  it('omits the description line when none is given', () => {
    render(
      <SettingsSection icon={WrenchIcon} title="General">
        <p>Section body</p>
      </SettingsSection>
    )

    expect(screen.getByRole('region', { name: 'General' }).querySelector('p')).toHaveTextContent(
      'Section body'
    )
  })
})

describe('SettingsRow', () => {
  it('renders title, description, status and the control slot under a stable id', () => {
    render(
      <SettingsRow
        id="settings-updates-channel"
        title="Update channel"
        description="Which releases the app follows."
        status={<span>Up to date</span>}
      >
        <button type="button">Change</button>
      </SettingsRow>
    )

    const row = screen.getByRole('group', { name: 'Update channel' })
    expect(row).toHaveAttribute('id', 'settings-updates-channel')
    expect(row).toHaveAttribute('data-settings-row', 'settings-updates-channel')
    expect(within(row).getByText('Which releases the app follows.')).toBeInTheDocument()
    expect(within(row).getByText('Up to date')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Change' })).toBeInTheDocument()
  })

  it('renders without description, status or control', () => {
    render(<SettingsRow id="settings-about-version" title="Version" />)

    const row = screen.getByRole('group', { name: 'Version' })
    expect(row.querySelector('p')).toBeNull()
    expect(row.querySelector('button')).toBeNull()
  })

  it('stacks the control under the text in the stacked variant', () => {
    render(
      <SettingsRow id="settings-identity-app" title="App settings" variant="stacked">
        <form aria-label="Identity form" />
      </SettingsRow>
    )

    const row = screen.getByRole('group', { name: 'App settings' })
    expect(row.className).not.toContain('grid-cols-')
    expect(within(row).getByRole('form', { name: 'Identity form' })).toBeInTheDocument()
  })
})
