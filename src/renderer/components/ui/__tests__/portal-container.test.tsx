import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PortalContainerProvider } from '../portal-container'
import { ConfirmDialog } from '../prompt-dialog'

describe('PortalContainerProvider', () => {
  it('keeps a dialog inside its tab owner', () => {
    const tabOwner = document.createElement('div')
    tabOwner.setAttribute('aria-hidden', 'true')
    document.body.append(tabOwner)

    render(
      <PortalContainerProvider container={tabOwner}>
        <ConfirmDialog
          request={{ title: 'Delete branch?', onConfirm: vi.fn() }}
          onClose={vi.fn()}
        />
      </PortalContainerProvider>
    )

    expect(tabOwner).toContainElement(screen.getByRole('dialog', { hidden: true }))
    tabOwner.remove()
  })
})
