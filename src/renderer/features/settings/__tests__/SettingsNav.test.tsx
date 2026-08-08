import { fireEvent, render, screen } from '@testing-library/react'
import { CircleIcon, SquareIcon, TriangleIcon } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsNav } from '../SettingsNav'
import type { SettingsSectionEntry } from '../sections'

const entry = (
  id: string,
  label: string,
  overrides: Partial<SettingsSectionEntry> = {}
): SettingsSectionEntry => ({
  id,
  label,
  icon: CircleIcon,
  Content: () => null,
  ...overrides
})

const sections = [
  entry('first', 'First', { icon: SquareIcon }),
  entry('second', 'Second'),
  entry('third', 'Third', { icon: TriangleIcon })
]

function renderNav(activeSectionId = 'first') {
  const onSelect = vi.fn()
  render(<SettingsNav sections={sections} activeSectionId={activeSectionId} onSelect={onSelect} />)
  return onSelect
}

describe('SettingsNav', () => {
  it('renders every registered section and marks the active one', () => {
    renderNav('second')

    expect(screen.getByRole('button', { name: 'First' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Second' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Third' })).not.toHaveAttribute('aria-current')
  })

  it('selects a section on click', () => {
    const onSelect = renderNav()

    fireEvent.click(screen.getByRole('button', { name: 'Third' }))

    expect(onSelect).toHaveBeenCalledWith('third')
  })

  it('moves to the next section on ArrowDown', () => {
    const onSelect = renderNav()

    fireEvent.keyDown(screen.getByRole('button', { name: 'First' }), { key: 'ArrowDown' })

    expect(onSelect).toHaveBeenCalledWith('second')
  })

  it('wraps from the first section to the last on ArrowUp', () => {
    const onSelect = renderNav()

    fireEvent.keyDown(screen.getByRole('button', { name: 'First' }), { key: 'ArrowUp' })

    expect(onSelect).toHaveBeenCalledWith('third')
  })

  it('jumps to the ends with Home and End', () => {
    const onSelect = renderNav('second')

    fireEvent.keyDown(screen.getByRole('button', { name: 'Second' }), { key: 'Home' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Second' }), { key: 'End' })

    expect(onSelect).toHaveBeenNthCalledWith(1, 'first')
    expect(onSelect).toHaveBeenNthCalledWith(2, 'third')
  })

  it('keeps only the active item in the tab order', () => {
    renderNav('second')

    expect(screen.getByRole('button', { name: 'Second' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'First' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('button', { name: 'Third' })).toHaveAttribute('tabindex', '-1')
  })

  it('renders the badge slot of a section that provides one', () => {
    const onSelect = vi.fn()
    const withBadge = [
      entry('first', 'First'),
      entry('updates', 'Updates', { NavBadge: () => <span data-testid="updates-badge">1</span> })
    ]
    render(<SettingsNav sections={withBadge} activeSectionId="first" onSelect={onSelect} />)

    expect(screen.getByTestId('updates-badge')).toBeInTheDocument()
  })
})
