import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceSwitcher } from '../WorkspaceSwitcher'

describe('WorkspaceSwitcher', () => {
  it('opens the workspace menu and switches workspaces', async () => {
    const onSwitch = vi.fn()

    render(() => (
      <WorkspaceSwitcher
        workspaces={['/home/user/personal', '/home/user/work']}
        activeWorkspace="/home/user/personal"
        onSwitch={onSwitch}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />
    ))

    fireEvent.pointerDown(screen.getByRole('button', { name: /Switch workspace/i }), {
      button: 0,
      pointerType: 'mouse'
    })

    const workItem = await screen.findByText('/home/user/work')
    fireEvent.pointerUp(workItem, { button: 0, pointerType: 'mouse' })

    await waitFor(() => {
      expect(onSwitch).toHaveBeenCalledWith('/home/user/work')
    })
  })
})
