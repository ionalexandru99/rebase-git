import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../context-menu'

function Harness(props: { onSelect?: () => void; disabled?: boolean }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger as="button" type="button" title="row">
        Row
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={props.disabled} onSelect={props.onSelect}>
          Checkout
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

describe('ContextMenu', () => {
  it('is closed until the trigger receives a contextmenu event', () => {
    render(<Harness />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens at the cursor position via a fixed-positioned portal', () => {
    render(<Harness />)
    fireEvent.contextMenu(screen.getByTitle('row'), { clientX: 140, clientY: 96 })
    const menu = screen.getByRole('menu')
    expect(menu).toBeInTheDocument()
    expect(menu).toHaveStyle({ position: 'fixed', left: '140px', top: '96px' })
  })

  it('fires onSelect and closes when an item is clicked', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    fireEvent.contextMenu(screen.getByTitle('row'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Checkout' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape without selecting', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    fireEvent.contextMenu(screen.getByTitle('row'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on an outside pointerdown', () => {
    render(<Harness />)
    fireEvent.contextMenu(screen.getByTitle('row'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not close when pointerdown lands inside the menu', () => {
    render(<Harness />)
    fireEvent.contextMenu(screen.getByTitle('row'))
    const item = screen.getByRole('menuitem', { name: 'Checkout' })
    fireEvent.pointerDown(item)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('ignores selection on a disabled item', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} disabled />)
    fireEvent.contextMenu(screen.getByTitle('row'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Checkout' }))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
