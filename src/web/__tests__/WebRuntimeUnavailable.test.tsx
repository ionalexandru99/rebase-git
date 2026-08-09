import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WebRuntimeUnavailable } from '../WebRuntimeUnavailable'

describe('WebRuntimeUnavailable', () => {
  it('renders a browser-safe fallback without the Electron preload bridge', () => {
    render(<WebRuntimeUnavailable />)

    expect(screen.getByRole('heading', { name: 'Web runtime unavailable' })).toBeVisible()
    expect(screen.getByText(/local server runtime/i)).toBeVisible()
  })
})
